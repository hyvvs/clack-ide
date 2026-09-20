from __future__ import annotations

import os
import queue
import re
import threading
import tkinter as tk
import webbrowser
from collections.abc import Callable
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk
from typing import Any
from uuid import uuid4

import cv2

from tracker.rescue.annotations import AnnotationDocument, AnnotationSession
from tracker.rescue.batch_ui import BatchWindow
from tracker.rescue.desktop_jobs import DesktopJob
from tracker.rescue.library import Library, LibraryItem, discover_library, local_review_config
from tracker.rescue.media import FrameReader
from tracker.rescue.model_library import ModelLibrary
from tracker.rescue.model_library_ui import ModelLibraryWindow
from tracker.rescue.scrollable import ScrollablePanel

BG, PANEL, INK, MUTED, GREEN = "#101923", "#1b2938", "#e9f0f7", "#a9bacb", "#70dfba"


class StudioHome:
    def __init__(self, root: tk.Tk, workspace: Path) -> None:
        self.root, self.workspace = root, workspace.resolve()
        self.library = Library([], [])
        self.rows: dict[str, LibraryItem] = {}
        self.events: queue.Queue[tuple[str, Any]] = queue.Queue()
        self.scanning = False
        self.job: DesktopJob | None = None
        self.children: list[tuple[Path, DesktopJob]] = []
        self.photo: tk.PhotoImage | None = None
        self.search = tk.StringVar()
        self.project = tk.StringVar()
        self.run = tk.StringVar()
        self.status = tk.StringVar(value="Finding your videos, annotations and recognition runs...")
        self.stats = tk.StringVar()
        self.details = tk.StringVar(value="Choose a clip from your library.")
        self.config = self.workspace / "configs" / "rescue_fire_review.yaml"
        self.model_label = tk.StringVar()
        self.model_error = ""
        self.model_window: ModelLibraryWindow | None = None
        self.batch_window: BatchWindow | None = None
        try:
            active = ModelLibrary(self.workspace).active_path()
            if active is not None:
                self.config = active
        except (OSError, ValueError) as exc:
            self.model_error = (
                f"Saved active model unavailable: {exc}. "
                "Explicitly select a valid model or config before starting new jobs."
            )
        root.title("Rescue Studio")
        root.geometry("1240x900")
        root.minsize(1080, 820)
        root.configure(bg=BG)
        self._style()
        self._build()
        self.search.trace_add("write", lambda *_: self.render_library())
        root.protocol("WM_DELETE_WINDOW", self.close)
        root.after(200, self.poll)
        self.update_model_label()
        self.refresh()

    def _style(self) -> None:
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure(".", background=BG, foreground=INK, font=("Segoe UI", 10))
        style.configure("TButton", background=PANEL, padding=(12, 9))
        style.map(
            "TButton", background=[("active", "#30475e")], foreground=[("disabled", "#6b7d8f")]
        )
        style.configure("Primary.TButton", background=GREEN, foreground=BG)
        style.map("Primary.TButton", background=[("active", "#9bedcf")])
        style.configure("TEntry", fieldbackground=PANEL, insertcolor=INK, padding=8)
        style.configure("TCombobox", fieldbackground=PANEL, arrowcolor=INK, padding=6)
        style.map(
            "TCombobox", fieldbackground=[("readonly", PANEL)], foreground=[("readonly", INK)]
        )
        style.configure("Treeview", background=PANEL, fieldbackground=PANEL, rowheight=38)
        style.configure("Treeview.Heading", background="#273c50", padding=8)
        style.map("Treeview", background=[("selected", "#305b65")])
        style.configure("Title.TLabel", font=("Segoe UI Semibold", 26))
        style.configure("Section.TLabel", font=("Segoe UI Semibold", 13))
        style.configure("Muted.TLabel", foreground=MUTED)
        style.configure("Accent.TLabel", foreground=GREEN)

    def _build(self) -> None:
        shell = ttk.Frame(self.root, padding=24)
        shell.pack(fill="both", expand=True)
        header = ttk.Frame(shell)
        header.pack(fill="x")
        ttk.Label(header, text="Rescue Studio", style="Title.TLabel").pack(side="left")
        ttk.Label(header, text="LOCAL WORKSPACE  /  OBSERVATION ONLY", style="Accent.TLabel").pack(
            side="right"
        )
        ttk.Label(
            shell,
            text="Footage  >  Draft detections  >  Human review  >  Train and evaluate",
            style="Muted.TLabel",
        ).pack(anchor="w", pady=(4, 14))
        bar = ttk.Frame(shell)
        bar.pack(fill="x", pady=(0, 14))
        ttk.Button(
            bar, text="Import video...", command=self.import_video, style="Primary.TButton"
        ).pack(side="left")
        ttk.Button(bar, text="Refresh library", command=self.refresh).pack(side="left", padx=8)
        ttk.Button(bar, text="Resume project...", command=self.resume_project).pack(
            side="left", padx=(0, 8)
        )
        ttk.Button(bar, text="Get disaster starter pack", command=self.download).pack(side="left")
        ttk.Label(bar, textvariable=self.stats, style="Muted.TLabel").pack(side="right")
        workflow_bar = ttk.Frame(shell)
        workflow_bar.pack(fill="x", pady=(0, 12))
        ttk.Button(workflow_bar, text="My models", command=self.open_models).pack(side="left")
        ttk.Button(workflow_bar, text="Batch video processing", command=self.open_batches).pack(
            side="left", padx=8
        )
        ttk.Button(
            workflow_bar, text="Open another workspace...", command=self.open_workspace
        ).pack(side="left")
        ttk.Label(shell, text=str(self.workspace), style="Muted.TLabel", wraplength=1000).pack(
            anchor="w", pady=(0, 10)
        )

        footer = ttk.Frame(shell)
        footer.pack(side="bottom", fill="x", pady=(14, 0))
        job_bar = ttk.Frame(footer)
        job_bar.pack(fill="x")
        ttk.Label(job_bar, textvariable=self.status, wraplength=970, style="Accent.TLabel").pack(
            side="left", fill="x", expand=True
        )
        self.stop_button = ttk.Button(job_bar, text="Stop job", command=self.stop, state="disabled")
        self.stop_button.pack(side="right")
        self.progress = ttk.Progressbar(footer, mode="indeterminate")
        self.progress.pack(fill="x", pady=(8, 6))
        self.log = tk.Text(
            footer,
            height=4,
            bg=PANEL,
            fg=MUTED,
            font=("Consolas", 9),
            relief="flat",
            wrap="word",
            state="disabled",
        )
        self.log.pack(fill="x")

        body = ttk.Frame(shell)
        body.pack(fill="both", expand=True)
        body.columnconfigure(0, weight=1)
        body.columnconfigure(1, minsize=432)
        body.rowconfigure(0, weight=1)
        left, right_shell = ttk.Frame(body), ttk.Frame(body, padding=(20, 0, 0, 0))
        left.grid(row=0, column=0, sticky="nsew")
        right_shell.grid(row=0, column=1, sticky="nsew")
        self.label_button = ttk.Button(
            right_shell,
            text="Continue labeling",
            style="Primary.TButton",
            command=self.open_project,
        )
        self.label_button.pack(fill="x")
        ttk.Label(
            right_shell,
            text="Resume saved boxes and your last frame. No training or re-analysis.",
            wraplength=400,
            style="Muted.TLabel",
        ).pack(fill="x", pady=(6, 10))
        self.detail_scroll = ScrollablePanel(right_shell, width=412)
        self.detail_scroll.pack(fill="both", expand=True)
        right = self.detail_scroll.body
        ttk.Label(left, text="Your footage", style="Section.TLabel").pack(anchor="w")
        ttk.Entry(left, textvariable=self.search).pack(fill="x", pady=(8, 10))
        ttk.Label(
            left, text="Filter by clip name, collection or location", style="Muted.TLabel"
        ).pack(anchor="w", pady=(0, 8))
        table_frame = ttk.Frame(left)
        table_frame.pack(fill="both", expand=True)
        self.table = ttk.Treeview(
            table_frame,
            columns=("clip", "collection", "reviewed"),
            show="headings",
            selectmode="browse",
        )
        for column, title, width in (
            ("clip", "Clip", 270),
            ("collection", "Collection", 145),
            ("reviewed", "Reviewed", 85),
        ):
            self.table.heading(column, text=title)
            self.table.column(column, width=width, minwidth=70)
        scroll = ttk.Scrollbar(table_frame, orient="vertical", command=self.table.yview)
        self.table.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.table.pack(fill="both", expand=True)
        self.table.bind("<<TreeviewSelect>>", lambda _: self.select())
        self.table.bind("<Double-1>", lambda _: self.open_project())
        self.table.bind("<Return>", lambda _: self.open_project())
        ttk.Label(
            left,
            text="Reopens your last saved session, or the most-reviewed project.\n"
            "New footage and machine boxes are not training labels until you review them.",
            wraplength=540,
            style="Muted.TLabel",
        ).pack(anchor="w", pady=(10, 0))

        self.preview = tk.Canvas(
            right, width=400, height=185, background="#0a1119", highlightthickness=0
        )
        self.preview.pack(fill="x")
        ttk.Label(right, textvariable=self.details, wraplength=400, justify="left").pack(
            anchor="w", pady=(10, 8)
        )
        ttk.Label(right, text="Annotation project", style="Muted.TLabel").pack(anchor="w")
        self.project_box = ttk.Combobox(
            right, textvariable=self.project, state="readonly", width=46
        )
        self.project_box.pack(fill="x", pady=(4, 8))
        self.project_box.bind("<<ComboboxSelected>>", lambda _: self.describe_project())
        self.resume_hint = tk.StringVar()
        ttk.Label(right, textvariable=self.resume_hint, wraplength=400, style="Accent.TLabel").pack(
            fill="x", pady=(0, 8)
        )
        ttk.Label(right, text="Optional: import recognition boxes", style="Muted.TLabel").pack(
            anchor="w"
        )
        self.run_box = ttk.Combobox(right, textvariable=self.run, state="readonly", width=46)
        self.run_box.pack(fill="x", pady=(4, 10))
        self.import_predictions_button = ttk.Button(
            right,
            text="Label with selected predictions...",
            command=lambda: self.open_project(import_predictions=True),
        )
        self.import_predictions_button.pack(fill="x", pady=(0, 8))
        self.run_box.bind(
            "<<ComboboxSelected>>",
            lambda _: self.import_predictions_button.configure(
                state="normal" if self.run_box.current() > 0 else "disabled"
            ),
        )
        self.train_button = ttk.Button(
            right, text="Prepare dataset / train...", command=lambda: self.open_project(True)
        )
        self.train_button.pack(fill="x")
        ttk.Separator(right).pack(fill="x", pady=12)
        self.draft_button = ttk.Button(right, text="Generate draft boxes", command=self.generate)
        self.draft_button.pack(fill="x")
        ttk.Label(right, textvariable=self.model_label, wraplength=400, style="Muted.TLabel").pack(
            anchor="w", pady=6
        )
        links = ttk.Frame(right)
        links.pack(fill="x")
        ttk.Button(links, text="Choose model config...", command=self.choose_config).pack(
            side="left"
        )
        ttk.Button(links, text="Files and credits", command=self.files).pack(
            side="left", padx=(6, 0)
        )

    def current(self) -> LibraryItem | None:
        selection = self.table.selection()
        return self.rows.get(selection[0]) if selection else None

    def background(self, operation: Callable[[], Any], kind: str) -> None:
        if self.scanning:
            return
        self.scanning = True
        self.progress.start(12)

        def work() -> None:
            try:
                self.events.put((kind, operation()))
            except Exception as exc:
                self.events.put(("error", exc))

        threading.Thread(target=work, daemon=True).start()

    def refresh(self) -> None:
        if self.scanning:
            return
        self.status.set("Refreshing library. Originals and annotations are not modified.")
        self.background(lambda: discover_library(self.workspace), "library")

    def render_library(self) -> None:
        current = self.current()
        selected = current.video if current else None
        self.table.delete(*self.table.get_children())
        self.rows.clear()
        query = self.search.get().casefold().strip()
        for index, item in enumerate(self.library.items):
            searchable = f"{item.title} {item.collection} {item.metadata.get('location', '')}"
            if query and query not in searchable.casefold():
                continue
            key = str(index)
            self.rows[key] = item
            reviewed = item.projects[0].reviewed if item.projects else 0
            self.table.insert(
                "", "end", iid=key, values=(item.title, item.collection, str(reviewed))
            )
            if item.video == selected:
                self.table.selection_set(key)
        if not self.table.selection() and self.rows:
            self.table.selection_set(next(iter(self.rows)))
        self.stats.set(
            f"{len(self.library.items)} videos  /  "
            f"{sum(len(i.projects) for i in self.library.items)} projects"
        )
        self.select()

    def select(self) -> None:
        item = self.current()
        for button in (self.label_button, self.train_button, self.draft_button):
            button.configure(state="normal" if item else "disabled")
        self.preview.delete("all")
        self.photo = None
        if item is None:
            self.details.set("No matching footage. Import a video or clear your search.")
            self.project_box.configure(values=[])
            self.run_box.configure(values=[])
            self.project.set("")
            self.run.set("")
            self.resume_hint.set("")
            self.import_predictions_button.configure(state="disabled")
            return
        capture = cv2.VideoCapture(str(item.video))
        try:
            ok, frame = capture.read()
            if ok:
                height, width = frame.shape[:2]
                scale = min(400 / width, 185 / height)
                resized = cv2.resize(frame, (round(width * scale), round(height * scale)))
                success, png = cv2.imencode(".png", resized)
                if success:
                    self.photo = tk.PhotoImage(master=self.root, data=png.tobytes())
                    self.preview.create_image(200, 92, image=self.photo)
        finally:
            capture.release()
        projects = [
            f"{p.path.name} | {p.reviewed} reviewed, {p.drafts} drafts" for p in item.projects
        ]
        self.project_box.configure(values=projects or ["Create a new annotation project"])
        self.project_box.current(0)
        runs = [
            "No prediction run selected",
            *[
                f"{r.path.name} | {r.frames} frames | {'complete' if r.completed else 'partial'}"
                for r in item.runs
            ],
        ]
        self.run_box.configure(values=runs)
        self.run_box.current(1 if item.runs else 0)
        self.import_predictions_button.configure(state="normal" if item.runs else "disabled")
        self.describe_project()

    def describe_project(self) -> None:
        item = self.current()
        if item is None:
            self.resume_hint.set("")
            return
        index = max(0, self.project_box.current())
        project = item.projects[index] if item.projects else None
        self.label_button.configure(text="Continue labeling" if project else "Start labeling")
        self.resume_hint.set(
            "A new empty project will be created."
            if project is None
            else f"{project.reviewed} reviewed frames; {project.drafts} saved drafts. "
            "Continue opens these saved boxes directly."
        )
        scope = ", ".join(project.classes) if project else "Choose classes when opening"
        self.details.set(
            f"{item.title}\n{item.metadata.get('location', item.collection)}\n"
            f"Label scope: {scope}\n"
            f"{item.metadata.get('license', 'Source records: see Files and credits')}"
        )

    def resume_project(self) -> None:
        name = filedialog.askopenfilename(
            parent=self.root,
            title="Resume a saved annotation project",
            initialdir=self.workspace / "annotations",
            filetypes=[("Annotation project", "*.json")],
        )
        if not name:
            return
        try:
            path = Path(name).resolve()
            document = AnnotationDocument.model_validate_json(path.read_bytes())
            video = Path(document.source.path)
            if not video.is_absolute():
                video = self.workspace / video
            if not video.is_file():
                relocated = filedialog.askopenfilename(
                    parent=self.root,
                    title="Locate this project's original video (content must match)",
                    filetypes=[("Videos", "*.mp4 *.avi *.mov *.mkv *.webm")],
                )
                if not relocated:
                    return
                video = Path(relocated)
            self.launch_editor(path, ["--video", str(video), "--project", str(path)])
        except (ValueError, OSError) as exc:
            self.error(exc)

    def import_video(self) -> None:
        if self.scanning:
            return
        name = filedialog.askopenfilename(
            parent=self.root,
            title="Import an original video",
            filetypes=[("Videos", "*.mp4 *.avi *.mov *.mkv *.webm *.m4v *.mpeg *.mpg")],
        )
        if name:
            self.create_project(Path(name), open_after=False)

    def create_project(
        self,
        video: Path,
        *,
        open_after: bool,
        suggestions: Path | None = None,
        training: bool = False,
    ) -> None:
        if self.scanning:
            return
        value = simpledialog.askstring(
            "New annotation project",
            "Classes to review exhaustively, separated by commas. You can edit these later.",
            initialvalue="fire,smoke",
            parent=self.root,
        )
        if value is None:
            return
        classes = [name.strip().casefold() for name in value.split(",")]
        path = self.workspace / "annotations" / f"{video.stem}-{uuid4().hex[:8]}.json"

        def create() -> tuple[Path, Path, bool, Path | None, bool]:
            reader = FrameReader(video)
            try:
                AnnotationSession.open(path, reader.source, classes).save()
            finally:
                reader.close()
            return video, path, open_after, suggestions, training

        self.status.set("Checking the original video and creating an empty draft project...")
        self.background(create, "created")

    def open_project(self, training: bool = False, *, import_predictions: bool = False) -> None:
        item = self.current()
        if item is None or self.scanning:
            return
        if not item.projects:
            suggestions = (
                item.runs[self.run_box.current() - 1].path
                if import_predictions and self.run_box.current() > 0
                else None
            )
            self.create_project(
                item.video, open_after=True, suggestions=suggestions, training=training
            )
            return
        index = max(0, self.project_box.current())
        project = item.projects[index]
        args = ["--video", str(item.video), "--project", str(project.path)]
        if training:
            args.append("--training")
        elif import_predictions and self.run_box.current() > 0:
            args.extend(["--suggestions", str(item.runs[self.run_box.current() - 1].path)])
        self.launch_editor(project.path, args)

    def launch_editor(self, project: Path, args: list[str]) -> None:
        if any(path == project and job.poll() is None for path, job in self.children):
            self.status.set("This project is already open. Switch to its Label Studio window.")
            messagebox.showinfo(
                "Project already open",
                f"Switch to the window titled:\n"
                f"Rescue Label Studio | {project.name}\n\nYour current edits are still there.",
                parent=self.root,
            )
            return
        try:
            job = DesktopJob(self.workspace, "tracker.cli.rescue_annotate", args)
            self.children.append((project, job))
            self.status.set(
                "Label Studio opened in its own window. Save there, then refresh this library."
            )
        except OSError as exc:
            self.error(exc)

    def choose_config(self) -> None:
        name = filedialog.askopenfilename(
            parent=self.root,
            title="Choose a trusted review config",
            initialdir=self.workspace / "configs",
            filetypes=[("Review config", "*.yaml *.yml")],
        )
        if name:
            self.config = Path(name)
            self.model_error = ""
            self.update_model_label()

    def activate_model(self, path: Path) -> None:
        self.config = path
        self.model_error = ""
        self.update_model_label()
        self.status.set(
            "Observation model selected for new jobs. Running jobs keep their original model."
        )

    def require_model_config(self) -> Path:
        if self.model_error:
            raise ValueError(self.model_error)
        return self.config

    def open_workspace(self) -> None:
        try:
            child = DesktopJob(self.workspace, "tracker.cli.rescue_desktop", ["--choose-workspace"])
            self.children.append((self.workspace, child))
            self.status.set("Workspace chooser opened separately. This workspace stays open.")
        except OSError as exc:
            self.error(exc)

    def open_models(self) -> None:
        if self.model_window is not None and self.model_window.winfo_exists():
            self.model_window.lift()
            return
        try:
            self.model_window = ModelLibraryWindow(
                self.root, self.workspace, self.activate_model, self.test_version
            )
        except (OSError, ValueError) as exc:
            self.error(exc)

    def test_version(self, result: Path) -> None:
        project = filedialog.askopenfilename(
            title="Choose a reviewed validation annotation project",
            initialdir=self.workspace / "annotations",
            filetypes=[("Project JSON", "*.json")],
            parent=self.root,
        )
        if project:
            try:
                path = Path(project).resolve()
                doc = AnnotationDocument.model_validate_json(path.read_bytes())
                self.launch_editor(
                    path,
                    [
                        "--video",
                        doc.source.path,
                        "--project",
                        str(path),
                        "--training",
                        "--training-result",
                        str(result),
                    ],
                )
            except (OSError, ValueError) as exc:
                self.error(exc)

    def open_batches(self) -> None:
        if self.batch_window is not None and self.batch_window.winfo_exists():
            self.batch_window.lift()
            return
        self.batch_window = BatchWindow(
            self.root,
            self.workspace,
            [item.video for item in self.library.items],
            self.require_model_config,
            self.review_batch,
            self.refresh,
        )

    def review_batch(self, video: Path, run: Path) -> None:
        item = next(
            (item for item in self.library.items if item.video.resolve() == video.resolve()), None
        )
        if item is not None and item.projects:
            project = item.projects[0].path
            self.launch_editor(
                project,
                ["--video", str(video), "--project", str(project), "--suggestions", str(run)],
            )
        else:
            self.create_project(video, open_after=True, suggestions=run)

    def update_model_label(self) -> None:
        try:
            labels = local_review_config(self.require_model_config(), self.workspace)
            self.model_label.set(
                f"{self.config.name}\nPredicts: {', '.join(labels)}. "
                "Other classes need manual boxes or trained weights."
            )
        except (OSError, ValueError) as exc:
            self.model_label.set(str(exc))

    def generate(self) -> None:
        item = self.current()
        if item is None or self.job is not None:
            return
        try:
            labels = local_review_config(self.require_model_config(), self.workspace)
            if not messagebox.askokcancel(
                "Generate draft boxes",
                f"Process {item.video.name} using local weights referenced by "
                f"{self.config.name}?\n\n"
                f"Enabled labels: {', '.join(labels)}. Other labels are not modeled.\n"
                "Only load model files from trusted sources. This creates a new observation run; "
                "it does not change annotations or train a model.",
                parent=self.root,
            ):
                return
            self.start_job(
                "tracker.cli.rescue_review",
                [
                    "--video",
                    str(item.video),
                    "--config",
                    str(self.config),
                    "--output",
                    str(self.workspace / "diagnostics/rescue"),
                ],
            )
        except (OSError, ValueError) as exc:
            self.error(exc)

    def download(self) -> None:
        if self.job is not None:
            return
        if messagebox.askokcancel(
            "Disaster starter pack",
            "Download flood/debris-flow clips from "
            "USGS and Wikimedia Commons? Up to 900 MiB total, with source and license records. "
            "Existing files are verified, not overwritten. New labels remain unreviewed.",
            parent=self.root,
        ):
            self.start_job(
                "tracker.cli.rescue_fetch",
                ["--output", str(self.workspace / "data/rescue-disaster-starter")],
            )

    def start_job(self, module: str, args: list[str]) -> None:
        if self.job is not None:
            return
        try:
            self.job = DesktopJob(self.workspace, module, args, stoppable=True)
            self.status.set("Working locally. Progress appears below; you can continue browsing.")
            self.append_log(f"\nJob log: {self.job.log_path}\n")
            self.stop_button.configure(state="normal")
            self.progress.start(12)
        except OSError as exc:
            self.error(exc)

    def stop(self) -> None:
        if self.job is not None:
            self.job.stop()
            self.status.set(
                "Stop requested. Waiting for the current frame or download read to finish."
            )
            self.stop_button.configure(state="disabled")

    def files(self) -> None:
        item = self.current()
        if item is None:
            return
        window = tk.Toplevel(self.root)
        window.title("Files and credits")
        window.geometry("760x470")
        box = tk.Text(window, wrap="word", padx=18, pady=16)
        box.pack(fill="both", expand=True)
        metadata = item.metadata
        text = f"ORIGINAL VIDEO\n{item.video}\n\nANNOTATIONS\n"
        text += "\n".join(str(p.path) for p in item.projects) or "No project yet."
        text += f"\n\nSOURCE\n{metadata.get('author', 'See the collection provenance files')}\n"
        text += f"{metadata.get('source_page', item.video.parent)}\n{metadata.get('license', '')}\n"
        text += f"\nSHA256\n{item.sha256}\n\nModels and source labels require human review."
        box.insert("1.0", text)
        box.configure(state="disabled")
        buttons = ttk.Frame(window, padding=10)
        buttons.pack(fill="x")
        if os.name == "nt":
            ttk.Button(
                buttons, text="Open video folder", command=lambda: os.startfile(item.video.parent)
            ).pack(side="left")
            if item.projects:
                ttk.Button(
                    buttons,
                    text="Open annotation folder",
                    command=lambda: os.startfile(item.projects[0].path.parent),
                ).pack(side="left", padx=8)
        url = str(metadata.get("source_page", ""))
        if url.startswith("https://"):
            ttk.Button(buttons, text="Publisher page", command=lambda: webbrowser.open(url)).pack(
                side="left"
            )

    def append_log(self, text: str) -> None:
        clean = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text).replace("\r", "\n")
        self.log.configure(state="normal")
        self.log.insert("end", clean)
        count = int(self.log.index("end-1c").split(".")[0])
        if count > 300:
            self.log.delete("1.0", f"{count - 300}.0")
        self.log.see("end")
        self.log.configure(state="disabled")

    def error(self, exc: Exception) -> None:
        self.status.set(str(exc))
        messagebox.showerror("Rescue Studio", str(exc), parent=self.root)

    def poll(self) -> None:
        try:
            while True:
                kind, value = self.events.get_nowait()
                self.scanning = False
                if kind == "library":
                    self.library = value
                    self.render_library()
                    self.status.set(
                        f"Library ready. {len(self.library.warnings)} issue(s). "
                        "Choose a clip to label or generate draft boxes."
                    )
                    for warning in self.library.warnings:
                        self.append_log(warning + "\n")
                elif kind == "created":
                    video, project, open_after, suggestions, training = value
                    if open_after:
                        arguments = ["--video", str(video), "--project", str(project)]
                        if suggestions is not None:
                            arguments.extend(["--suggestions", str(suggestions)])
                        if training:
                            arguments.append("--training")
                        self.launch_editor(project, arguments)
                    self.refresh()
                else:
                    self.error(value)
        except queue.Empty:
            pass
        if self.job is not None:
            self.append_log(self.job.read())
            code = self.job.poll()
            if code is not None:
                self.append_log(self.job.read())
                stopped = self.job.stop_file.exists()
                self.append_log(
                    f"\n{'Stopped' if stopped else 'Finished'} with exit code {code}. "
                    f"Full log: {self.job.log_path}\n"
                )
                if code and not stopped:
                    self.error(
                        RuntimeError(f"Job failed. See the progress log.\n{self.job.log_path}")
                    )
                self.job = None
                self.stop_button.configure(state="disabled")
                self.refresh()
        remaining = []
        for path, child in self.children:
            code = child.poll()
            if code is None:
                remaining.append((path, child))
            else:
                if code:
                    self.append_log(
                        f"Child window closed with an error: {child.log_path}\n{child.read()}"
                    )
                self.refresh()
        self.children = remaining
        if not self.scanning and self.job is None:
            self.progress.stop()
        self.root.after(200, self.poll)

    def close(self) -> None:
        if any(
            window is not None and window.winfo_exists() and window.busy
            for window in (self.model_window, self.batch_window)
        ):
            self.status.set(
                "Wait for model operations or stop the batch worker before closing the library."
            )
            return
        if self.job is not None or self.scanning:
            self.status.set("Stop the current job and wait for it to finish before closing.")
            return
        if any(child.poll() is None for _, child in self.children) and not messagebox.askokcancel(
            "Close library",
            "Other Studio windows will remain open. "
            "Save and close them separately. Close the library?",
            parent=self.root,
        ):
            return
        self.root.destroy()
