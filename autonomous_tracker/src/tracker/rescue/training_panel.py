from __future__ import annotations

import json
import os
import queue
import re
import subprocess
import threading
import tkinter as tk
from collections.abc import Callable
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk
from typing import BinaryIO
from uuid import uuid4

from tracker.cli.rescue_train import TrainingSettings
from tracker.rescue.annotations import AnnotationDocument, AnnotationSession
from tracker.rescue.desktop_jobs import python_command
from tracker.rescue.media import file_sha256
from tracker.rescue.model_check_panel import ModelCheckPanel
from tracker.rescue.quick_training_ui import QuickTrainingPanel
from tracker.rescue.scrollable import ScrollablePanel
from tracker.rescue.training_data import export_dataset, read_projects
from tracker.rescue.training_guide import StartingModel, assign_purpose, load_saved_video
from tracker.rescue.training_guide_ui import SavedVideoPicker, TrainingGuide
from tracker.rescue.training_workflow import (
    TrainingState,
    apply_shared_tags,
    export_issues,
    load_training_state,
    plan_shared_tags,
    require_fresh_export,
    save_training_state,
)


class TrainingPanel(ttk.Frame):
    def __init__(
        self,
        parent: ttk.Notebook,
        session: AnnotationSession,
        save: Callable[[], bool],
        inspect: Callable[[Path, Path], None] = lambda _project, _run: None,
        review_current: Callable[[], None] = lambda: None,
        review_project: Callable[[Path], None] = lambda _path: None,
        correct_run: Callable[[Path, Path, str], None] = lambda _project, _run, _model: None,
    ) -> None:
        super().__init__(parent, padding=14)
        self.session, self.save_project = session, save
        self.inspect = inspect
        self.correct_run = correct_run
        self.review_current, self.review_project = review_current, review_project
        self.picker: SavedVideoPicker | None = None
        self.export_is_current = False
        state_warning = ""
        try:
            self.saved_state = load_training_state(session.path)
        except (OSError, ValueError) as exc:
            self.saved_state = TrainingState()
            state_warning = f"Saved training workspace could not be restored: {exc}"
        self.paths = [Path(path) for path in self.saved_state.projects] or [session.path.resolve()]
        self.jobs: queue.Queue[tuple[str, str]] = queue.Queue()
        self.export_busy = False
        self.model_busy = False
        self.was_busy = False
        self.process: subprocess.Popen[bytes] | None = None
        self.log_stream: BinaryIO | None = None
        self.log_path: Path | None = None
        self.log_offset = 0
        self.stop_file: Path | None = None
        self.result_file: Path | None = None
        self.incident = tk.StringVar()
        self.split = tk.StringVar(value="training")
        self.dataset = tk.StringVar()
        self.weights = tk.StringVar()
        self.epochs = tk.StringVar(value="30")
        self.image_size = tk.StringVar(value="640")
        self.batch = tk.StringVar(value="4")
        self.device = tk.StringVar(value="cpu")
        for name in ("dataset", "weights", "epochs", "image_size", "batch", "device"):
            getattr(self, name).set(getattr(self.saved_state, name))
        self.shared_tags = tk.StringVar()
        self.readiness = tk.StringVar(value="Refresh to check dataset readiness.")
        self.export_status = tk.StringVar(value="No dataset exported yet.")
        self.status = tk.StringVar(
            value="Your labels stay here. Train a practice model now; check its reliability later."
        )
        self._build()
        if state_warning:
            self.status.set(state_warning)
        self.after(250, self.poll)

    @property
    def busy(self) -> bool:
        return (
            self.export_busy
            or self.model_busy
            or self.process is not None
            or (hasattr(self, "check_panel") and self.check_panel.busy)
            or (hasattr(self, "quick") and self.quick.busy)
        )

    def _build(self) -> None:
        self.views = ttk.Notebook(self)
        advanced_pages = ttk.Notebook(self.views)
        advanced = ttk.Frame(advanced_pages)
        comparisons = ScrollablePanel(self.views)
        self.guide = TrainingGuide(advanced_pages, self)
        advanced_pages.add(self.guide, text="Manage datasets")
        advanced_pages.add(advanced, text="Technical settings and logs")
        self.advanced_pages = advanced_pages
        self.quick = QuickTrainingPanel(self.views, self)
        self.views.add(self.quick, text="Train using my labels")
        self.views.add(comparisons, text="Check quality later")
        self.views.add(advanced_pages, text="Advanced")
        navigation = ttk.Frame(advanced)
        navigation.pack(fill="x", pady=(0, 6))
        ttk.Button(
            navigation,
            text="Dataset and training",
            command=lambda: self.scroller.canvas.yview_moveto(0),
        ).pack(side="left")
        ttk.Button(
            navigation, text="Test models and view saved comparisons", command=self.show_checks
        ).pack(side="left", padx=6)
        ttk.Label(self, textvariable=self.status, wraplength=980, style="Accent.TLabel").pack(
            side="bottom", fill="x", pady=(6, 0)
        )
        self.progress = ttk.Progressbar(self, mode="indeterminate")
        self.progress.pack(side="bottom", fill="x", pady=(4, 0))
        self.views.pack(fill="both", expand=True)
        self.log = tk.Text(
            advanced, height=4, bg="#1b2938", fg="#e9f0f7", wrap="word", state="disabled"
        )
        self.log.pack(side="bottom", fill="x", pady=6)
        self.scroller = ScrollablePanel(advanced)
        self.scroller.pack(fill="both", expand=True)
        body = self.scroller.body
        ttk.Label(
            body,
            text="1. Choose reviewed footage and keep each incident in one split",
            style="Accent.TLabel",
        ).pack(anchor="w")
        tag_bar = ttk.Frame(body)
        tag_bar.pack(fill="x", pady=6)
        ttk.Button(tag_bar, text="Edit shared dataset tags...", command=self.edit_tags).pack(
            side="left"
        )
        ttk.Label(
            tag_bar, textvariable=self.shared_tags, wraplength=720, style="Muted.TLabel"
        ).pack(side="left", padx=8)
        ttk.Label(body, textvariable=self.readiness, wraplength=950, style="Accent.TLabel").pack(
            fill="x"
        )
        bar = ttk.Frame(body)
        bar.pack(fill="x", pady=6)
        ttk.Button(bar, text="Add labeled videos...", command=self.add_projects).pack(side="left")
        ttk.Button(bar, text="Remove selected", command=self.remove_project).pack(
            side="left", padx=6
        )
        ttk.Button(bar, text="Refresh list", command=self.refresh).pack(side="left")
        ttk.Button(bar, text="Import project files...", command=self.import_project_files).pack(
            side="left", padx=6
        )
        self.table = ttk.Treeview(
            body,
            columns=("project", "incident", "split", "reviewed"),
            show="headings",
            height=4,
            selectmode="browse",
        )
        for column, title in (
            ("project", "Project"),
            ("incident", "Incident / recording group"),
            ("split", "Split"),
            ("reviewed", "Reviewed frames"),
        ):
            self.table.heading(column, text=title)
            self.table.column(column, width=260 if column == "project" else 160)
        self.table.pack(fill="x")
        self.table.bind("<<TreeviewSelect>>", self.select_project)
        metadata = ttk.Frame(body)
        metadata.pack(fill="x", pady=6)
        ttk.Label(metadata, text="Selected incident:").pack(side="left")
        ttk.Entry(metadata, textvariable=self.incident, width=26).pack(side="left", padx=6)
        ttk.Combobox(
            metadata,
            textvariable=self.split,
            values=["training", "validation", "test"],
            state="readonly",
            width=13,
        ).pack(side="left")
        ttk.Button(metadata, text="Save selected assignment", command=self.assign).pack(
            side="left", padx=6
        )
        ttk.Label(
            body,
            text="Classes must match across projects. Only reviewed frames are exported, "
            "including reviewed empty frames.",
            style="Muted.TLabel",
        ).pack(anchor="w")
        ttk.Label(body, text="2. Export an auditable YOLO dataset", style="Accent.TLabel").pack(
            anchor="w", pady=(12, 4)
        )
        export_bar = ttk.Frame(body)
        export_bar.pack(fill="x")
        ttk.Button(export_bar, text="Check and export...", command=self.export).pack(side="left")
        ttk.Button(export_bar, text="Open existing export...", command=self.choose_dataset).pack(
            side="left", padx=6
        )
        ttk.Entry(export_bar, textvariable=self.dataset, state="readonly").pack(
            side="left", fill="x", expand=True
        )
        ttk.Label(
            body, textvariable=self.export_status, wraplength=950, style="Accent.TLabel"
        ).pack(fill="x", pady=6)
        ttk.Label(
            body,
            text="3. Train new weights locally (does not replace your current model)",
            style="Accent.TLabel",
        ).pack(anchor="w", pady=(12, 4))
        weights_bar = ttk.Frame(body)
        weights_bar.pack(fill="x")
        ttk.Button(
            weights_bar, text="Choose trusted .pt weights...", command=self.choose_weights
        ).pack(side="left")
        ttk.Entry(weights_bar, textvariable=self.weights, state="readonly").pack(
            side="left", fill="x", expand=True, padx=6
        )
        options = ttk.Frame(body)
        options.pack(fill="x", pady=6)
        for name, variable in (
            ("Epochs", self.epochs),
            ("Image size", self.image_size),
            ("Batch", self.batch),
        ):
            ttk.Label(options, text=name).pack(side="left")
            ttk.Entry(options, textvariable=variable, width=6).pack(side="left", padx=(4, 12))
        ttk.Label(options, text="Device").pack(side="left")
        ttk.Combobox(
            options, textvariable=self.device, values=["cpu", "0"], width=6, state="readonly"
        ).pack(side="left", padx=6)
        ttk.Button(options, text="Start training...", command=self.start).pack(side="left", padx=6)
        ttk.Button(options, text="Stop training", command=self.stop).pack(side="left")
        ttk.Label(
            body,
            text="CPU is slower; 0 requires a CUDA-capable PyTorch installation. "
            "Use only media and weights you have rights to use.",
            style="Muted.TLabel",
        ).pack(anchor="w")
        self.check_panel = ModelCheckPanel(
            comparisons.body,
            self.saved_state,
            self.save_project,
            self.idle,
            self.persist,
            self.append_log,
            self.inspect,
        )
        self.check_panel.pack(fill="x", pady=(12, 0))
        for variable in (self.epochs, self.image_size, self.batch, self.device):
            variable.trace_add("write", lambda *_: self.persist())

    def show_checks(self) -> None:
        self.views.select(1)  # type: ignore[no-untyped-call]

    def show_advanced(self) -> None:
        self.views.select(2)  # type: ignore[no-untyped-call]
        self.advanced_pages.select(1)  # type: ignore[no-untyped-call]

    def persist(self) -> None:
        self.saved_state.projects = [str(path.resolve()) for path in self.paths]
        for name in ("dataset", "weights", "epochs", "image_size", "batch", "device"):
            setattr(self.saved_state, name, getattr(self, name).get())
        if hasattr(self, "check_panel"):
            self.saved_state.validation_project = self.check_panel.project.get()
        try:
            save_training_state(self.session.path, self.saved_state)
        except (OSError, ValueError) as exc:
            self.status.set(f"Could not save training workspace: {exc}")

    def update_readiness(self) -> None:
        scopes = []
        for path in self.paths:
            try:
                scopes.append(
                    set(AnnotationDocument.model_validate_json(path.read_bytes()).classes)
                )
            except (ValueError, OSError):
                continue
        union = sorted(set().union(*scopes)) if scopes else []
        self.shared_tags.set(
            (
                "Shared: "
                if scopes and all(scope == scopes[0] for scope in scopes)
                else "Tags differ. Sync required: "
            )
            + ", ".join(union)
        )
        try:
            read_projects(self.paths)
            self.readiness.set("Ready to export reviewed training and validation examples.")
        except (OSError, ValueError) as exc:
            self.readiness.set("Next action: " + str(exc))
        self.check_export()
        self.check_panel.update_projects(self.paths)
        self.check_panel.select_result()
        self.guide.render()
        self.quick.render()

    def check_export(self) -> None:
        self.export_is_current = False
        if not self.dataset.get():
            self.export_status.set(
                "No training data prepared yet. Choose your videos, then use Check and prepare."
            )
            return
        try:
            issues = export_issues(Path(self.dataset.get()), self.paths)
            self.export_is_current = not issues
            self.export_status.set(
                "STALE EXPORT: " + " ".join(issues) + " Prepare training data again."
                if issues
                else "Export matches the current reviewed labels and selected projects. "
                "File integrity is checked before training."
            )
        except (OSError, ValueError, KeyError, TypeError) as exc:
            self.export_status.set(
                f"Prepared data unavailable or invalid: {exc}. Prepare training data again."
            )

    def edit_tags(self) -> None:
        if not self.idle() or not self.save_project():
            return
        try:
            names = sorted(
                {
                    name
                    for path in self.paths
                    for name in AnnotationDocument.model_validate_json(path.read_bytes()).classes
                }
            )
            value = simpledialog.askstring(
                "Shared dataset tags",
                "Comma-separated tags for EVERY selected project. Existing boxes are kept. "
                "Tags with boxes cannot be removed. A changed scope returns that project's "
                "frames to draft for review.",
                initialvalue=", ".join(names),
                parent=self,
            )
            if value is None:
                return
            changes = plan_shared_tags(self.paths, value.split(","), self.session)
            if not changes:
                self.status.set("All selected projects already share these tags.")
                return
            count = sum(
                frame.reviewed and not updated.reviewed
                for change in changes
                for frame, updated in zip(
                    change.session.document.frames, change.updated.frames, strict=True
                )
            )
            if not messagebox.askyesno(
                "Apply shared tags?",
                f"Update {len(changes)} projects and return {count} reviewed frames to draft?\n\n"
                "All boxes are preserved. Review every visible object in the new scope "
                "before exporting. Original project revisions are backed up.\n\n"
                + "\n".join(change.session.path.name for change in changes),
                parent=self,
            ):
                return
            apply_shared_tags(changes)
            self.event_generate("<<TrainingMetadataChanged>>", when="tail")
            self.refresh()
            self.status.set(
                "Shared tags saved. Boxes preserved. Added tags need review; "
                "removing unused tags keeps existing approvals."
            )
        except (OSError, ValueError) as exc:
            self.error(exc)

    def error(self, exc: Exception) -> None:
        self.status.set(str(exc))
        messagebox.showerror("Export and train", str(exc), parent=self)

    def idle(self) -> bool:
        if self.busy:
            self.status.set("Wait for the current export or training job to finish first.")
            return False
        return True

    def refresh(self) -> None:
        if not self.idle() or not self.save_project():
            return
        selection = self.table.selection()
        self.table.delete(*self.table.get_children())
        for index, path in enumerate(self.paths):
            try:
                doc = AnnotationDocument.model_validate_json(path.read_bytes())
                values: tuple[str, str, str, int | str] = (
                    path.name,
                    doc.incident_id or "UNASSIGNED",
                    doc.split,
                    sum(frame.reviewed for frame in doc.frames),
                )
            except (OSError, ValueError):
                values = (path.name, "Unavailable / invalid", "", "")
            self.table.insert("", "end", iid=str(index), values=values)
        if self.table.get_children():
            selected = selection[0] if selection and self.table.exists(selection[0]) else "0"
            self.table.selection_set(selected)
            self.select_project()
        self.update_readiness()
        self.persist()

    def add_projects(self) -> None:
        if not self.idle() or not self.save_project():
            return
        if self.picker is None or not self.picker.winfo_exists():
            self.picker = SavedVideoPicker(self)

    def include_projects(self, paths: list[Path]) -> bool:
        if not self.idle() or not self.save_project():
            return False
        accepted = []
        rejected = []
        for path in paths:
            try:
                accepted.append(load_saved_video(path).path)
            except (OSError, ValueError) as exc:
                rejected.append(str(exc))
        before = len(self.paths)
        self.paths = list(dict.fromkeys([*(path.resolve() for path in self.paths), *accepted]))
        self.refresh()
        self.status.set(
            f"Added {len(self.paths) - before} saved videos. "
            "Existing selections and labels were kept."
        )
        if rejected:
            messagebox.showinfo(
                "Some files were skipped",
                "\n\n".join(rejected) + "\n\nUse Add labeled videos to choose from saved work "
                "without finding JSON files.",
                parent=self,
            )
        return bool(accepted)

    def import_project_files(self) -> None:
        if not self.idle():
            return
        names = filedialog.askopenfilenames(
            title="Add annotation project JSON files (not exported truth or backups)",
            filetypes=[("Annotation projects", "*.json")],
            parent=self,
        )
        if names:
            self.include_projects([Path(name) for name in names])

    def set_purpose(self, path: Path, purpose: str, group: str) -> str:
        if not self.idle() or not self.save_project():
            return "Wait for the current job, or save your edits, then try again."
        try:
            video = load_saved_video(path)
            videos = [load_saved_video(item) for item in self.paths]
            updated = assign_purpose(video, videos, purpose, group)
            current = path.resolve() == self.session.path.resolve()
            session = (
                self.session if current else AnnotationSession.open(path, video.document.source)
            )
            if session.document != video.document:
                raise ValueError("The saved labels changed. Refresh the video list and try again.")
            session.replace_document(updated)
            session.save()
            if current:
                self.event_generate("<<TrainingMetadataChanged>>", when="tail")
            self.after_idle(self.refresh)
            self.status.set("Video purpose saved. Boxes and their review status were preserved.")
            return ""
        except (OSError, ValueError) as exc:
            return str(exc)

    def remove_project(self) -> None:
        selected = self.table.selection()
        if self.idle() and selected:
            self.paths.pop(int(selected[0]))
            self.refresh()

    def select_project(self, _: object = None) -> None:
        selected = self.table.selection()
        if selected:
            try:
                doc = AnnotationDocument.model_validate_json(
                    self.paths[int(selected[0])].read_bytes()
                )
                self.incident.set(doc.incident_id)
                self.split.set(doc.split)
            except (OSError, ValueError) as exc:
                self.error(exc)

    def assign(self) -> None:
        selected = self.table.selection()
        if not self.idle() or not selected or not self.save_project():
            return
        try:
            path = self.paths[int(selected[0])]
            current = path == self.session.path.resolve()
            doc = (
                self.session.document
                if current
                else AnnotationDocument.model_validate_json(path.read_bytes())
            )
            other = self.session if current else AnnotationSession.open(path, doc.source)
            payload = other.document.model_dump()
            payload.update(incident_id=self.incident.get().strip(), split=self.split.get())
            other.replace_document(AnnotationDocument.model_validate(payload))
            other.save()
            if current:
                # The shell's metadata widgets must not overwrite this assignment on its next save.
                self.event_generate("<<TrainingMetadataChanged>>", when="tail")
            self.after_idle(self.refresh)
        except (OSError, ValueError) as exc:
            self.error(exc)

    def export(self, *, default_location: bool = False) -> None:
        if not self.idle() or not self.save_project():
            return
        try:
            read_projects(self.paths)
        except (OSError, ValueError) as exc:
            self.error(exc)
            return
        root = (
            str(self.session.path.parent / "datasets")
            if default_location
            else filedialog.askdirectory(
                title="Choose parent folder for a NEW dataset export", parent=self
            )
        )
        if not root:
            return
        self.export_busy = True
        self.export_is_current = False
        self.guide.update_availability()
        paths = list(self.paths)
        self.status.set("Verifying sources and exporting reviewed frames...")

        def work() -> None:
            try:
                data = export_dataset(
                    paths, Path(root), lambda text: self.jobs.put(("progress", text))
                )
                self.jobs.put(("exported", str(data)))
            except Exception as exc:
                self.jobs.put(("error", str(exc)))

        threading.Thread(target=work, daemon=True).start()

    def choose_dataset(self) -> None:
        if self.idle():
            path = filedialog.askopenfilename(
                title="Choose data.yaml from a completed studio export",
                filetypes=[("Dataset YAML", "*.yaml")],
                parent=self,
            )
            if path:
                self.dataset.set(path)
                self.check_export()
                self.guide.update_availability()
                self.persist()

    def choose_weights(self) -> None:
        if self.idle():
            path = filedialog.askopenfilename(
                title="Choose trusted local detection weights",
                filetypes=[("PyTorch model", "*.pt")],
                parent=self,
            )
            if path:
                self.weights.set(path)
                self.persist()

    def use_saved_model(self, model: StartingModel) -> None:
        if not self.idle():
            return
        self.model_busy = True
        self.status.set(f"Checking saved model: {model.name}...")
        self.guide.update_availability()

        def work() -> None:
            try:
                if model.weights.suffix.casefold() != ".pt" or not model.weights.is_file():
                    raise ValueError("This saved model's file is missing. Choose another model.")
                if model.sha256 is not None and file_sha256(model.weights) != model.sha256:
                    raise ValueError(
                        "This model file has changed since it was saved. "
                        "Re-import the intended version in Model library."
                    )
                self.jobs.put(("model", str(model.weights.resolve())))
            except Exception as exc:
                self.jobs.put(("model_error", str(exc)))

        threading.Thread(target=work, daemon=True).start()

    def start(self) -> None:
        if not self.idle() or not self.save_project():
            return
        try:
            settings = TrainingSettings(
                epochs=int(self.epochs.get()),
                image_size=int(self.image_size.get()),
                batch=int(self.batch.get()),
                device=self.device.get(),
            )
            data, weights = Path(self.dataset.get()), Path(self.weights.get())
            if not data.is_file() or not weights.is_file():
                raise ValueError("choose an exported dataset and trusted local model weights")
            self.check_export()
            require_fresh_export(data, self.paths)
            if not messagebox.askyesno(
                "Start local training",
                f"Train for up to {settings.epochs} epochs on {settings.device}?\n\n"
                "Only proceed with trusted weights and media you have permission to use. "
                "Model files may execute code when loaded. New weights will be saved "
                "separately; detection quality is not guaranteed.",
                parent=self,
            ):
                return
            output = data.parent / "training-runs"
            output.mkdir(exist_ok=True)
            token = uuid4().hex[:8]
            self.log_path = output / f"job-{token}.log"
            self.stop_file = output / f"job-{token}.stop"
            self.result_file = output / f"job-{token}.result.json"
            arguments = [
                "--data",
                str(data.resolve()),
                "--weights",
                str(weights.resolve()),
                "--output",
                str(output.resolve()),
                "--epochs",
                str(settings.epochs),
                "--image-size",
                str(settings.image_size),
                "--batch",
                str(settings.batch),
                "--device",
                settings.device,
                "--stop-file",
                str(self.stop_file.resolve()),
                "--result-file",
                str(self.result_file.resolve()),
            ]
            for path in self.paths:
                arguments.extend(["--require-current-project", str(path.resolve())])
            command = python_command("tracker.cli.rescue_train", arguments)
            self.persist()
            self.log_stream = self.log_path.open("xb")
            self.log_offset = 0
            try:
                self.process = subprocess.Popen(
                    command,
                    stdout=self.log_stream,
                    stderr=subprocess.STDOUT,
                    stdin=subprocess.DEVNULL,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                    env={**os.environ, "PYTHONIOENCODING": "utf-8"},
                )
            except Exception:
                self.log_stream.close()
                self.log_stream = None
                raise
            self.append_log(f"\nStarting a new training job. Full log: {self.log_path}\n")
            self.guide.update_availability()
            self.status.set(
                "Training process started. Preflight will verify exported files before YOLO loads."
            )
        except (OSError, ValueError) as exc:
            self.error(exc)

    def stop(self) -> None:
        if self.process is None or self.stop_file is None:
            self.status.set("No training process is running.")
            return
        if not self.stop_file.exists():
            self.stop_file.touch(exist_ok=False)
            self.status.set(
                "Stop requested. Waiting for the current batch; checkpoints are retained. "
                "Press Stop again to force termination."
            )
        elif messagebox.askyesno(
            "Force stop",
            "Terminate this training process now? "
            "The latest batch or checkpoint write may be incomplete.",
            parent=self,
        ):
            self.process.terminate()

    def append_log(self, text: str) -> None:
        text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)
        self.log.configure(state="normal")
        self.log.insert("end", text.replace("\r", "\n"))
        if int(self.log.index("end-1c").split(".")[0]) > 600:
            self.log.delete("1.0", "200.0")
        self.log.see("end")
        self.log.configure(state="disabled")

    def poll(self) -> None:
        for _ in range(100):
            try:
                kind, text = self.jobs.get_nowait()
            except queue.Empty:
                break
            self.status.set(text)
            if kind in {"model", "model_error"}:
                self.model_busy = False
                if kind == "model":
                    self.weights.set(text)
                    self.persist()
                    self.status.set("Starting model selected. Nothing was trained or activated.")
                else:
                    self.error(ValueError(text))
            if kind in {"exported", "error"}:
                self.export_busy = False
                if kind == "exported":
                    self.dataset.set(text)
                    self.append_log("Dataset exported: " + text + "\n")
                    self.check_export()
                    self.guide.show_step(2)
                    self.persist()
                else:
                    self.error(ValueError(text))
                self.guide.update_availability()
        if self.process is not None and self.log_path is not None:
            try:
                with self.log_path.open("rb") as stream:
                    stream.seek(self.log_offset)
                    chunk = stream.read(65536)
                    self.log_offset = stream.tell()
                if chunk:
                    self.append_log(chunk.decode("utf-8", errors="replace"))
                code = self.process.poll()
                if code is not None and self.log_offset >= self.log_path.stat().st_size:
                    self.process = None
                    if self.log_stream is not None:
                        self.log_stream.close()
                        self.log_stream = None
                    self.status.set(
                        (
                            "Training completed. Use step 4 to test this model "
                            "or compare with the starting model. "
                            "Evaluate before using."
                            if code == 0
                            else f"Training stopped or failed (exit {code}). See log for details."
                        )
                        + f" Full log: {self.log_path}"
                    )
                    if code == 0:
                        try:
                            if self.result_file is None:
                                raise ValueError("Training receipt is missing.")
                            result = Path(
                                json.loads(self.result_file.read_bytes())["training_result"]
                            )
                            self.check_panel.set_training(result)
                            self.check_panel.update_projects(self.paths)
                            self.quick.refresh_models(result)
                            self.show_checks()
                        except (OSError, ValueError, KeyError, TypeError) as exc:
                            self.error(
                                ValueError(
                                    "Training exited successfully but its outputs "
                                    f"could not be reopened: {exc}"
                                )
                            )
            except OSError as exc:
                self.status.set(f"Cannot read training log: {exc}")
        self.guide.update_availability()
        if self.busy != self.was_busy:
            self.progress.start(15) if self.busy else self.progress.stop()
            self.was_busy = self.busy
        self.after(250, self.poll)
