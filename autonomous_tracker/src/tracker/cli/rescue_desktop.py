"""Installed desktop entry point with a user-owned workspace, separate from application files."""

from __future__ import annotations

import argparse
import os
import sys
import tkinter as tk
from contextlib import suppress
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk
from uuid import uuid4

from tracker.rescue.config import ReviewModel
from tracker.rescue.state_store import StateStore
from tracker.rescue.studio_home import StudioHome


class DesktopPreferences(ReviewModel):
    workspace: str = ""


def prepare_workspace(path: Path, installation: Path | None = None) -> Path:
    path = path.resolve()
    if installation is not None and path.is_relative_to(installation.resolve()):
        raise ValueError("Keep the workspace outside the application installation folder.")
    path.mkdir(parents=True, exist_ok=True)
    for name in ("configs", "data", "annotations", "diagnostics", "models"):
        (path / name).mkdir(exist_ok=True)
    return path


def choose_workspace(root: tk.Tk, installation: Path | None) -> Path | None:
    chosen: list[Path] = []
    window = tk.Toplevel(root)
    window.title("Welcome to Rescue Studio")
    window.geometry("630x300")
    body = ttk.Frame(window, padding=24)
    body.pack(fill="both", expand=True)
    ttk.Label(body, text="Choose where your work lives", font=("Segoe UI", 19)).pack(anchor="w")
    ttk.Label(
        body,
        text="Videos, labels, model versions and job results stay in your workspace. "
        "It is separate from the installed application and is not removed by uninstalling.",
        wraplength=565,
    ).pack(anchor="w", pady=14)

    def choose(create: bool) -> None:
        name = filedialog.askdirectory(
            title="Choose parent folder for a new workspace"
            if create
            else "Choose your existing workspace",
            parent=window,
        )
        if not name:
            return
        path = Path(name)
        if create:
            title = simpledialog.askstring(
                "Workspace name",
                "Folder name:",
                initialvalue="Rescue Studio Workspace",
                parent=window,
            )
            if not title:
                return
            if (
                Path(title).name != title
                or any(char in title for char in '<>:"/\\|?*')
                or title in {".", ".."}
            ):
                messagebox.showerror(
                    "Workspace name",
                    "Choose a simple folder name without path separators.",
                    parent=window,
                )
                return
            path /= title
            if path.exists():
                messagebox.showerror(
                    "Workspace exists",
                    "Use Open existing workspace to resume that folder.",
                    parent=window,
                )
                return
        elif not ((path / "annotations").is_dir() or (path / "configs").is_dir()):
            messagebox.showerror(
                "Choose workspace",
                "Choose a Rescue Studio workspace with annotations or configs, "
                "or create a new workspace.",
                parent=window,
            )
            return
        try:
            chosen.append(prepare_workspace(path, installation))
            window.destroy()
        except (OSError, ValueError) as exc:
            messagebox.showerror("Workspace unavailable", str(exc), parent=window)

    ttk.Button(body, text="Open existing workspace...", command=lambda: choose(False)).pack(
        fill="x", pady=5
    )
    ttk.Button(body, text="Create a new workspace...", command=lambda: choose(True)).pack(
        fill="x", pady=5
    )
    root.wait_window(window)
    return chosen[0] if chosen else None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--choose-workspace", action="store_true")
    args = parser.parse_args()
    root = tk.Tk()
    root.withdraw()
    state_root = (
        Path(os.environ.get("LOCALAPPDATA", str(Path.home() / ".local" / "share"))) / "RescueStudio"
    )
    store = StateStore(state_root / "desktop.json")
    installation = (
        Path(sys.executable).resolve().parent.parent
        if (Path(sys.executable).parent / "python312._pth").is_file()
        else None
    )
    try:
        preferences = DesktopPreferences()
        try:
            payload = store.read()
            if payload:
                preferences = DesktopPreferences.model_validate_json(payload)
        except (OSError, ValueError):
            pass
        selected = args.workspace
        if (
            selected is None
            and not args.choose_workspace
            and preferences.workspace
            and Path(preferences.workspace).is_dir()
        ):
            selected = Path(preferences.workspace)
        if selected is None:
            selected = choose_workspace(root, installation)
        if selected is None:
            return
        workspace = prepare_workspace(selected, installation)
        store.save(DesktopPreferences(workspace=str(workspace)))
        os.chdir(workspace)
        if sys.stderr is None or sys.stdout is None:
            logs = workspace / "diagnostics" / "studio"
            logs.mkdir(parents=True, exist_ok=True)
            sys.stdout = sys.stderr = (logs / f"desktop-{uuid4().hex[:12]}.log").open(
                "x", encoding="utf-8"
            )
        StudioHome(root, workspace)
        root.deiconify()
        root.mainloop()
    except Exception as exc:
        messagebox.showerror("Rescue Studio", str(exc), parent=root)
        raise
    finally:
        with suppress(tk.TclError):
            root.destroy()


if __name__ == "__main__":
    main()
