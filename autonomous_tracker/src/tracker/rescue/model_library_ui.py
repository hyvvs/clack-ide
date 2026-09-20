from __future__ import annotations

import json
import os
import queue
import threading
import tkinter as tk
from collections.abc import Callable
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk

from tracker.rescue.managed_models import (
    ModelSync,
    model_available,
    model_date,
    model_folder,
    save_trained_model,
    sync_trained_models,
)
from tracker.rescue.model_library import ModelLibrary
from tracker.rescue.saved_models_ui import SavedModelsList
from tracker.rescue.training_workflow import completed_training


class ModelLibraryWindow(tk.Toplevel):
    def __init__(
        self,
        parent: tk.Tk,
        workspace: Path,
        activate: Callable[[Path], None],
        test: Callable[[Path], None],
    ) -> None:
        library = ModelLibrary(workspace)
        super().__init__(parent)
        self.workspace, self.on_activate, self.on_test = workspace, activate, test
        self.library = library
        self.busy = False
        self.events: queue.Queue[tuple[str, object]] = queue.Queue()
        self.title("Rescue Studio | My models")
        self.geometry("1050x720")
        self.minsize(900, 620)
        self.status = tk.StringVar(
            value="Models trained in this workspace appear automatically. "
            "Select a model, then choose what to do with it."
        )
        self.technical = tk.BooleanVar(value=False)
        body = ttk.Frame(self, padding=16)
        body.pack(fill="both", expand=True)
        body.columnconfigure(0, weight=1)
        body.rowconfigure(1, weight=1)
        body.rowconfigure(3, weight=1)
        toolbar = ttk.Frame(body)
        toolbar.grid(row=0, column=0, sticky="ew")
        for text, command in (
            ("Add a model file...", self.import_weights),
            ("Rename...", self.rename),
            ("Open model folder", self.open_folder),
            ("Refresh models", self.reload),
        ):
            ttk.Button(toolbar, text=text, command=command).pack(side="left", padx=(0, 6))
        table_frame = ttk.Frame(body)
        table_frame.grid(row=1, column=0, sticky="nsew", pady=10)
        self.shelf = SavedModelsList(table_frame, self.details)
        self.shelf.pack(fill="both", expand=True)
        self.table = self.shelf.table
        actions = ttk.Frame(body)
        actions.grid(row=2, column=0, sticky="ew")
        ttk.Button(actions, text="Use selected model as default...", command=self.activate).pack(
            side="left"
        )
        ttk.Button(actions, text="Use previous default...", command=self.rollback).pack(
            side="left", padx=6
        )
        ttk.Button(actions, text="Check quality...", command=self.test).pack(side="left")
        ttk.Checkbutton(
            actions, text="Technical details", variable=self.technical, command=self.details
        ).pack(side="right")
        info_frame = ttk.Frame(body)
        info_frame.grid(row=3, column=0, sticky="nsew", pady=10)
        self.info = tk.Text(
            info_frame,
            height=12,
            wrap="word",
            background="#1b2938",
            foreground="#e9f0f7",
            state="disabled",
        )
        info_scroll = ttk.Scrollbar(info_frame, orient="vertical", command=self.info.yview)
        self.info.configure(yscrollcommand=info_scroll.set)
        info_scroll.pack(side="right", fill="y")
        self.info.pack(side="left", fill="both", expand=True)
        ttk.Label(body, textvariable=self.status, wraplength=850, style="Accent.TLabel").grid(
            row=4, column=0, sticky="ew"
        )
        self.protocol("WM_DELETE_WINDOW", self.close)
        self.render()
        self.after_id = self.after(150, self.poll)
        self.bind("<Destroy>", self.cleanup)
        self.reload()

    def cleanup(self, event: tk.Event[tk.Misc]) -> None:
        if event.widget is self:
            self.after_cancel(self.after_id)

    def selected(self) -> str | None:
        rows = self.table.selection()
        return rows[0] if rows else None

    def render(self) -> None:
        self.shelf.render(self.library)

    def error(self, exc: Exception) -> None:
        self.status.set(str(exc))
        messagebox.showerror("Model library", str(exc), parent=self)

    def reload(self) -> None:
        if not self.busy:
            self.work(lambda: sync_trained_models(self.workspace), "synced")

    def open_folder(self) -> None:
        version = self.shelf.selected()
        if version is not None:
            try:
                folder = model_folder(version)
                if not folder.is_dir():
                    raise ValueError("This model's folder is missing.")
                os.startfile(folder)
            except (OSError, ValueError) as exc:
                self.error(exc)

    def work(self, action: Callable[[], object], kind: str) -> None:
        if self.busy:
            return
        self.busy = True
        self.status.set("Verifying local files and saving the model version...")

        def run() -> None:
            try:
                self.events.put((kind, action()))
            except Exception as exc:
                self.events.put(("error", exc))

        threading.Thread(target=run, daemon=True).start()

    def import_config(self) -> None:
        if self.busy:
            return
        path = filedialog.askopenfilename(
            title="Trusted observation config",
            filetypes=[("YAML config", "*.yaml *.yml")],
            parent=self,
        )
        if path:
            name = simpledialog.askstring(
                "Version name",
                "Name this model version:",
                initialvalue=Path(path).stem,
                parent=self,
            )
            if name:
                self.work(lambda: self.library.register(name, Path(path)), "registered")

    def import_weights(self) -> None:
        if self.busy:
            return
        path = filedialog.askopenfilename(
            title="Trusted local detection weights",
            filetypes=[("Model weights", "*.pt")],
            parent=self,
        )
        if path and messagebox.askyesno(
            "Trust this model file?",
            "Reading this model's classes loads the .pt file. Model files can execute code. "
            "Continue only if you trust its source. No automatic model download will occur.",
            parent=self,
        ):
            name = simpledialog.askstring(
                "Version name", "Name this model:", initialvalue=Path(path).stem, parent=self
            )
            if name:
                self.work(
                    lambda: self.library.register_weights(name, Path(path), managed=True),
                    "registered",
                )

    def import_training(self) -> None:
        if self.busy:
            return
        path = filedialog.askopenfilename(
            title="Completed training result.json",
            filetypes=[("Training result", "*.json")],
            parent=self,
        )
        if path:
            try:
                completed_training(Path(path))
                self.work(lambda: save_trained_model(self.workspace, Path(path)), "registered")
            except (OSError, ValueError, KeyError) as exc:
                self.error(exc)

    def rename(self) -> None:
        identity = self.selected()
        if identity is None or self.busy:
            return
        name = simpledialog.askstring(
            "Rename model version",
            "Display name:",
            initialvalue=self.library.get(identity).name,
            parent=self,
        )
        if name:
            try:
                self.library.rename(identity, name)
                self.render()
            except (OSError, ValueError) as exc:
                self.error(exc)

    def activate(self) -> None:
        identity = self.selected()
        if (
            identity is not None
            and not self.busy
            and messagebox.askyesno(
                "Select observation model",
                "Use this version for NEW observation jobs? "
                "Running jobs keep their existing model snapshot. "
                "No labels, other model files or hardware settings are changed.",
                parent=self,
            )
        ):
            self.work(lambda: self.library.activate(identity), "active")

    def rollback(self) -> None:
        if not self.busy and messagebox.askyesno(
            "Revert active observation model",
            "Select the previously active version for new observation jobs?",
            parent=self,
        ):
            self.work(self.library.rollback, "active")

    def test(self) -> None:
        identity = self.selected()
        if identity is not None and not self.busy:
            version = self.library.get(identity)
            if version.training_result:
                self.on_test(Path(version.training_result))
            else:
                self.status.set(
                    "This imported config has no Studio training record. "
                    "Import a completed training result for the guided comparison workflow."
                )

    def details(self) -> None:
        identity = self.selected()
        if identity is None:
            return
        version = self.library.get(identity)
        if not self.technical.get():
            lines = [
                version.name,
                "",
                "Recognizes: " + ", ".join(version.config.review_classes),
                "Trained / added: " + model_date(version),
            ]
            if version.source_videos:
                lines.append("Learned from: " + ", ".join(version.source_videos))
            lines.extend(
                [
                    "",
                    "NOT INDEPENDENTLY TESTED. Training is not an accuracy test.",
                    "Files saved by Studio."
                    if version.managed_directory
                    else "Imported model. Keep its original file in place.",
                    "Use selected model as default applies to new video-analysis jobs only.",
                ]
            )
            if not model_available(version):
                lines.append("Model files are missing. Choose another saved model.")
            self.info.configure(state="normal")
            self.info.delete("1.0", "end")
            self.info.insert("1.0", "\n".join(lines))
            self.info.configure(state="disabled")
            return
        lines = [
            f"{version.name}\nVersion: {version.id}\nCreated: {version.created_utc}",
            "",
            "Local weight references (not copies):",
        ]
        for model in version.config.models:
            lines.extend([model.weights, f"SHA256: {model.weights_sha256}"])
        if version.training_result:
            lines.extend(["", "Training record: " + version.training_result])
            try:
                request = json.loads(
                    (Path(version.training_result).parent / "request.json").read_bytes()
                )
                lines.extend(
                    [
                        "Starting weights: " + request["baseline"],
                        "Settings: " + json.dumps(request["settings"]),
                        "",
                        "Saved validation checks:",
                    ]
                )
                checks = sorted(
                    (Path(version.training_result).parent / "model-checks").glob(
                        "model-check-*/result.json"
                    )
                )
                for path in checks[-20:]:
                    payload = json.loads(path.read_bytes())
                    for row in payload["evaluations"]:
                        lines.append(
                            f"{path.parent.name} | {row['name']} | "
                            f"precision {row['overall']['precision']} | "
                            f"recall {row['overall']['recall']} | "
                            f"coverage {row['coverage']['scored_frames']}/"
                            f"{row['coverage']['reviewed_frames']}"
                        )
                if not checks:
                    lines.append("No completed validation checks yet.")
            except (OSError, ValueError, KeyError, TypeError) as exc:
                lines.append("History unavailable: " + str(exc))
        lines.append("\nTraining completion or a version name does not establish rescue readiness.")
        self.info.configure(state="normal")
        self.info.delete("1.0", "end")
        self.info.insert("1.0", "\n".join(lines))
        self.info.configure(state="disabled")

    def close(self) -> None:
        if self.busy:
            self.status.set("Wait for the current model operation before closing.")
        else:
            self.destroy()

    def poll(self) -> None:
        try:
            kind, value = self.events.get_nowait()
        except queue.Empty:
            pass
        else:
            self.busy = False
            if isinstance(value, Exception):
                self.error(value)
            else:
                if isinstance(value, ModelSync):
                    self.library = value.library
                else:
                    self.library.reload()
                self.render()
                if kind == "active":
                    assert isinstance(value, Path)
                    self.on_activate(value)
                    self.status.set(
                        "Active observation model updated. Existing jobs and labels are unchanged."
                    )
                elif kind == "synced":
                    assert isinstance(value, ModelSync)
                    self.status.set(
                        "Models are ready. Select a row to see its details."
                        if not value.warnings
                        else "Some completed runs could not be added. " + value.warnings[0]
                    )
                else:
                    self.status.set(
                        "Version saved. Select it explicitly to use it for new observation jobs."
                    )
        self.after_id = self.after(150, self.poll)
