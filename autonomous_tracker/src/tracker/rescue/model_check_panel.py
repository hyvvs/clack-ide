from __future__ import annotations

import json
import os
import tkinter as tk
from collections.abc import Callable
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk
from typing import Any
from uuid import uuid4

from tracker.rescue.annotations import AnnotationDocument
from tracker.rescue.desktop_jobs import DesktopJob
from tracker.rescue.managed_models import save_trained_model
from tracker.rescue.model_library import ModelLibrary
from tracker.rescue.scoring import annotation_digest
from tracker.rescue.training_workflow import TrainingState, completed_training


class ModelCheckPanel(ttk.LabelFrame):
    def __init__(
        self,
        parent: ttk.Frame,
        state: TrainingState,
        save: Callable[[], bool],
        idle: Callable[[], bool],
        persist: Callable[[], None],
        log: Callable[[str], None],
        inspect: Callable[[Path, Path], None],
    ) -> None:
        super().__init__(parent, text="4. Test the trained model on validation footage", padding=8)
        self.saved_state, self.save_project, self.idle_parent = state, save, idle
        self.persist, self.append_log, self.inspect = persist, log, inspect
        self.job: DesktopJob | None = None
        self.receipt: Path | None = None
        self.rows: dict[str, tuple[Path, dict[str, Any]]] = {}
        self.model_label = tk.StringVar(value="No completed training selected.")
        self.project = tk.StringVar(value=state.validation_project)
        self.status = tk.StringVar(
            value="Use validation for model selection. Keep final test incidents untouched."
        )
        bar = ttk.Frame(self)
        bar.pack(fill="x")
        ttk.Button(bar, text="Open completed training...", command=self.choose_training).pack(
            side="left"
        )
        ttk.Label(bar, textvariable=self.model_label, wraplength=640).pack(side="left", padx=8)
        ttk.Button(self, text="Name this model...", command=self.register_model).pack(
            anchor="w", pady=4
        )
        validation = ttk.Frame(self)
        validation.pack(fill="x", pady=6)
        ttk.Label(validation, text="Validation project:").pack(side="left")
        self.project_box = ttk.Combobox(validation, textvariable=self.project, state="readonly")
        self.project_box.pack(side="left", fill="x", expand=True, padx=6)
        self.project_box.bind("<<ComboboxSelected>>", lambda _: self.persist())
        ttk.Button(validation, text="Browse...", command=self.choose_project).pack(side="left")
        actions = ttk.Frame(self)
        actions.pack(fill="x")
        self.test_button = ttk.Button(
            actions, text="Test this model", command=lambda: self.start(False)
        )
        self.test_button.pack(side="left")
        self.compare_button = ttk.Button(
            actions, text="Compare with starting model", command=lambda: self.start(True)
        )
        self.compare_button.pack(side="left", padx=6)
        ttk.Button(actions, text="Stop check", command=self.stop).pack(side="left")
        ttk.Button(
            actions, text="Inspect selected run / correct boxes", command=self.open_selected
        ).pack(side="left", padx=6)
        self.table = ttk.Treeview(
            self,
            columns=("model", "precision", "recall", "coverage", "tags"),
            show="headings",
            height=4,
        )
        for key, label, width in (
            ("model", "Model / saved check", 220),
            ("precision", "Precision", 85),
            ("recall", "Recall", 85),
            ("coverage", "Reviewed coverage", 140),
            ("tags", "Unsupported tags / status", 260),
        ):
            self.table.heading(key, text=label)
            self.table.column(key, width=width)
        self.table.pack(fill="x", pady=6)
        self.table.bind("<<TreeviewSelect>>", self.select_result)
        ttk.Button(self, text="Open selected result folder", command=self.open_folder).pack(
            anchor="w"
        )
        ttk.Label(self, textvariable=self.status, wraplength=960, style="Muted.TLabel").pack(
            fill="x", pady=6
        )
        self.refresh_model()
        for path in list(self.saved_state.checks):
            try:
                self.add_check(Path(path))
            except (OSError, ValueError, KeyError, TypeError) as exc:
                self.status.set(f"Some saved results could not be reopened: {exc}")
        self.after(250, self.poll)

    @property
    def busy(self) -> bool:
        return self.job is not None

    def error(self, exc: Exception) -> None:
        self.status.set(str(exc))
        messagebox.showerror("Test observation model", str(exc), parent=self)

    def refresh_model(self) -> None:
        valid = False
        baseline = False
        try:
            if self.saved_state.training_result:
                result = completed_training(Path(self.saved_state.training_result))
                self.model_label.set(Path(self.saved_state.training_result).parent.name)
                valid, baseline = True, bool(result.get("baseline_review_config"))
                unsupported = result.get("baseline_unsupported_classes", [])
                if unsupported:
                    self.status.set(
                        "Starting model cannot predict: "
                        + ", ".join(unsupported)
                        + ". This limits the comparison."
                    )
        except (OSError, ValueError, KeyError, TypeError) as exc:
            self.model_label.set(f"Saved model unavailable: {exc}")
        self.test_button.configure(state="normal" if valid else "disabled")
        self.compare_button.configure(state="normal" if valid and baseline else "disabled")

    def set_training(self, path: Path) -> None:
        completed_training(path)
        self.saved_state.training_result = str(path.resolve())
        self.refresh_model()
        self.persist()

    def choose_training(self) -> None:
        if not self.idle_parent():
            return
        name = filedialog.askopenfilename(
            title="Select result.json from a completed training run",
            filetypes=[("Training result", "*.json")],
            parent=self,
        )
        if name:
            try:
                self.set_training(Path(name))
            except (OSError, ValueError, KeyError, TypeError) as exc:
                self.error(exc)

    def register_model(self) -> None:
        if not self.idle_parent():
            return
        try:
            result_path = Path(self.saved_state.training_result)
            completed_training(result_path)
            workspace = Path.cwd()
            version = save_trained_model(workspace, result_path)
            name = simpledialog.askstring(
                "Model version name",
                "Name this trained observation version:",
                initialvalue=version.name,
                parent=self,
            )
            if name:
                ModelLibrary(workspace).rename(version.id, name)
                self.status.set(
                    f"Model named '{name}'. Find it in My models. The default model is unchanged."
                )
        except (OSError, ValueError, KeyError, TypeError) as exc:
            self.error(exc)

    def update_projects(self, paths: list[Path]) -> None:
        choices = []
        for path in paths:
            try:
                doc = AnnotationDocument.model_validate_json(path.read_bytes())
                if doc.split == "validation":
                    choices.append(str(path.resolve()))
            except (OSError, ValueError):
                continue
        if self.project.get() and self.project.get() not in choices:
            choices.append(self.project.get())
        self.project_box.configure(values=choices)
        if not self.project.get() and choices:
            self.project.set(choices[0])

    def choose_project(self) -> None:
        if not self.idle_parent():
            return
        name = filedialog.askopenfilename(
            title="Reviewed validation annotation project",
            filetypes=[("Project JSON", "*.json")],
            parent=self,
        )
        if name:
            self.project.set(str(Path(name).resolve()))
            self.update_projects([])
            self.persist()

    def start(self, compare: bool) -> None:
        if not self.idle_parent() or not self.save_project():
            return
        try:
            from tracker.cli.rescue_model_check import validation_document

            result = Path(self.saved_state.training_result)
            completed_training(result)
            project = Path(self.project.get())
            doc = validation_document(project, result)
            if not messagebox.askyesno(
                "Run validation inference",
                f"Run {'both models' if compare else 'the trained model'} "
                f"on {Path(doc.source.path).name}?\n\n"
                "This processes the whole recording and scores only reviewed frames. "
                "Save any validation edits in other open windows first. "
                "It can take time on CPU. Only continue with trusted local weights. "
                "Labels and the active model are not changed.",
                parent=self,
            ):
                return
            output = result.parent / "model-checks"
            output.mkdir(exist_ok=True)
            self.receipt = output / f"job-{uuid4().hex[:12]}.json"
            args = [
                "--training-result",
                str(result.resolve()),
                "--project",
                str(project.resolve()),
                "--output",
                str(output),
                "--result-file",
                str(self.receipt),
            ]
            if compare:
                args.append("--compare")
            self.job = DesktopJob(
                Path.cwd(), "tracker.cli.rescue_model_check", args, stoppable=True
            )
            self.persist()
            self.status.set(
                "Running real inference in the background. Results appear below when complete."
            )
        except (OSError, ValueError, KeyError, TypeError) as exc:
            self.error(exc)

    def stop(self) -> None:
        if self.job is not None:
            try:
                self.job.stop()
                self.status.set(
                    "Stop requested. Waiting for the current frame; "
                    "incomplete checks are not compared."
                )
            except OSError as exc:
                self.error(exc)

    def add_check(self, path: Path) -> None:
        payload = json.loads(path.read_bytes())
        if payload["status"] != "completed":
            raise ValueError("Model check is not complete.")
        for row in payload["evaluations"]:
            overall, coverage = row["overall"], row["coverage"]

            def percentage(value: Any) -> str:
                return "N/A" if value is None else f"{value:.1%}"

            key = self.table.insert(
                "",
                "end",
                values=(
                    row["name"] + " / " + path.parent.name,
                    percentage(overall["precision"]),
                    percentage(overall["recall"]),
                    f"{coverage['scored_frames']}/{coverage['reviewed_frames']}",
                    ", ".join(row["unsupported_classes"]) or "All tags supported",
                ),
            )
            self.rows[key] = (path, {**row, "project": payload["project"], "note": payload["note"]})
            self.table.selection_set(key)
        if str(path) not in self.saved_state.checks:
            self.saved_state.checks.append(str(path))
            self.saved_state.checks = self.saved_state.checks[-50:]

    def select_result(self, _: object = None) -> None:
        selected = self.table.selection()
        if not selected or selected[0] not in self.rows:
            return
        _, row = self.rows[selected[0]]
        freshness = ""
        try:
            doc = AnnotationDocument.model_validate_json(Path(row["project"]).read_bytes())
            measured = json.loads((Path(row["evaluation_directory"]) / "summary.json").read_bytes())
            if annotation_digest(doc) != measured["annotation_sha256"]:
                freshness = "STALE: validation labels have changed since this check. Run it again. "
        except (OSError, ValueError, KeyError):
            freshness = "Original project or evaluation unavailable. "
        self.status.set(freshness + row["note"])

    def open_selected(self) -> None:
        selected = self.table.selection()
        if selected and self.save_project():
            _, row = self.rows[selected[0]]
            self.inspect(Path(row["project"]), Path(row["run_directory"]))

    def open_folder(self) -> None:
        selected = self.table.selection()
        if selected:
            path, _ = self.rows[selected[0]]
            if os.name == "nt":
                try:
                    os.startfile(path.parent)
                except OSError as exc:
                    self.error(exc)

    def poll(self) -> None:
        if self.job is not None:
            try:
                self.append_log(self.job.read())
                code = self.job.poll()
                if code is not None and self.job.offset >= self.job.log_path.stat().st_size:
                    self.job = None
                    if code != 0:
                        raise ValueError(
                            "Model check stopped or failed. See the log for the reason; "
                            "no completed comparison was added."
                        )
                    assert self.receipt is not None
                    path = Path(json.loads(self.receipt.read_bytes())["check_result"])
                    self.add_check(path)
                    self.persist()
                    self.status.set(
                        "Validation complete. Select a result to inspect errors and correct boxes. "
                        "Training success alone is not accuracy."
                    )
            except (OSError, ValueError, KeyError, TypeError) as exc:
                if self.job is None:
                    self.error(exc)
                else:
                    self.status.set(f"Cannot read the running job log: {exc}")
        self.after(250, self.poll)
