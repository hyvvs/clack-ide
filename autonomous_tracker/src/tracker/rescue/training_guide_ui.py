from __future__ import annotations

import queue
import threading
import tkinter as tk
from functools import partial
from itertools import islice
from pathlib import Path
from tkinter import filedialog, ttk
from typing import TYPE_CHECKING

from tracker.rescue.scrollable import ScrollablePanel
from tracker.rescue.training_guide import (
    PURPOSES,
    SavedVideo,
    SetupIssue,
    StartingModel,
    discover_saved_videos,
    load_saved_video,
    setup_issues,
    starting_models,
    suggested_group,
    workspace_for,
)

if TYPE_CHECKING:
    from tracker.rescue.training_panel import TrainingPanel


class SavedVideoPicker(tk.Toplevel):
    def __init__(self, panel: TrainingPanel) -> None:
        super().__init__(panel)
        self.panel = panel
        self.title("Choose your labeled videos")
        self.geometry("920x520")
        self.minsize(700, 420)
        self.transient(panel.winfo_toplevel())
        self.search = tk.StringVar()
        self.status = tk.StringVar(value="Finding saved labels...")
        self.videos: list[SavedVideo] = []
        self.rows: dict[str, SavedVideo] = {}
        self.events: queue.Queue[list[SavedVideo] | Exception] = queue.Queue()
        self.scanning = False
        body = ttk.Frame(self, padding=16)
        body.pack(fill="both", expand=True)
        ttk.Label(body, text="Choose videos, not JSON files", font=("Segoe UI Semibold", 16)).pack(
            anchor="w"
        )
        ttk.Label(
            body,
            text="Saved boxes stay with each video. Backups and exported copies are hidden.",
            wraplength=820,
        ).pack(anchor="w", pady=6)
        ttk.Entry(body, textvariable=self.search).pack(fill="x", pady=6)
        listing = ttk.Frame(body)
        listing.pack(fill="both", expand=True)
        self.table = ttk.Treeview(
            listing,
            columns=("video", "reviewed", "location"),
            show="headings",
            selectmode="extended",
        )
        for key, title, width in (
            ("video", "Video", 230),
            ("reviewed", "Approved / total", 145),
            ("location", "Saved project location", 390),
        ):
            self.table.heading(key, text=title)
            self.table.column(key, width=width, minwidth=80)
        scrollbar = ttk.Scrollbar(listing, command=self.table.yview)
        self.table.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self.table.pack(fill="both", expand=True)
        ttk.Label(body, textvariable=self.status, wraplength=820).pack(fill="x", pady=8)
        actions = ttk.Frame(body)
        actions.pack(fill="x")
        self.add_button = ttk.Button(actions, text="Add selected videos", command=self.accept)
        self.add_button.pack(side="left")
        ttk.Button(actions, text="Look in another folder...", command=self.choose_folder).pack(
            side="left", padx=8
        )
        ttk.Button(actions, text="Cancel", command=self.destroy).pack(side="right")
        self.table.bind("<Double-1>", lambda _: self.accept())
        self.search.trace_add("write", lambda *_: self.render())
        self.scan()
        self.timer = self.after(100, self.poll)

    def destroy(self) -> None:
        if hasattr(self, "timer"):
            self.after_cancel(self.timer)
        super().destroy()

    def scan(self, folder: Path | None = None) -> None:
        if self.scanning:
            return
        self.scanning = True
        self.add_button.configure(state="disabled")
        self.status.set("Finding saved labels...")
        selected = list(self.panel.paths)
        workspace = workspace_for(self.panel.session.path)

        def work() -> None:
            try:
                if folder is None:
                    videos = discover_saved_videos(workspace, selected)
                else:
                    videos = []
                    for path in islice(folder.rglob("*.json"), 5000):
                        try:
                            videos.append(load_saved_video(path))
                        except (OSError, ValueError, TypeError):
                            continue
                self.events.put(videos)
            except Exception as exc:
                self.events.put(exc)

        threading.Thread(target=work, daemon=True).start()

    def choose_folder(self) -> None:
        if self.scanning:
            return
        folder = filedialog.askdirectory(
            title="Folder containing your saved labeling work", parent=self
        )
        if folder:
            self.scan(Path(folder))

    def poll(self) -> None:
        try:
            result = self.events.get_nowait()
        except queue.Empty:
            pass
        else:
            self.scanning = False
            self.add_button.configure(state="normal")
            if isinstance(result, Exception):
                self.status.set(f"Could not scan this folder: {result}")
            else:
                by_path = {video.path: video for video in [*self.videos, *result]}
                self.videos = sorted(
                    by_path.values(), key=lambda video: (video.title.casefold(), str(video.path))
                )
                self.render()
        self.timer = self.after(100, self.poll)

    def render(self) -> None:
        selected = {Path(path).resolve() for path in self.panel.paths}
        query = self.search.get().casefold().strip()
        self.table.delete(*self.table.get_children())
        self.rows.clear()
        included = 0
        for index, video in enumerate(self.videos):
            if video.path in selected:
                included += 1
                continue
            if query and query not in f"{video.title} {video.path}".casefold():
                continue
            key = str(index)
            self.rows[key] = video
            self.table.insert(
                "",
                "end",
                iid=key,
                values=(
                    video.title,
                    f"{video.reviewed} / {video.document.source.frame_count}",
                    str(video.path),
                ),
            )
        if not self.scanning:
            self.status.set(
                f"{len(self.rows)} available; {included} already included and hidden here. "
                + (
                    "Choose a video to add. Drafts need review before training."
                    if self.rows
                    else "No more projects here. Try another folder, "
                    "or label another video from Home."
                )
            )

    def accept(self) -> None:
        if self.scanning or not self.panel.idle():
            return
        paths = [self.rows[key].path for key in self.table.selection() if key in self.rows]
        if not paths:
            self.status.set("Select one or more videos from the list first.")
            return
        if self.panel.include_projects(paths):
            self.destroy()


