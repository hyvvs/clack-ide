"""No-command desktop library for rescue observation and model training."""

from __future__ import annotations

import argparse
import os
import sys
import tkinter as tk
import traceback
from contextlib import suppress
from pathlib import Path
from tkinter import messagebox
from uuid import uuid4

from tracker.rescue.studio_home import StudioHome


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    args = parser.parse_args()
    workspace = args.workspace.resolve()
    if not (workspace / "configs").is_dir():
        parser.error("Choose the autonomous_tracker project folder containing configs")
    os.chdir(workspace)
    log_directory = workspace / "diagnostics" / "studio"
    log_directory.mkdir(parents=True, exist_ok=True)
    if sys.stderr is None or sys.stdout is None:
        stream = (log_directory / f"desktop-{uuid4().hex[:12]}.log").open("x", encoding="utf-8")
        sys.stdout = sys.stderr = stream
    root = tk.Tk()
    try:
        StudioHome(root, workspace)
        root.mainloop()
    except Exception as exc:
        traceback.print_exc()
        messagebox.showerror("Rescue Studio could not start", str(exc), parent=root)
        raise
    finally:
        with suppress(tk.TclError):
            root.destroy()


if __name__ == "__main__":
    main()
