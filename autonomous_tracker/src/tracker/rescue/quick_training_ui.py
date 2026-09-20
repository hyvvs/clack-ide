from __future__ import annotations

import json
import os
import queue
import re
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk
from typing import TYPE_CHECKING
from uuid import uuid4

from tracker.cli.rescue_train import TrainingSettings
from tracker.rescue.desktop_jobs import DesktopJob
from tracker.rescue.managed_models import (
    ModelSync,
    model_available,
    model_folder,
    sync_trained_models,
)
from tracker.rescue.model_library import ModelLibrary
from tracker.rescue.practice_training import practice_plan
from tracker.rescue.prediction_preview import PredictionPreview
from tracker.rescue.saved_models_ui import SavedModelsList
from tracker.rescue.scrollable import ScrollablePanel
from tracker.rescue.training_guide import StartingModel, starting_models, workspace_for
from tracker.rescue.training_workflow import completed_training

if TYPE_CHECKING:
    from tracker.rescue.training_panel import TrainingPanel


class QuickTrainingPanel(ScrollablePanel):
    def __init__(self, parent: ttk.Notebook, panel: TrainingPanel) -> None:
        super().__init__(parent)
        self.panel = panel
        self.job: DesktopJob | None = None
        self.kind = ""
        self.receipt: Path | None = None
        self.preview_output: Path | None = None
        self.preview_model_id = ""
        self.preview_window: PredictionPreview | None = None
        self.models: list[StartingModel] = []
        self.ready = False
        self.result_ready = False
        workspace = workspace_for(panel.session.path)
        self.workspace = (
            workspace
            if panel.session.path.resolve().is_relative_to(workspace.resolve())
            else panel.session.path.resolve().parent
        )
        self.library_busy = False
        self.saving_model = False
        self.pending_result: Path | None = None
        self.model_events: queue.Queue[ModelSync | Exception] = queue.Queue()
        self.library_status = tk.StringVar(value="Finding your saved models...")
        self.summary = tk.StringVar()
        self.model_label = tk.StringVar()
        self.model_choice = tk.StringVar()
        self.result_label = tk.StringVar(
            value="No model trained here yet. Your labels are ready when you are."
        )
        body = ttk.Frame(self.body, padding=18)
        body.pack(fill="both", expand=True)
        ttk.Label(body, text="Train using your labels", font=("Segoe UI Semibold", 20)).pack(
            anchor="w"
        )
        ttk.Label(body, textvariable=self.summary, wraplength=840).pack(fill="x", pady=(12, 8))
        ttk.Label(body, textvariable=self.model_label, wraplength=840, style="Muted.TLabel").pack(
            fill="x", pady=8
        )
        actions = ttk.Frame(body)
        actions.pack(fill="x", pady=12)
        self.train_button = ttk.Button(
            actions, text="Train using these labels", command=self.train, style="Carry.TButton"
        )
        self.train_button.pack(side="left")
        self.stop_button = ttk.Button(actions, text="Stop", command=self.stop, state="disabled")
        self.stop_button.pack(side="left", padx=8)
        ttk.Button(
            body, text="Change starting model or settings", command=self.toggle_settings
        ).pack(anchor="w")
        self.settings = ttk.LabelFrame(body, text="Optional settings", padding=10)
        self.model_box = ttk.Combobox(
            self.settings, textvariable=self.model_choice, state="readonly"
        )
        self.model_box.pack(fill="x", pady=4)
        self.model_box.bind("<<ComboboxSelected>>", self.choose_saved_model)
        ttk.Button(
            self.settings,
            text="Choose a different model file...",
            command=self.panel.choose_weights,
        ).pack(anchor="w", pady=4)
        ttk.Button(
            self.settings, text="Training settings...", command=self.panel.show_advanced
        ).pack(anchor="w", pady=4)
        self.model_separator = ttk.Separator(body)
        self.model_separator.pack(fill="x", pady=16)
        ttk.Label(body, text="My models", font=("Segoe UI Semibold", 16)).pack(anchor="w")
        ttk.Label(
            body,
            text="Completed models appear here automatically. Select a row to try it. "
            "Your default model is not changed by selecting a row.",
            wraplength=840,
        ).pack(fill="x", pady=6)
        self.shelf = SavedModelsList(body, self.select_model)
        self.shelf.pack(fill="both", expand=True, pady=6)
        full_actions = ttk.Frame(body)
        full_actions.pack(fill="x", pady=8)
        self.analyze_button = ttk.Button(
            full_actions,
            text="Analyze entire video and correct boxes",
            style="Carry.TButton",
            command=self.analyze_video,
        )
        self.analyze_button.pack(side="left")
        self.analyze_other_button = ttk.Button(
            full_actions,
            text="Analyze another video...",
            command=lambda: self.analyze_video(other=True),
        )
        self.analyze_other_button.pack(side="left", padx=6)
        ttk.Label(
            body,
            text="Full video -> editable boxes -> your corrections -> updated model. "
            "Not limited to a preview. No automatic approvals.",
            wraplength=840,
        ).pack(fill="x")
        library_actions = ttk.Frame(body)
        library_actions.pack(fill="x", pady=4)
        self.rename_button = ttk.Button(
            library_actions, text="Rename...", command=self.rename_model
        )
        self.rename_button.pack(side="left")
        self.folder_button = ttk.Button(
            library_actions, text="Open model folder", command=self.open_model_folder
        )
        self.folder_button.pack(side="left", padx=6)
        ttk.Button(library_actions, text="Refresh models", command=self.refresh_models).pack(
            side="left"
        )
        ttk.Label(body, textvariable=self.library_status, wraplength=840).pack(fill="x", pady=4)
        ttk.Label(body, textvariable=self.result_label, wraplength=840).pack(fill="x", pady=8)
        result_actions = ttk.Frame(body)
        result_actions.pack(fill="x", pady=6)
        self.try_button = ttk.Button(
            result_actions, text="Quick preview (300 frames)", command=self.try_model
        )
        self.try_button.pack(side="left")
        self.other_button = ttk.Button(
            result_actions,
            text="Quick preview another video...",
            command=lambda: self.try_model(other=True),
        )
        self.other_button.pack(side="left", padx=8)
        self.replay_button = ttk.Button(
            result_actions, text="Open last preview", command=self.open_preview
        )
        self.replay_button.pack(side="left")
        self.retrain_button = ttk.Button(
            body, text="Train updated version...", command=self.train_selected
        )
        self.retrain_button.pack(anchor="w", pady=6)
        ttk.Label(
            body,
            text="Practice models are NOT INDEPENDENTLY TESTED. You can try their predictions "
            "now and check reliability on separate footage later. Your saved boxes and "
            "the active model are not replaced.",
            wraplength=840,
            style="Muted.TLabel",
        ).pack(fill="x", pady=14)
        for variable in (panel.weights, panel.epochs, panel.device):
            variable.trace_add("write", lambda *_: self.update_model())
        self.timer = self.after(200, self.poll)
        self.discovery_timer = self.after_idle(self.refresh_models)

    @property
    def busy(self) -> bool:
        return self.job is not None or self.saving_model

    def refresh_models(self, result: Path | None = None) -> None:
        if result is not None:
            self.pending_result = result
            self.saving_model = True
        if self.library_busy:
            return
        self.library_busy = True
        self.library_status.set("Finding and saving your completed models...")
        known = tuple(
            Path(p)
            for p in (
                self.panel.saved_state.quick_result,
                self.panel.saved_state.training_result,
                str(self.pending_result) if self.pending_result else "",
            )
            if p
        )

        def work() -> None:
            try:
                self.model_events.put(sync_trained_models(self.workspace, known))
            except Exception as exc:
                self.model_events.put(exc)

        threading.Thread(target=work, daemon=True).start()

    def select_model(self) -> None:
        if self.job is not None:
            identity = self.panel.saved_state.quick_model_id
            if (
                identity
                and self.shelf.table.exists(identity)
                and self.shelf.table.selection() != (identity,)
            ):
                self.shelf.table.selection_set(identity)
            return
        version = self.shelf.selected()
        if version is not None:
            state = self.panel.saved_state
            if not state.quick_preview_model_id and state.quick_result == version.training_result:
                state.quick_preview_model_id = version.id
            state.quick_model_id = version.id
            state.quick_result = version.training_result
            self.panel.persist()
        self.update_result()
        self.update_buttons()

    def rename_model(self) -> None:
        version = self.shelf.selected()
        if version is None or not self.panel.idle() or self.library_busy:
            return
        name = simpledialog.askstring(
            "Rename model", "Name shown in My models:", initialvalue=version.name, parent=self
        )
        if name:
            try:
                library = ModelLibrary(self.workspace)
                library.rename(version.id, name)
                self.shelf.render(library, version.id)
                self.render()
            except (OSError, ValueError) as exc:
                self.panel.error(exc)

    def open_model_folder(self) -> None:
        version = self.shelf.selected()
        if version is not None:
            try:
                folder = model_folder(version)
                if not folder.is_dir():
                    raise ValueError("This model's folder is missing.")
                os.startfile(folder)
            except (OSError, ValueError) as exc:
                self.panel.error(exc)

    def train_selected(self) -> None:
        version = self.shelf.selected()
        if version is not None and self.panel.idle():
            if len(version.config.models) != 1:
                self.panel.status.set("Choose one starting model under Optional settings.")
                return
            self.panel.weights.set(version.config.models[0].weights)
            self.train()

    def analyze_video(self, *, other: bool = False) -> None:
        version = self.shelf.selected()
        if version is None or not self.panel.idle() or not self.panel.save_project():
            return
        video = self.panel.session.document.source.path
        if other:
            video = filedialog.askopenfilename(
                title="Choose the video to analyze and correct",
                filetypes=[("Videos", "*.mp4 *.avi *.mov *.mkv *.webm")],
                parent=self,
            )
            if not video:
                return
        if not messagebox.askyesno(
            "Analyze the entire video?",
            f"Use {version.name} on every frame of {Path(video).name}?\n\n"
            "Studio will open editable draft boxes when it finishes. Your existing labels are "
            "preserved. Correct and approve examples, then train an updated version. "
            "Long videos can take time; Stop is available.",
            parent=self,
        ):
            return
        try:
            output = self.workspace / "diagnostics/rescue-corrections" / uuid4().hex[:12]
            self.receipt = output / "corrections.json"
            args = [
                "--workspace",
                str(self.workspace),
                "--video",
                video,
                "--model-id",
                version.id,
                "--output",
                str(output),
                "--result-file",
                str(self.receipt),
            ]
            if Path(video).resolve() == Path(self.panel.session.document.source.path).resolve():
                args.extend(["--project", str(self.panel.session.path.resolve())])
            self.job = DesktopJob(
                self.workspace, "tracker.cli.rescue_correct", args, stoppable=True
            )
            self.kind = "correction"
            self.panel.status.set(
                "Analyzing the entire video. Editable boxes will open automatically."
            )
            self.update_buttons()
        except (OSError, ValueError) as exc:
            self.panel.error(exc)

    def toggle_settings(self) -> None:
        if self.settings.winfo_manager():
            self.settings.pack_forget()
        else:
            self.settings.pack(fill="x", pady=10, before=self.model_separator)

    def render(self) -> None:
        doc = self.panel.session.document
        try:
            plan = practice_plan(doc)
            self.summary.set(
                f"{Path(doc.source.path).name}\n{plan.reviewed_frames:,} approved frames, "
                f"{plan.boxes:,} boxes. Studio will prepare the files and train a separate model.\n"
                + (
                    f"Unused tags left out of this run: {', '.join(plan.unused)}. "
                    "Your project is unchanged."
                    if plan.unused
                    else "No extra video or dataset setup is needed to start."
                )
            )
            self.ready = True
        except ValueError as exc:
            self.ready = False
            self.summary.set(str(exc))
        try:
            self.models = starting_models(self.workspace)
            if not self.models and self.workspace != workspace_for(self.panel.session.path):
                self.models = starting_models(workspace_for(self.panel.session.path))
            self.model_box.configure(
                values=[f"{index + 1}. {model.name}" for index, model in enumerate(self.models)]
            )
            if not self.panel.weights.get() and self.models:
                self.panel.weights.set(str(self.models[0].weights))
            for index, model in enumerate(self.models):
                if str(model.weights) == self.panel.weights.get():
                    self.model_box.current(index)
                    break
        except (OSError, ValueError) as exc:
            self.models = []
            self.model_label.set(f"Saved models unavailable: {exc}. Choose a trusted model file.")
        self.update_model()
        self.update_result()
        self.update_buttons()

    def update_model(self) -> None:
        path = self.panel.weights.get()
        name = next(
            (model.name for model in self.models if str(model.weights) == path),
            Path(path).name if path else "Choose a starting model once",
        )
        self.model_label.set(
            f"Starting model: {name}\n{self.panel.epochs.get()} training passes on "
            f"{'CPU' if self.panel.device.get() == 'cpu' else 'GPU'}. "
            "CPU training can take a while."
        )
        if hasattr(self, "train_button"):
            self.update_buttons()

    def choose_saved_model(self, _: object = None) -> None:
        index = self.model_box.current()
        if 0 <= index < len(self.models) and self.panel.idle():
            self.panel.weights.set(str(self.models[index].weights))
            self.panel.persist()

    def train(self) -> None:
        if not self.panel.idle() or not self.panel.save_project():
            return
        try:
            self.render()
            plan = practice_plan(self.panel.session.document)
            weights = Path(self.panel.weights.get())
            if not weights.is_file() or weights.suffix.casefold() != ".pt":
                self.panel.status.set(
                    "Choose a trusted starting model under Change starting model or settings."
                )
                if not self.settings.winfo_manager():
                    self.toggle_settings()
                return
            settings = TrainingSettings(
                epochs=int(self.panel.epochs.get()),
                image_size=int(self.panel.image_size.get()),
                batch=int(self.panel.batch.get()),
                device=self.panel.device.get(),
            )
            if not messagebox.askyesno(
                "Train using these labels?",
                f"Use {plan.reviewed_frames:,} approved frames to train a new practice model?\n\n"
                f"{self.model_label.get()}\n"
                "Studio will prepare everything automatically. Existing boxes, approvals "
                "and the active model stay unchanged.\n\n"
                "This model will be NOT INDEPENDENTLY TESTED. Only continue with trusted model "
                "files and footage you have permission to use. Model files can execute code.",
                parent=self,
            ):
                return
            output = self.panel.session.path.parent / "training"
            output.mkdir(exist_ok=True)
            self.receipt = output / f"quick-{uuid4().hex[:12]}.json"
            args = [
                "--project",
                str(self.panel.session.path.resolve()),
                "--project-sha256",
                str(self.panel.session.disk_hash),
                "--weights",
                str(weights.resolve()),
                "--output",
                str(output.resolve()),
                "--result-file",
                str(self.receipt),
                "--epochs",
                str(settings.epochs),
                "--image-size",
                str(settings.image_size),
                "--batch",
                str(settings.batch),
                "--device",
                settings.device,
            ]
            model = next(
                (model for model in self.models if model.weights.resolve() == weights.resolve()),
                None,
            )
            if model is not None and model.sha256:
                args.extend(["--weights-sha256", model.sha256])
            self.job = DesktopJob(
                workspace_for(self.panel.session.path),
                "tracker.cli.rescue_quick_train",
                args,
                stoppable=True,
            )
            self.kind = "training"
            self.panel.persist()
            self.panel.status.set("Preparing your approved labels, then training automatically...")
            self.update_buttons()
        except (OSError, ValueError) as exc:
            self.panel.error(exc)

    def try_model(self, *, other: bool = False) -> None:
        if not self.panel.idle():
            return
        try:
            version = self.shelf.selected()
            self.preview_model_id = version.id if version else ""
            config = (
                str(ModelLibrary(self.workspace).config_path(version.id))
                if version
                else completed_training(Path(self.panel.saved_state.quick_result))["review_config"]
            )
            video = self.panel.session.document.source.path
            if other:
                video = filedialog.askopenfilename(
                    title="Choose a video to preview predictions",
                    filetypes=[("Videos", "*.mp4 *.avi *.mov *.mkv *.webm")],
                    parent=self,
                )
                if not video:
                    return
            self.preview_output = (
                (
                    model_folder(version)
                    if version
                    else Path(self.panel.saved_state.quick_result).parent
                )
                / "previews"
                / uuid4().hex[:12]
            )
            args = [
                "--video",
                video,
                "--config",
                config,
                "--output",
                str(self.preview_output),
                "--max-frames",
                "300",
            ]
            self.job = DesktopJob(
                self.workspace,
                "tracker.cli.rescue_review",
                args,
                stoppable=True,
            )
            self.kind = "preview"
            self.panel.status.set(
                "Generating predictions for the first 300 frames. "
                "No labels or accuracy scores will be created."
            )
            self.update_buttons()
        except (OSError, ValueError, KeyError, TypeError) as exc:
            self.panel.error(exc)

    def open_preview(self) -> None:
        try:
            library = ModelLibrary(self.workspace)
            name = next(
                (
                    v.name
                    for v in library.catalog.versions
                    if v.id == self.panel.saved_state.quick_preview_model_id
                ),
                "Model preview",
            )
            self.preview_window = PredictionPreview(
                self, Path(self.panel.saved_state.quick_preview), name
            )
        except (OSError, ValueError) as exc:
            self.panel.error(exc)

    def update_result(self) -> None:
        self.result_ready = False
        version = self.shelf.selected()
        if version is not None:
            self.result_ready = model_available(version)
            self.result_label.set(
                f"Selected: {version.name}\n"
                + (
                    "NOT INDEPENDENTLY TESTED. Try its predictions without changing your labels."
                    if self.result_ready
                    else "Model files are missing. Other saved versions are unchanged."
                )
            )
            return
        if not self.panel.saved_state.quick_result:
            return
        try:
            completed_training(Path(self.panel.saved_state.quick_result))
            self.result_ready = True
            self.result_label.set(
                "Practice model ready. NOT INDEPENDENTLY TESTED.\n"
                "Try its predictions without changing your labels."
            )
        except (OSError, ValueError, KeyError, TypeError):
            self.result_label.set(
                "The last training result is unavailable. Your original labels are still saved."
            )

    def update_buttons(self) -> None:
        idle = not self.panel.busy
        self.shelf.table.configure(selectmode="browse" if idle else "none")
        self.train_button.configure(state="normal" if idle and self.ready else "disabled")
        self.stop_button.configure(state="normal" if self.job is not None else "disabled")
        for button in (
            self.try_button,
            self.other_button,
            self.analyze_button,
            self.analyze_other_button,
        ):
            button.configure(state="normal" if idle and self.result_ready else "disabled")
        self.replay_button.configure(
            state="normal"
            if idle
            and bool(self.panel.saved_state.quick_preview)
            and (
                not self.panel.saved_state.quick_model_id
                or self.panel.saved_state.quick_model_id
                == self.panel.saved_state.quick_preview_model_id
            )
            else "disabled"
        )
        for button in (self.rename_button, self.folder_button):
            button.configure(state="normal" if idle and self.shelf.selected() else "disabled")
        self.retrain_button.configure(
            state="normal" if idle and self.ready and self.result_ready else "disabled"
        )

    def stop(self) -> None:
        if self.job is not None:
            if self.job.stop_file.exists():
                if messagebox.askyesno(
                    "Force stop?",
                    "Stop this job immediately? Its latest output may be incomplete. "
                    "Saved labels will not change.",
                    parent=self,
                ):
                    self.job.process.terminate()
            else:
                self.job.stop()
                self.panel.status.set(
                    "Stop requested. Waiting for the current operation to finish."
                )

    def poll(self) -> None:
        if self.job is not None:
            try:
                chunk = self.job.read()
                if chunk:
                    self.panel.append_log(chunk)
                    matches = re.findall(r"STUDIO_PROGRESS (\d+)/(\d+)", chunk)
                    messages = re.findall(r"STUDIO_STATUS ([^\r\n]+)", chunk)
                    analyzed = re.findall(r"STUDIO_VIDEO_PROGRESS (\d+)", chunk)
                    if matches:
                        current, total = matches[-1]
                        self.panel.status.set(
                            f"Training pass {current} of {total} completed. "
                            "Saving a separate practice model."
                        )
                    elif messages:
                        self.panel.status.set(messages[-1])
                    elif analyzed:
                        self.panel.status.set(
                            f"Analyzed {int(analyzed[-1]):,} frames. "
                            "Continuing to the end of the video..."
                        )
                code = self.job.poll()
                if code is not None and self.job.offset >= self.job.log_path.stat().st_size:
                    stopped = self.job.stop_file.exists()
                    log = self.job.log_path
                    self.job = None
                    if code or stopped:
                        self.panel.status.set(
                            f"Job {'stopped' if stopped else 'failed'}. Your labels were not "
                            f"changed. Details in Advanced. Log: {log}"
                        )
                    elif self.kind == "correction":
                        assert self.receipt is not None
                        receipt = json.loads(self.receipt.read_bytes())
                        self.panel.correct_run(
                            Path(receipt["project"]), Path(receipt["run"]), receipt["model_id"]
                        )
                        self.panel.status.set(
                            "Analysis complete. Correct boxes in Label video, "
                            "then use Save and train updated model."
                        )
                    elif self.kind == "training":
                        assert self.receipt is not None
                        result = Path(json.loads(self.receipt.read_bytes())["training_result"])
                        completed_training(result)
                        self.panel.saved_state.quick_result = str(result)
                        self.panel.saved_state.quick_preview = ""
                        self.panel.check_panel.set_training(result)
                        self.panel.persist()
                        self.refresh_models(result)
                        self.panel.status.set(
                            "Training finished. Saving it in My models. Not independently tested."
                        )
                    else:
                        assert self.preview_output is not None
                        results = list(self.preview_output.glob("review-*/summary.json"))
                        if len(results) != 1 or json.loads(results[0].read_bytes())[
                            "status"
                        ] not in {"completed", "frame_limit_reached"}:
                            raise ValueError(
                                "Preview did not finish. See Advanced for the job log."
                            )
                        self.panel.saved_state.quick_preview = str(
                            results[0].parent / "annotated.mp4"
                        )
                        self.panel.saved_state.quick_preview_model_id = self.preview_model_id
                        self.panel.persist()
                        self.panel.status.set(
                            "Preview ready. These are predictions, not approved labels "
                            "or independent test results."
                        )
                        self.open_preview()
            except (OSError, ValueError, KeyError, TypeError) as exc:
                self.panel.status.set(
                    f"Job output could not be read: {exc}. See Advanced for details."
                )
        try:
            event = self.model_events.get_nowait()
        except queue.Empty:
            pass
        else:
            self.library_busy = False
            if isinstance(event, Exception):
                self.saving_model = False
                self.library_status.set(
                    f"Models could not be refreshed: {event}. Click Refresh models to retry."
                )
            else:
                state = self.panel.saved_state
                desired = str(self.pending_result) if self.pending_result else state.quick_result
                match = next(
                    (v for v in event.library.catalog.versions if v.training_result == desired),
                    None,
                )
                if self.pending_result is not None and match is None and not event.warnings:
                    self.refresh_models()
                else:
                    self.pending_result = None
                    self.saving_model = False
                    self.shelf.render(event.library, match.id if match else state.quick_model_id)
                    self.library_status.set(
                        f"{len(event.library.catalog.versions)} saved models. "
                        "Completed models are saved automatically."
                        if event.library.catalog.versions
                        else "No completed models yet. Train using your labels above."
                    )
                    if event.warnings:
                        self.library_status.set(
                            "Some models could not be added. Your originals are safe. "
                            "Refresh to retry."
                        )
                        self.panel.append_log("\n".join(event.warnings))
                    self.render()
        self.update_buttons()
        self.timer = self.after(200, self.poll)

    def destroy(self) -> None:
        self.after_cancel(self.timer)
        self.after_cancel(self.discovery_timer)
        super().destroy()