class PurposeDialog(tk.Toplevel):
    def __init__(self, guide: TrainingGuide, video: SavedVideo, purpose: str) -> None:
        super().__init__(guide)
        self.guide, self.video, self.purpose = guide, video, purpose
        self.title(PURPOSES[purpose])
        self.geometry("640x430")
        self.minsize(640, 430)
        self.transient(guide.winfo_toplevel())
        self.recording = tk.StringVar(value=suggested_group(video, guide.videos))
        self.status = tk.StringVar()
        body = ttk.Frame(self, padding=18)
        body.pack(fill="both", expand=True)
        ttk.Label(
            body, text=f"{video.title}: {PURPOSES[purpose]}", wraplength=580, style="Accent.TLabel"
        ).pack(anchor="w")
        ttk.Label(
            body, text="Which recording or event is this from?", font=("Segoe UI Semibold", 12)
        ).pack(anchor="w", pady=(14, 6))
        groups = sorted(
            {
                item.document.incident_id
                for item in guide.videos
                if item.document.incident_id.strip()
            }
        )
        ttk.Combobox(body, textvariable=self.recording, values=groups).pack(fill="x")
        ttk.Label(
            body,
            text="Keep the suggested name for an independent recording. If these videos show "
            "the same event (including different cameras), choose the same event name. "
            "Cuts from one source are checked automatically.",
            wraplength=580,
        ).pack(fill="x", pady=10)
        ttk.Label(body, textvariable=self.status, wraplength=580).pack(fill="x")
        actions = ttk.Frame(body)
        actions.pack(side="bottom", fill="x")
        ttk.Button(actions, text="Save purpose", command=self.save).pack(side="left")
        ttk.Button(actions, text="Cancel", command=self.destroy).pack(side="right")

    def save(self) -> None:
        error = self.guide.panel.set_purpose(self.video.path, self.purpose, self.recording.get())
        if error:
            self.status.set(error)
        else:
            self.destroy()


class TrainingGuide(ttk.Frame):
    def __init__(self, parent: ttk.Notebook, panel: TrainingPanel) -> None:
        super().__init__(parent, padding=10)
        self.panel = panel
        self.videos: list[SavedVideo] = []
        self.issues: list[SetupIssue] = []
        self.step = 0
        self.summary = tk.StringVar()
        self.selected_label = tk.StringVar(value="Select a video below to choose its purpose.")
        self.check_summary = tk.StringVar()
        self.model_summary = tk.StringVar()
        self.model_choice = tk.StringVar()
        self.model_hint = tk.StringVar()
        self.models: list[StartingModel] = []
        self.pages: list[ScrollablePanel] = []
        self.dialog: tk.Toplevel | None = None
        steps = ttk.Frame(self)
        steps.pack(fill="x", pady=(0, 8))
        self.steps = []
        for index, title in enumerate(
            ("1  Choose videos", "2  Check and prepare", "3  Train model")
        ):
            button = ttk.Button(steps, text=title, command=partial(self.navigate, index))
            button.pack(side="left", padx=(0, 8))
            self.steps.append(button)
        for _ in range(3):
            self.pages.append(ScrollablePanel(self))
        self._videos_page(self.pages[0].body)
        self._checks_page(self.pages[1].body)
        self._train_page(self.pages[2].body)
        panel.weights.trace_add("write", lambda *_: self.update_model())
        for variable in (panel.epochs, panel.device, panel.batch, panel.image_size):
            variable.trace_add("write", lambda *_: self.update_model())
        self.show_step(0)

    def _videos_page(self, body: ttk.Frame) -> None:
        ttk.Label(
            body, text="Your saved labels are already here", font=("Segoe UI Semibold", 17)
        ).pack(anchor="w")
        ttk.Label(body, textvariable=self.summary, wraplength=900).pack(fill="x", pady=8)
        bar = ttk.Frame(body)
        bar.pack(fill="x", pady=6)
        ttk.Button(bar, text="Add labeled videos...", command=self.panel.add_projects).pack(
            side="left"
        )
        ttk.Button(bar, text="Refresh saved work", command=self.panel.refresh).pack(
            side="left", padx=8
        )
        ttk.Button(bar, text="Remove from training list", command=self.remove_selected).pack(
            side="left"
        )
        listing = ttk.Frame(body)
        listing.pack(fill="x", pady=8)
        self.table = ttk.Treeview(
            listing,
            columns=("video", "purpose", "reviewed"),
            show="headings",
            height=5,
            selectmode="browse",
        )
        for key, title, width in (
            ("video", "Video", 300),
            ("purpose", "How it will be used", 240),
            ("reviewed", "Approved frames / total", 200),
        ):
            self.table.heading(key, text=title)
            self.table.column(key, width=width, minwidth=100)
        scrollbar = ttk.Scrollbar(listing, command=self.table.yview)
        self.table.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self.table.pack(fill="x", expand=True)
        self.table.bind("<<TreeviewSelect>>", lambda _: self.select())
        ttk.Label(
            body, textvariable=self.selected_label, style="Accent.TLabel", wraplength=900
        ).pack(fill="x", pady=6)
        purposes = ttk.Frame(body)
        purposes.pack(fill="x")
        self.purpose_buttons = []
        for purpose in ("training", "validation", "test"):
            button = ttk.Button(
                purposes,
                text=PURPOSES[purpose],
                command=partial(self.choose_purpose, purpose),
            )
            button.pack(side="left", padx=(0, 8))
            self.purpose_buttons.append(button)
        ttk.Label(
            body,
            text="Teach: examples the model learns from. Check: a different recording used "
            "to measure progress. Final test: optional footage kept aside until you finish "
            "choosing a model.",
            wraplength=900,
            style="Muted.TLabel",
        ).pack(fill="x", pady=10)
        ttk.Button(body, text="Continue to checks", command=self.checks).pack(anchor="e", pady=6)

    def _checks_page(self, body: ttk.Frame) -> None:
        ttk.Label(body, text="Let's check what is ready", font=("Segoe UI Semibold", 17)).pack(
            anchor="w"
        )
        ttk.Label(body, textvariable=self.check_summary, wraplength=900).pack(fill="x", pady=10)
        self.issue_list = ttk.Frame(body)
        self.issue_list.pack(fill="x")
        ttk.Label(
            body,
            text="Only frames you have approved will be used. Draft boxes and machine "
            "suggestions are never approved automatically. Original videos and labels are kept.",
            wraplength=900,
            style="Muted.TLabel",
        ).pack(fill="x", pady=10)
        self.prepare_button = ttk.Button(body, text="Prepare training data", command=self.prepare)
        self.prepare_button.pack(anchor="w", pady=6)
        ttk.Label(body, textvariable=self.panel.export_status, wraplength=900).pack(
            fill="x", pady=8
        )
        self.continue_button = ttk.Button(
            body, text="Continue to training", command=lambda: self.show_step(2)
        )
        self.continue_button.pack(anchor="e", pady=6)

    def _train_page(self, body: ttk.Frame) -> None:
        ttk.Label(body, text="Train a new model", font=("Segoe UI Semibold", 17)).pack(anchor="w")
        ttk.Label(body, textvariable=self.model_summary, wraplength=900).pack(fill="x", pady=12)
        saved_models = ttk.Frame(body)
        saved_models.pack(fill="x", pady=6)
        self.model_box = ttk.Combobox(
            saved_models, textvariable=self.model_choice, state="readonly"
        )
        self.model_box.pack(side="left", fill="x", expand=True)
        ttk.Button(saved_models, text="Use selected model", command=self.use_model).pack(
            side="left", padx=8
        )
        ttk.Button(body, text="Or choose a model file...", command=self.panel.choose_weights).pack(
            anchor="w"
        )
        ttk.Label(body, textvariable=self.model_hint, wraplength=900).pack(fill="x", pady=6)
        ttk.Label(
            body,
            text="Use a model file (.pt) from a source you trust. Nothing is downloaded "
            "automatically. Model files can run code when loaded.",
            wraplength=900,
            style="Muted.TLabel",
        ).pack(fill="x", pady=10)
        ttk.Label(body, textvariable=self.panel.export_status, wraplength=900).pack(
            fill="x", pady=8
        )
        actions = ttk.Frame(body)
        actions.pack(fill="x", pady=8)
        self.start_button = ttk.Button(actions, text="Start training...", command=self.panel.start)
        self.start_button.pack(side="left")
        ttk.Button(actions, text="Stop training", command=self.panel.stop).pack(side="left", padx=8)
        ttk.Button(actions, text="Adjust training settings", command=self.panel.show_advanced).pack(
            side="left"
        )
        ttk.Label(
            body,
            text="The new model is saved separately. When training finishes, Studio opens "
            "Compare models so you can check its results before choosing to use it.",
            wraplength=900,
            style="Muted.TLabel",
        ).pack(fill="x", pady=10)
        ttk.Button(body, text="Back to checks", command=self.checks).pack(anchor="w")

    def show_step(self, index: int) -> None:
        self.step = index
        for number, page in enumerate(self.pages):
            page.pack_forget()
            self.steps[number].state(["disabled"] if number == index else ["!disabled"])
        self.pages[index].pack(fill="both", expand=True)
        self.update_model()

    def checks(self) -> None:
        self.panel.refresh()
        self.show_step(1)

    def navigate(self, index: int) -> None:
        self.panel.refresh()
        self.show_step(index)

    def selected_path(self) -> Path | None:
        selected = self.table.selection()
        return Path(selected[0]) if selected else None

    def select(self) -> None:
        path = self.selected_path()
        video = next((item for item in self.videos if item.path == path), None)
        self.selected_label.set(
            f"Selected: {video.title}. Choose its purpose below."
            if video
            else "Select a video above."
        )
        for button in self.purpose_buttons:
            button.configure(state="normal" if video else "disabled")

    def choose_purpose(self, purpose: str) -> None:
        if not self.panel.idle() or not self.panel.save_project():
            return
        path = self.selected_path()
        if path is None:
            return
        if self.dialog is not None and self.dialog.winfo_exists():
            return
        try:
            video = load_saved_video(path)
            self.dialog = PurposeDialog(self, video, purpose)
        except (OSError, ValueError) as exc:
            self.panel.error(exc)

    def remove_selected(self) -> None:
        path = self.selected_path()
        if path and self.panel.idle():
            self.panel.paths = [item for item in self.panel.paths if item.resolve() != path]
            self.panel.refresh()
            self.panel.status.set(
                "Removed from this training selection only. Saved boxes and video were not deleted."
            )

    def render(self) -> None:
        selected = self.selected_path()
        self.videos = []
        errors = []
        self.table.delete(*self.table.get_children())
        for path in self.panel.paths:
            path = path.resolve()
            try:
                video = load_saved_video(path)
                self.videos.append(video)
                values = (
                    video.title,
                    PURPOSES[video.document.split],
                    f"{video.reviewed} / {video.document.source.frame_count}",
                )
            except (OSError, ValueError) as exc:
                values = (path.name, "Unavailable", "")
                errors.append(
                    SetupIssue(
                        f"{path.name}: {exc}. Remove it from the list or locate its live project.",
                        "videos",
                        path,
                    )
                )
            self.table.insert("", "end", iid=str(path), values=values)
        children = self.table.get_children()
        preferred = str(selected or self.panel.session.path.resolve())
        if children:
            self.table.selection_set(preferred if preferred in children else children[0])
        self.select()
        current_included = self.panel.session.path.resolve() in {
            path.resolve() for path in self.panel.paths
        }
        self.summary.set(
            f"{len(self.panel.paths)} videos selected; "
            f"{sum(video.reviewed for video in self.videos)} approved frames. "
            + (
                "The open project is included. No need to find or add its file again."
                if current_included
                else "The open project is not included. Add it from labeled videos if needed."
            )
        )
        self.issues = [*errors, *setup_issues(self.videos)]
        for child in self.issue_list.winfo_children():
            child.destroy()
        for issue in self.issues:
            row = ttk.Frame(self.issue_list)
            row.pack(fill="x", pady=6)
            ttk.Label(row, text=issue.message, wraplength=680).pack(
                side="left", fill="x", expand=True
            )
            ttk.Button(
                row,
                text="Review labels"
                if issue.action == "review"
                else "Match tags"
                if issue.action == "tags"
                else "Choose videos",
                command=partial(self.fix, issue),
            ).pack(side="right", padx=8)
        self.check_summary.set(
            f"{len(self.issues)} things to finish before preparing training data:"
            if self.issues
            else "Ready to prepare. The required saved-label checks passed. "
            "This is not a guarantee of detection quality."
        )
        self.update_availability()
        try:
            self.models = starting_models(workspace_for(self.panel.session.path))
            self.model_box.configure(
                values=[f"{index + 1}. {model.name}" for index, model in enumerate(self.models)]
            )
            if self.models and not 0 <= self.model_box.current() < len(self.models):
                self.model_box.current(0)
            self.model_hint.set(
                "Choose a saved model by name, then click Use selected model."
                if self.models
                else "No saved models in this workspace yet. Choose a trusted model file to start."
            )
        except (OSError, ValueError) as exc:
            self.models = []
            self.model_box.configure(values=[])
            self.model_hint.set(
                f"Saved model list unavailable: {exc}. You can choose a trusted model file."
            )

    def use_model(self) -> None:
        index = self.model_box.current()
        if not 0 <= index < len(self.models):
            self.model_hint.set("Choose a saved model, or use 'Or choose a model file...'.")
            return
        self.panel.use_saved_model(self.models[index])

    def fix(self, issue: SetupIssue) -> None:
        if issue.action == "tags":
            self.panel.edit_tags()
        elif issue.action == "review":
            if issue.path is None or issue.path == self.panel.session.path.resolve():
                self.panel.review_current()
            else:
                self.panel.review_project(issue.path)
        else:
            self.show_step(0)
            if issue.path and self.table.exists(str(issue.path)):
                self.table.selection_set(str(issue.path))
                self.table.see(str(issue.path))
                self.select()

    def prepare(self) -> None:
        self.panel.export(default_location=True)

    def update_model(self) -> None:
        model = (
            Path(self.panel.weights.get()).name if self.panel.weights.get() else "Not chosen yet"
        )
        device = (
            "this computer's CPU"
            if self.panel.device.get() == "cpu"
            else "GPU " + self.panel.device.get()
        )
        self.model_summary.set(
            f"Starting model: {model}\nTraining: {self.panel.epochs.get()} passes through "
            f"the examples on {device}. Advanced settings remain available."
        )
        if hasattr(self, "start_button"):
            self.update_availability()

    def update_availability(self) -> None:
        idle = not self.panel.busy
        ready = bool(self.panel.dataset.get()) and self.panel.export_is_current
        self.prepare_button.configure(state="normal" if idle and not self.issues else "disabled")
        self.continue_button.configure(state="normal" if idle and ready else "disabled")
        self.start_button.configure(
            state="normal"
            if idle and ready and Path(self.panel.weights.get()).is_file()
            else "disabled"
        )
