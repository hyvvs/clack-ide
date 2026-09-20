from __future__ import annotations

import queue
import threading
import tkinter as tk
from functools import partial
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray

from tracker.rescue.annotations import AnnotationSession, normalize_class_name
from tracker.rescue.assisted_panel import AssistedPanel
from tracker.rescue.box_edit import BoxDrag, corners, hit_box
from tracker.rescue.desktop_jobs import DesktopJob
from tracker.rescue.error_review import comparison_reasons
from tracker.rescue.evaluation import TruthObject
from tracker.rescue.frame_carry_ui import FrameCarryBar
from tracker.rescue.frame_tracking import merge_tracking, track_frames
from tracker.rescue.media import FrameReader
from tracker.rescue.playback_ui import PlaybackBar
from tracker.rescue.project_boxes_ui import ProjectBoxesWindow
from tracker.rescue.range_tools_ui import BulkReviewWindow, ClipExportWindow
from tracker.rescue.review_panels import DatasetAuditPanel, ErrorReviewPanel, InspectionWindow
from tracker.rescue.scoring import annotation_digest, save_evaluation, score_saved_run
from tracker.rescue.scrollable import ScrollablePanel
from tracker.rescue.studio_state import load_position, save_position
from tracker.rescue.suggestions import (
    Suggestions,
    load_suggestions,
    merge_suggestions,
    scoped_suggestion,
)
from tracker.rescue.tracking_labels import STATE_COLORS, attention_count, box_caption, box_state
from tracker.rescue.tracking_ui import TrackingWindow
from tracker.rescue.training_panel import TrainingPanel

BG, PANEL, TEXT, MUTED, ACCENT = "#101923", "#1b2938", "#e9f0f7", "#a9bacb", "#70dfba"


def metric(value: object, percentage: bool = False) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, float):
        return f"{value:.1%}" if percentage else f"{value:.2f}"
    return str(value)


class AnnotationApp:
    def __init__(self, root: tk.Tk, reader: FrameReader, session: AnnotationSession) -> None:
        self.root, self.reader, self.session = root, reader, session
        position = load_position(session.path, reader.source)
        self.carry_initial = (position.auto_track, position.carry_mode)
        self.index = position.frame_index
        self.image: NDArray[np.uint8] = reader.read(self.index)
        self.photo: tk.PhotoImage | None = None
        self.scale = 1.0
        self.offset = (0.0, 0.0)
        self.drag_start: tuple[float, float] | None = None
        self.draft_rectangle: int | None = None
        self.selected: int | None = None
        self.box_drag: BoxDrag | None = None
        self.preview_box: tuple[float, float, float, float] | None = None
        self.draw_mode = tk.BooleanVar(value=False)
        self.import_jobs: queue.Queue[Suggestions | Exception] = queue.Queue()
        self.import_busy = False
        self.suggestions: Suggestions | None = None
        self.pending_correction: tuple[Path, Path, str] | None = None
        self.refresh_machine_predictions = False
        self.show_predictions = tk.BooleanVar(value=False)
        self.results: dict[str, dict[str, Any]] = {}
        self.validation_windows: dict[Path, DesktopJob] = {}
        self.jobs: queue.Queue[tuple[dict[str, Any] | None, str]] = queue.Queue()
        self.busy = False
        self.tracking_window: TrackingWindow | None = None
        self.project_windows: dict[str, tk.Toplevel] = {}
        self.status = tk.StringVar(
            value=f"Resumed saved project at frame {self.index}. "
            "Correct boxes here; training is a separate step. Save with Ctrl+S."
        )
        self.frame_status = tk.StringVar()
        self.label = tk.StringVar(
            value=position.label
            if position.label in session.document.classes
            else session.document.classes[0]
        )
        self.tag_scope: tuple[str, ...] = ()
        self.tag_hint = tk.StringVar()
        self.object_id = tk.StringVar()
        self.track_info = tk.StringVar(value="Select a box to inspect its tracking state.")
        self.box_fields = [tk.StringVar() for _ in range(4)]
        self.jump_index = tk.StringVar(value=str(self.index))
        self.incident = tk.StringVar(value=session.document.incident_id)
        self.split = tk.StringVar(value=session.document.split)
        root.title(f"Rescue Label Studio | {session.path.name}")
        root.geometry("1280x860")
        root.minsize(1050, 740)
        root.configure(bg=BG)
        self._style()
        self._build()
        self.refresh()
        root.protocol("WM_DELETE_WINDOW", self.close)
        root.bind("<Control-s>", lambda _: self.save())
        root.bind("<Control-z>", lambda _: self.undo())
        root.after(150, self._poll)

    def _style(self) -> None:
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure(".", background=BG, foreground=TEXT, font=("Segoe UI", 10))
        style.configure("TButton", background=PANEL, padding=(10, 7))
        style.map("TButton", background=[("active", "#30475e")])
        style.configure("Carry.TButton", background="#255b76", font=("Segoe UI Semibold", 11))
        style.map("Carry.TButton", background=[("active", "#327a96")])
        style.configure("TNotebook.Tab", padding=(18, 10), background=PANEL)
        style.map("TNotebook.Tab", background=[("selected", "#30475e")])
        style.configure("Treeview", background=PANEL, fieldbackground=PANEL, rowheight=30)
        style.configure("Treeview.Heading", background="#30475e", padding=6)
        style.configure("TEntry", fieldbackground=PANEL, insertcolor=TEXT)
        style.configure("TCombobox", fieldbackground=PANEL, arrowcolor=TEXT)
        style.map(
            "TCombobox", fieldbackground=[("readonly", PANEL)], foreground=[("readonly", TEXT)]
        )
        style.configure("Title.TLabel", font=("Segoe UI Semibold", 22))
        style.configure("Muted.TLabel", foreground=MUTED)
        style.configure("Accent.TLabel", foreground=ACCENT)

    def _build(self) -> None:
        shell = ttk.Frame(self.root, padding=18)
        shell.pack(fill="both", expand=True)
        ttk.Label(shell, text="RESCUE / LABEL STUDIO", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            shell,
            text="Local annotation and measured observation review. No actuation.",
            style="Muted.TLabel",
        ).pack(anchor="w", pady=(4, 12))
        ttk.Label(
            shell,
            text=f"Video: {Path(self.reader.source.path).name}  |  "
            f"{self.reader.source.width} x {self.reader.source.height}  |  "
            f"{self.reader.source.frame_count} frames  |  SHA256 {self.reader.source.sha256[:12]}",
            style="Accent.TLabel",
        ).pack(anchor="w", pady=(0, 10))
        self.tabs = ttk.Notebook(shell)
        ttk.Label(shell, textvariable=self.status, wraplength=1180, style="Muted.TLabel").pack(
            side="bottom", fill="x", pady=(10, 0)
        )
        self.tabs.pack(fill="both", expand=True)
        annotate, evaluate = ttk.Frame(self.tabs, padding=12), ttk.Frame(self.tabs, padding=12)
        self.tabs.add(annotate, text="01  Label video")
        self.tabs.add(evaluate, text="02  Evaluate runs")
        self._build_annotation(annotate)
        self._build_dashboard(evaluate)
        self.dataset_panel = DatasetAuditPanel(
            self.tabs, self.session.path.parent / "audits", self.save, self.session.path
        )
        self.tabs.add(self.dataset_panel, text="03  Dataset checks")
        self.training_panel = TrainingPanel(
            self.tabs,
            self.session,
            self.save,
            self.open_validation,
            lambda: self.tabs.select(0),  # type: ignore[no-untyped-call]
            self.open_labels,
            self.open_corrections,
        )
        self.tabs.add(self.training_panel, text="04  Train model")
        self.assisted_panel = AssistedPanel(self.tabs, self)
        self.tabs.add(self.assisted_panel, text="05  Assisted review")
        self.training_panel.bind("<<TrainingMetadataChanged>>", lambda _: self.sync_metadata())
        self.tabs.bind("<<NotebookTabChanged>>", self.tab_changed)

    def tab_changed(self, _: object = None) -> None:
        self.media.pause()
        selected = self.tabs.select()  # type: ignore[no-untyped-call]
        if hasattr(self, "training_panel") and selected == str(self.training_panel):
            self.training_panel.refresh()
        if hasattr(self, "assisted_panel") and selected == str(self.assisted_panel):
            self.assisted_panel.render()

    def sync_metadata(self) -> None:
        self.incident.set(self.session.document.incident_id)
        self.split.set(self.session.document.split)

    def open_labels(self, project: Path) -> None:
        project = project.resolve()
        if project == self.session.path.resolve():
            self.tabs.select(0)  # type: ignore[no-untyped-call]
            return
        existing = self.validation_windows.get(project)
        if existing is not None and existing.poll() is None:
            self.status.set(f"Labels already open in Rescue Label Studio | {project.name}.")
            return
        try:
            from tracker.rescue.training_guide import load_saved_video

            video = load_saved_video(project)
            self.validation_windows[project] = DesktopJob(
                Path.cwd(),
                "tracker.cli.rescue_annotate",
                ["--video", video.document.source.path, "--project", str(project)],
            )
        except (ValueError, OSError) as exc:
            self.error(exc)

    def open_corrections(self, project: Path, run: Path, model_id: str) -> None:
        if project.resolve() == self.session.path.resolve():
            if self.import_busy:
                self.pending_correction = (project, run, model_id)
                self.status.set("Full-video analysis ready. Finishing the current import first.")
                return
            state = self.training_panel.saved_state
            state.correction_model_id, state.correction_run = model_id, str(run)
            self.training_panel.persist()
            self.refresh()
            self.tabs.select(0)  # type: ignore[no-untyped-call]
            self.refresh_machine_predictions = True
            self.import_suggestions(run)
            return
        self.open_labels(project)

    def train_corrections(self) -> None:
        from tracker.rescue.model_library import ModelLibrary

        panel = self.training_panel
        if self.import_busy or not panel.idle():
            self.status.set("Finish the current import or analysis before training.")
            return
        try:
            version = ModelLibrary(panel.quick.workspace).get(panel.saved_state.correction_model_id)
            if len(version.config.models) != 1:
                raise ValueError("Select one starting model in My models to train an update.")
            panel.weights.set(version.config.models[0].weights)
            self.tabs.select(panel)  # type: ignore[no-untyped-call]
            panel.views.select(panel.quick)  # type: ignore[no-untyped-call]
            panel.quick.train()
        except (OSError, ValueError) as exc:
            self.error(exc)

    def open_validation(self, project: Path, run: Path) -> None:
        project = project.resolve()
        if project == self.session.path.resolve():
            self.tabs.select(1)  # type: ignore[no-untyped-call]
            self.evaluate(run)
            return
        existing = self.validation_windows.get(project)
        if existing is not None and existing.poll() is None:
            messagebox.showinfo(
                "Validation project already open",
                f"Switch to Rescue Label Studio | {project.name}. "
                "Your edits are there. Close that editor before opening another result.",
                parent=self.root,
            )
            return
        try:
            from tracker.rescue.annotations import AnnotationDocument

            doc = AnnotationDocument.model_validate_json(project.read_bytes())
            self.validation_windows[project] = DesktopJob(
                Path.cwd(),
                "tracker.cli.rescue_annotate",
                ["--video", doc.source.path, "--project", str(project), "--run", str(run)],
            )
        except (ValueError, OSError) as exc:
            self.error(exc)

    def _build_annotation(self, frame: ttk.Frame) -> None:
        self.correction_bar = ttk.Frame(frame)
        self.correction_hint = tk.StringVar()
        ttk.Label(
            self.correction_bar,
            textvariable=self.correction_hint,
            wraplength=740,
            style="Accent.TLabel",
        ).pack(side="left", fill="x", expand=True)
        self.train_corrections_button = ttk.Button(
            self.correction_bar,
            text="Save and train updated model",
            command=self.train_corrections,
        )
        self.train_corrections_button.pack(side="right")
        self.media = PlaybackBar(frame, self)
        self.media.pack(fill="x", pady=(0, 8))
        toolbar = ttk.Frame(frame)
        toolbar.pack(fill="x", pady=(0, 8))
        for label, delta in (("-10", -10), ("Previous", -1), ("Next", 1), ("+10", 10)):
            button = ttk.Button(toolbar, text=label, command=partial(self.step, delta))
            button.pack(side="left", padx=(0, 5))
            if delta == 1:
                self.next_button = button
        ttk.Entry(toolbar, textvariable=self.jump_index, width=7).pack(side="left", padx=5)
        ttk.Button(toolbar, text="Go to frame", command=self.jump).pack(side="left")
        ttk.Button(toolbar, text="Next unreviewed", command=self.next_unreviewed).pack(
            side="left", padx=8
        )
        ttk.Button(toolbar, text="Save project", command=self.save).pack(side="right")
        ttk.Button(toolbar, text="Export reviewed JSON", command=self.export).pack(
            side="right", padx=8
        )
        actions = ttk.Frame(frame)
        actions.pack(fill="x", pady=(0, 8))
        self.import_button = ttk.Button(
            actions, text="Import recognition boxes...", command=self.choose_suggestions
        )
        self.import_button.pack(side="left")
        ttk.Button(
            actions, text="Use predictions on this frame", command=self.adopt_predictions
        ).pack(side="left", padx=6)
        ttk.Checkbutton(
            actions,
            text="Show original predictions",
            variable=self.show_predictions,
            command=self.draw,
        ).pack(side="left")
        actions = ttk.Frame(frame)
        actions.pack(fill="x", pady=(0, 6))
        ttk.Button(
            actions, text="Suggested next", command=lambda: self.assisted_panel.open_next()
        ).pack(side="right")
        ttk.Button(
            actions, text="Skip suggestion", command=lambda: self.assisted_panel.skip()
        ).pack(side="right", padx=4)
        ttk.Button(actions, text="Review and next", command=self.review_next).pack(side="right")
        ttk.Checkbutton(
            actions, text="Draw new box (also inside existing boxes)", variable=self.draw_mode
        ).pack(side="left", padx=12)
        ttk.Label(
            frame,
            text="Click to select. Drag to move. Drag a corner to resize.",
            style="Muted.TLabel",
        ).pack(anchor="w", pady=(0, 4))
        self.carry = FrameCarryBar(frame, self)
        self.carry.pack(fill="x", pady=(0, 6))
        ttk.Label(frame, textvariable=self.frame_status, style="Accent.TLabel").pack(
            anchor="w", pady=(0, 8)
        )
        content = ttk.Frame(frame)
        content.pack(fill="both", expand=True)
        self.canvas = tk.Canvas(content, background="#080e15", highlightthickness=0, cursor="cross")
        self.canvas.pack(side="left", fill="both", expand=True, padx=(0, 12))
        self.canvas.bind("<Configure>", lambda _: self.draw())
        self.canvas.bind("<ButtonPress-1>", self.start_box)
        self.canvas.bind("<B1-Motion>", self.drag_box)
        self.canvas.bind("<ButtonRelease-1>", self.finish_box)
        side_scroll = ScrollablePanel(content, width=285)
        side_scroll.pack(side="right", fill="y")
        side = side_scroll.body
        ttk.Label(side, text="Box tags (training classes)", style="Accent.TLabel").pack(anchor="w")
        self.class_combo = ttk.Combobox(
            side, textvariable=self.label, values=self.session.document.classes
        )
        self.class_combo.pack(fill="x", pady=(4, 4))
        self.class_combo.bind("<Return>", lambda _: self.apply_tag())
        self.class_combo.bind("<<ComboboxSelected>>", lambda _: self.apply_tag())
        ttk.Button(side, text="Create / apply tag", command=self.apply_tag).pack(fill="x", pady=4)
        ttk.Label(side, textvariable=self.tag_hint, wraplength=270, style="Muted.TLabel").pack(
            fill="x", pady=4
        )
        ttk.Button(side, text="Deselect box / tag the next box", command=self.clear_selection).pack(
            fill="x", pady=(0, 4)
        )
        self.tag_buttons = ttk.Frame(side)
        self.tag_buttons.pack(fill="x", pady=(0, 6))
        self.tag_buttons.columnconfigure((0, 1), weight=1, uniform="tags")
        class_actions = ttk.Frame(side)
        class_actions.pack(fill="x", pady=4)
        ttk.Button(class_actions, text="New tag...", command=self.new_tag).pack(side="left")
        ttk.Button(class_actions, text="Remove unused", command=self.remove_class).pack(
            side="left", padx=4
        )
        ttk.Label(
            side,
            text="Type a name + Enter, or click a tag button.\nOne training class per box.",
            style="Muted.TLabel",
        ).pack(anchor="w")
        ttk.Button(side, text="Rename tag throughout project...", command=self.rename_class).pack(
            fill="x", pady=4
        )
        ttk.Label(side, text="Object ID (optional, stable across frames)").pack(anchor="w")
        ttk.Entry(side, textvariable=self.object_id).pack(fill="x", pady=(4, 10))
        self.objects = tk.Listbox(
            side,
            bg=PANEL,
            fg=TEXT,
            selectbackground="#345b6f",
            relief="flat",
            height=3,
            exportselection=False,
        )
        self.objects.pack(fill="both", expand=True, pady=(0, 8))
        self.objects.bind("<<ListboxSelect>>", self.select_object)
        ttk.Label(side, textvariable=self.track_info, wraplength=270, style="Muted.TLabel").pack(
            fill="x", pady=(0, 6)
        )
        coordinates = ttk.Frame(side)
        coordinates.pack(fill="x")
        for column, (name, variable) in enumerate(
            zip(("x1", "y1", "x2", "y2"), self.box_fields, strict=True)
        ):
            ttk.Label(coordinates, text=name).grid(row=0, column=column)
            ttk.Entry(coordinates, textvariable=variable, width=7).grid(
                row=1, column=column, padx=2
            )
        ttk.Button(side, text="Confirm / update selected box", command=self.update_object).pack(
            fill="x", pady=(8, 4)
        )
        ttk.Button(side, text="Delete selected box", command=self.delete_object).pack(
            fill="x", pady=4
        )
        ttk.Button(side, text="Undo label edit", command=self.undo).pack(fill="x", pady=4)
        ttk.Separator(side).pack(fill="x", pady=8)
        ttk.Button(side, text="Mark frame reviewed", command=self.mark_reviewed).pack(
            fill="x", pady=4
        )
        ttk.Button(side, text="Review and next", command=self.review_next).pack(fill="x", pady=4)
        ttk.Button(side, text="Return frame to draft", command=self.mark_draft).pack(
            fill="x", pady=4
        )
        ttk.Label(
            side,
            text="Review ALL scoped classes. No boxes + reviewed = negative. "
            "Any box edit returns this frame to draft.",
            wraplength=270,
            style="Muted.TLabel",
        ).pack(fill="x", pady=6)

    def _build_dashboard(self, frame: ttk.Frame) -> None:
        ttk.Label(
            frame,
            text="Compare saved detections against the same reviewed label snapshot.",
            style="Accent.TLabel",
        ).pack(anchor="w", pady=(0, 10))
        metadata = ttk.Frame(frame)
        metadata.pack(fill="x", pady=(0, 10))
        ttk.Label(metadata, text="Incident / recording group").pack(side="left")
        ttk.Entry(metadata, textvariable=self.incident, width=25).pack(side="left", padx=8)
        ttk.Label(metadata, text="Dataset split").pack(side="left")
        ttk.Combobox(
            metadata,
            textvariable=self.split,
            values=["unassigned", "training", "validation", "test"],
            state="readonly",
            width=12,
        ).pack(side="left", padx=8)
        self.score_button = ttk.Button(
            metadata, text="Add saved run and evaluate", command=self.choose_run
        )
        self.score_button.pack(side="right")
        self.run_table = self._table(
            frame, ["Run", "Precision", "Recall", "FP", "FN", "ID changes", "p95 ms", "Coverage"], 4
        )
        self.run_table.bind("<<TreeviewSelect>>", self.select_result)
        result_tabs = ttk.Notebook(frame)
        result_tabs.pack(fill="both", expand=True, pady=(10, 0))
        metrics_frame = ttk.Frame(result_tabs, padding=8)
        result_tabs.add(metrics_frame, text="Metrics and provenance")
        self.error_panel = ErrorReviewPanel(result_tabs, self.inspect_frame)
        result_tabs.add(self.error_panel, text="Inspect error frames")
        self.class_table = self._table(
            metrics_frame, ["Class", "TP", "FP", "FN", "Precision", "Recall"], 4
        )
        detail_container = ttk.Frame(metrics_frame)
        detail_container.pack(fill="both", expand=True, pady=(12, 0))
        self.details = tk.Text(
            detail_container,
            bg=PANEL,
            fg=TEXT,
            height=7,
            wrap="word",
            relief="flat",
            font=("Segoe UI", 10),
            padx=10,
            pady=8,
        )
        detail_scroll = ttk.Scrollbar(
            detail_container, orient="vertical", command=self.details.yview
        )
        self.details.configure(yscrollcommand=detail_scroll.set)
        detail_scroll.pack(side="right", fill="y")
        self.details.pack(fill="both", expand=True)
        self._details(
            "No evaluations yet. Review frames in the first tab, then select a rescue_review "
            "output folder containing summary.json and frames.jsonl. Nothing is scored from "
            "unlabeled frames.\n\nDataset checks flag exact-video or tagged-incident "
            "overlap across splits. Use validation data for model selection."
        )

    @staticmethod
    def _table(frame: ttk.Frame, columns: list[str], height: int) -> ttk.Treeview:
        container = ttk.Frame(frame)
        container.pack(fill="x")
        table = ttk.Treeview(
            container, columns=columns, show="headings", height=height, selectmode="browse"
        )
        for index, name in enumerate(columns):
            table.heading(name, text=name)
            table.column(name, width=230 if index == 0 else 95, minwidth=65)
        scrollbar = ttk.Scrollbar(container, orient="vertical", command=table.yview)
        table.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        table.pack(side="left", fill="x", expand=True)
        table.tag_configure("stale", foreground="#f2bd7e")
        return table

    def _details(self, text: str) -> None:
        self.details.configure(state="normal")
        self.details.delete("1.0", "end")
        self.details.insert("1.0", text)
        self.details.configure(state="disabled")

    def error(self, exc: Exception) -> None:
        self.status.set(str(exc))
        messagebox.showerror("Rescue Label Studio", str(exc), parent=self.root)

    def refresh(self, *, light: bool = False) -> None:
        if not light:
            self.media.pause(refresh=False)
        self.media.sync()
        self.box_drag = None
        self.preview_box = None
        self.class_combo.configure(values=self.session.document.classes)
        if self.label.get() not in self.session.document.classes:
            self.label.set(self.session.document.classes[0])
        self.refresh_tags()
        frame = self.session.frame(self.index)
        reviewed = sum(frame.reviewed for frame in self.session.document.frames)
        if hasattr(self, "training_panel") and self.training_panel.saved_state.correction_model_id:
            self.correction_bar.pack(fill="x", pady=(0, 8), before=self.media)
            self.correction_hint.set(
                f"Correct model predictions. {reviewed:,} / {self.reader.source.frame_count:,} "
                "frames approved. Saving edits alone does not train."
            )
        source_label = (
            "Tracking/carry source"
            if (frame.suggestion_source or "").startswith("tracking:")
            else "Imported draft source"
            if frame.suggestion_source
            else "Manual / publisher"
        )
        self.frame_status.set(
            f"Frame {self.index} / {self.reader.source.frame_count - 1}  |  "
            f"{'REVIEWED' if frame.reviewed else 'DRAFT / NOT SCORED'}  |  "
            f"{source_label}  |  "
            f"{reviewed} reviewed  |  {'Unsaved changes' if self.session.dirty else 'Saved'}"
        )
        self.objects.delete(0, "end")
        for index in range(len(frame.objects)):
            self.objects.insert("end", f"{index + 1}. {box_caption(frame, index)}")
            self.objects.itemconfigure(index, foreground=STATE_COLORS[box_state(frame, index)])
        self.selected = None
        self.track_info.set("Select a box to inspect its tracking state.")
        self.carry.refresh(frame)
        self.tag_hint.set("No box selected: the active tag will be used for the next box you draw.")
        self.draw()
        if light:
            return
        digest = annotation_digest(self.session.document)
        for row, result in self.results.items():
            current = result["annotation_sha256"] == digest
            name = Path(result["run_directory"]).name
            self.run_table.set(row, "Run", name if current else f"STALE: {name}")
            self.run_table.item(row, tags=() if current else ("stale",))
        self.select_result()

    def draw(self) -> None:
        width, height = max(1, self.canvas.winfo_width()), max(1, self.canvas.winfo_height())
        source = self.reader.source
        self.scale = min(width / source.width, height / source.height)
        display_width, display_height = (
            max(1, round(source.width * self.scale)),
            max(1, round(source.height * self.scale)),
        )
        self.offset = ((width - display_width) / 2, (height - display_height) / 2)
        resized = cv2.resize(self.image, (display_width, display_height))
        ok, encoded = cv2.imencode(".ppm", resized)
        if not ok:
            return
        self.photo = tk.PhotoImage(master=self.root, data=encoded.tobytes(), format="PPM")
        self.canvas.delete("all")
        self.canvas.create_image(*self.offset, anchor="nw", image=self.photo)
        if self.show_predictions.get() and self.suggestions is not None:
            predicted = next(
                (frame for frame in self.suggestions.frames if frame.frame_index == self.index),
                None,
            )
            if predicted is not None:
                ox, oy = self.offset
                for obj in predicted.objects:
                    x1, y1, x2, y2 = obj.bbox_xyxy
                    self.canvas.create_rectangle(
                        x1 * self.scale + ox,
                        y1 * self.scale + oy,
                        x2 * self.scale + ox,
                        y2 * self.scale + oy,
                        outline="#72baff",
                        dash=(5, 4),
                        width=2,
                    )
                    self.canvas.create_text(
                        x1 * self.scale + ox,
                        y2 * self.scale + oy,
                        anchor="nw",
                        fill="#72baff",
                        text=f"Original: {obj.label}",
                    )
        frame = self.session.frame(self.index)
        for index, obj in enumerate(frame.objects):
            box = (
                self.preview_box
                if self.box_drag is not None and self.box_drag.index == index and self.preview_box
                else obj.bbox_xyxy
            )
            x1, y1, x2, y2 = box
            ox, oy = self.offset
            left, top = x1 * self.scale + ox, y1 * self.scale + oy
            state = box_state(frame, index)
            color = STATE_COLORS[state]
            self.canvas.create_rectangle(
                left,
                top,
                x2 * self.scale + ox,
                y2 * self.scale + oy,
                outline=color,
                width=3 if index == self.selected else 2,
                dash=(5, 3) if state == "Needs attention" else (),
            )
            caption = self.canvas.create_text(
                left + 4,
                top + 4,
                anchor="nw",
                fill=color,
                font=("Segoe UI", 11, "bold"),
                text=box_caption(frame, index),
                width=max(50, min(320, width - 4)),
            )
            bounds = self.canvas.bbox(caption)
            if bounds:
                dx = max(2 - bounds[0], min(0, width - 2 - bounds[2]))
                dy = max(2 - bounds[1], min(0, height - 2 - bounds[3]))
                self.canvas.move(caption, dx, dy)
                bounds = self.canvas.bbox(caption)
            if bounds:
                background = self.canvas.create_rectangle(
                    bounds[0] - 2,
                    bounds[1] - 1,
                    bounds[2] + 2,
                    bounds[3] + 1,
                    fill="#080e15",
                    outline=color,
                )
                self.canvas.tag_lower(background, caption)
            if index == self.selected:
                for cx, cy in corners(box):
                    px, py = cx * self.scale + ox, cy * self.scale + oy
                    self.canvas.create_rectangle(
                        px - 5, py - 5, px + 5, py + 5, fill="#ffe397", outline="#080e15"
                    )

    def point(self, x: int, y: int, clamp: bool = False) -> tuple[float, float] | None:
        px, py = (x - self.offset[0]) / self.scale, (y - self.offset[1]) / self.scale
        source = self.reader.source
        if not clamp and not (0 <= px <= source.width and 0 <= py <= source.height):
            return None
        return max(0, min(source.width, px)), max(0, min(source.height, py))

    def start_box(self, event: tk.Event[tk.Canvas]) -> None:
        self.media.pause()
        self.drag_start = self.point(event.x, event.y)
        self.draft_rectangle = None
        self.box_drag = None
        self.preview_box = None
        if self.drag_start is None:
            return
        boxes = [obj.bbox_xyxy for obj in self.session.frame(self.index).objects]
        hit = (
            None
            if self.draw_mode.get()
            else hit_box(boxes, self.drag_start, self.selected, 8 / self.scale)
        )
        if hit is not None:
            index, action = hit
            self.objects.selection_clear(0, "end")
            self.objects.selection_set(index)
            self.select_object()
            self.box_drag = BoxDrag(index, action, self.drag_start, boxes[index])
        else:
            self.selected = None
            self.objects.selection_clear(0, "end")
            self.draw()

    def drag_box(self, event: tk.Event[tk.Canvas]) -> None:
        if self.drag_start is None:
            return
        if self.box_drag is not None:
            point = self.point(event.x, event.y, clamp=True)
            if point is not None:
                self.preview_box = self.box_drag.update(
                    point, self.reader.source.width, self.reader.source.height
                )
                self.draw()
            return
        if self.draft_rectangle is not None:
            self.canvas.delete(self.draft_rectangle)
        ox, oy = self.offset
        x, y = self.drag_start
        self.draft_rectangle = self.canvas.create_rectangle(
            x * self.scale + ox, y * self.scale + oy, event.x, event.y, outline="#ffe397", width=2
        )

    def finish_box(self, event: tk.Event[tk.Canvas]) -> None:
        created: int | None = None
        start, self.drag_start = self.drag_start, None
        end = self.point(event.x, event.y, clamp=True)
        if self.box_drag is not None:
            drag = self.box_drag
            if end is not None:
                box = drag.update(end, self.reader.source.width, self.reader.source.height)
                if box != drag.original and box[2] - box[0] >= 2 and box[3] - box[1] >= 2:
                    objects = self.session.frame(self.index).objects
                    objects[drag.index] = TruthObject(
                        label=objects[drag.index].label,
                        bbox_xyxy=box,
                        object_id=objects[drag.index].object_id,
                    )
                    self.session.replace_frame(self.index, objects, edited_index=drag.index)
            self.refresh()
            self.objects.selection_set(drag.index)
            self.select_object()
            return
        if start is not None and end is not None:
            x1, x2 = sorted((start[0], end[0]))
            y1, y2 = sorted((start[1], end[1]))
            if x2 - x1 >= 2 and y2 - y1 >= 2:
                try:
                    if not self.ensure_class():
                        self.refresh()
                        return
                    obj = TruthObject(
                        label=self.label.get(),
                        object_id=self.object_id.get().strip() or None,
                        bbox_xyxy=(x1, y1, x2, y2),
                    )
                    self.session.replace_frame(
                        self.index, [*self.session.frame(self.index).objects, obj]
                    )
                    created = len(self.session.frame(self.index).objects) - 1
                except ValueError as exc:
                    self.error(exc)
        self.refresh()

        if created is not None:
            self.objects.selection_set(created)
            self.select_object()

    def clear_selection(self) -> None:
        self.selected = None
        self.objects.selection_clear(0, "end")
        self.tag_hint.set("No box selected: choose a tag for the next box you draw.")
        self.object_id.set("")
        self.track_info.set("Select a box to inspect its tracking state.")
        self.draw()

    def select_object(self, event: tk.Event[tk.Listbox] | None = None) -> None:
        selection = self.objects.curselection()  # type: ignore[no-untyped-call]
        if not selection:
            return
        self.selected = selection[0]
        obj = self.session.frame(self.index).objects[self.selected]
        frame = self.session.frame(self.index)
        link = frame.box_links.get(self.selected)
        self.track_info.set(
            box_caption(frame, self.selected)
            + (
                "\n" + link.needs_attention
                if link and link.needs_attention
                else "\nT- IDs are display abbreviations. Track details shows the full identity."
            )
        )
        self.label.set(obj.label)
        self.tag_hint.set(
            f"Box {self.selected + 1} selected. Click a tag or type a name + Enter to relabel it."
        )
        self.object_id.set(obj.object_id or "")
        for variable, value in zip(self.box_fields, obj.bbox_xyxy, strict=True):
            variable.set(f"{value:.2f}")
        self.draw()

    def update_object(self) -> None:
        if self.selected is None:
            self.status.set("Select a box in the list before editing its class, ID or coordinates.")
            return
        try:
            if not self.ensure_class():
                return
            coordinates = tuple(float(value.get()) for value in self.box_fields)
            obj = TruthObject.model_validate(
                {
                    "label": self.label.get(),
                    "bbox_xyxy": coordinates,
                    "object_id": self.object_id.get().strip() or None,
                }
            )
            objects = self.session.frame(self.index).objects
            objects[self.selected] = obj
            selected = self.selected
            self.session.replace_frame(self.index, objects, edited_index=selected)
            self.refresh()
            self.objects.selection_set(selected)
            self.select_object()
        except ValueError as exc:
            self.error(exc)

    def delete_object(self) -> None:
        if self.selected is not None:
            objects = self.session.frame(self.index).objects
            objects.pop(self.selected)
            self.session.replace_frame(self.index, objects)
            self.refresh()

    def mark_reviewed(self) -> bool:
        self.media.pause()
        if self.carry.busy:
            self.status.set("Finish or cancel tracking before marking a frame reviewed.")
            return False
        if attention_count(self.session.frame(self.index)):
            self.status.set(
                "Resolve Needs attention before review: correct, confirm, or delete red boxes."
            )
            return False
        self.session.replace_frame(
            self.index, self.session.frame(self.index).objects, reviewed=True
        )
        self.refresh()
        return True

    def open_tracking(self, update: bool = False) -> None:
        self.media.pause()
        if self.carry.busy:
            self.status.set("Finish or cancel Track & next first.")
            return
        if self.tracking_window is not None and self.tracking_window.winfo_exists():
            self.tracking_window.lift()
            return
        self.tracking_window = TrackingWindow(self, update=update)

    def copy_boxes_next(self) -> None:
        self.media.pause()
        if self.carry.busy:
            self.status.set("Finish or cancel Track & next first.")
            return
        if (
            self.tracking_window is not None
            and self.tracking_window.winfo_exists()
            and self.tracking_window.busy
        ):
            self.status.set("Cancel or finish the tracking preview first.")
            return
        try:
            self.reader.read(self.index + 1)
            result = track_frames(self.session.document, self.index, self.index + 1, method="fixed")
            updated, changes = merge_tracking(self.session.document, result)
            if not changes.count:
                self.status.set("Nothing copied: destination boxes are protected or already match.")
                return
            if messagebox.askyesno(
                "Copy boxes to next frame?",
                changes.describe()
                + "\nPositions stay fixed. Existing manual/reviewed boxes are protected. "
                "The next frame stays draft; one Undo restores this edit.",
                parent=self.root,
            ):
                self.reader.read(self.index + 1)
                self.session.replace_document(updated)
                self.assisted_panel.follow_queue = False
                self.go(self.index + 1)
                self.status.set(
                    "Boxes carried forward as drafts. Correct, review and save this frame."
                )
        except (ValueError, OSError) as exc:
            self.error(exc)

    def review_next(self) -> None:
        if not self.mark_reviewed():
            return
        if self.assisted_panel.follow_queue:
            if self.save():
                self.assisted_panel.open_next()
        elif self.carry.enabled.get():
            self.step(1)
        else:
            self.next_unreviewed()

    def ensure_class(self) -> bool:
        name = normalize_class_name(self.label.get())
        self.label.set(name)
        if name in self.session.document.classes:
            return True
        if not self.confirm_tag_scope(name):
            return False
        self.session.change_class(name)
        self.class_combo.configure(values=self.session.document.classes)
        return True

    def confirm_tag_scope(self, name: str) -> bool:
        reviewed = sum(frame.reviewed for frame in self.session.document.frames)
        return not reviewed or messagebox.askyesno(
            "New training class",
            f"Add '{name}'? Your existing boxes are kept. {reviewed} reviewed frames "
            "will return to draft so you can check them for this new class. "
            "Undo restores the previous state.",
            parent=self.root,
        )

    def refresh_tags(self) -> None:
        scope = tuple(self.session.document.classes)
        if scope == self.tag_scope:
            return
        self.tag_scope = scope
        for child in self.tag_buttons.winfo_children():
            child.destroy()
        for index, name in enumerate(scope):
            text = name if len(name) <= 22 else name[:19] + "..."
            ttk.Button(
                self.tag_buttons, text=text, width=12, command=partial(self.apply_tag, name)
            ).grid(row=index // 2, column=index % 2, sticky="ew", padx=2, pady=2)

    def apply_tag(self, name: str | None = None) -> None:
        try:
            name = normalize_class_name(self.label.get() if name is None else name)
            if name not in self.session.document.classes and not self.confirm_tag_scope(name):
                return
            selected = self.selected
            self.session.apply_tag(self.index, name, selected)
            self.label.set(name)
            self.refresh()
            if selected is not None:
                self.objects.selection_set(selected)
                self.select_object()
            self.status.set(
                f"Tag '{name}' applied to box {selected + 1}. Save with Ctrl+S."
                if selected is not None
                else f"Tag '{name}' ready. Draw a box to use it."
            )
        except ValueError as exc:
            self.error(exc)

    def new_tag(self) -> None:
        name = simpledialog.askstring(
            "New box tag", "Name this training class (for example smoke):", parent=self.root
        )
        if name is not None:
            self.apply_tag(name)

    def rename_class(self) -> None:
        previous = self.label.get()
        if previous not in self.session.document.classes:
            self.status.set("Choose an existing class before renaming it.")
            return
        name = simpledialog.askstring(
            "Rename rescue class",
            f"Rename '{previous}' in every frame. All frames return to draft. New name:",
            parent=self.root,
        )
        if name is not None:
            try:
                self.session.change_class(name, previous)
                self.label.set(name.strip().casefold())
                self.refresh()
            except ValueError as exc:
                self.error(exc)

    def add_class(self) -> None:
        self.apply_tag()

    def remove_class(self) -> None:
        name = self.label.get().strip().casefold()
        if messagebox.askyesno(
            "Remove unused class",
            f"Remove unused tag '{name}'? Your boxes and review approvals will stay unchanged. "
            "Tags with boxes cannot be removed.",
            parent=self.root,
        ):
            try:
                self.session.remove_unused_class(name)
                self.label.set(self.session.document.classes[0])
                self.refresh()
            except ValueError as exc:
                self.error(exc)

    def choose_suggestions(self) -> None:
        if self.import_busy:
            return
        directory = filedialog.askdirectory(
            title="Choose the original rescue_review run (summary.json + frames.jsonl)",
            parent=self.root,
        )
        if directory:
            self.import_suggestions(Path(directory))

    def import_suggestions(self, directory: Path) -> None:
        if self.import_busy:
            return
        snapshot = self.session.document.model_copy(deep=True)
        self.import_busy = True
        self.import_button.configure(state="disabled")
        self.status.set("Checking saved detections and exact source-video identity...")

        def work() -> None:
            try:
                self.import_jobs.put(load_suggestions(directory, snapshot))
            except Exception as exc:
                self.import_jobs.put(exc)

        threading.Thread(target=work, daemon=True).start()

    def finish_import(self, suggestions: Suggestions) -> None:
        self.suggestions = suggestions
        unknown = set(suggestions.classes) - set(self.session.document.classes)
        if unknown:
            messagebox.showinfo(
                "Class scope",
                "Predictions outside this project's scope will not be imported: "
                + ", ".join(sorted(unknown))
                + ". Add the needed rescue classes before importing if you want to include them.",
                parent=self.root,
            )
        updated, count, skipped = merge_suggestions(
            self.session.document, suggestions, refresh_machine=self.refresh_machine_predictions
        )
        if count:
            self.session.replace_document(updated)
            original = {
                frame.frame_index
                for frame in self.session.document.frames
                if frame.suggestion_source == suggestions.source_hash and frame.objects
            }
            self.go(min(original) if original else 0)
        self.status.set(
            f"Prepared {count} frames as DRAFT suggestions. Human edits and reviews preserved. "
            f"{skipped} out-of-scope boxes excluded. "
            "Use predictions on this frame to replace existing labels explicitly."
        )

    def adopt_predictions(self) -> None:
        if self.suggestions is None:
            self.status.set("Import a recognition run first.")
            return
        predicted = next(
            (frame for frame in self.suggestions.frames if frame.frame_index == self.index), None
        )
        if predicted is None:
            self.status.set("This run did not process this frame. No predictions are available.")
            return
        if any(
            frame.frame_index == self.index for frame in self.session.document.frames
        ) and not messagebox.askyesno(
            "Replace this frame's labels?",
            "Replace this frame's boxes with the saved predictions in the project class scope? "
            "This returns the frame to draft. Undo restores the previous labels.",
            parent=self.root,
        ):
            return
        updated = self.session.document.model_copy(deep=True)
        updated.frames = [frame for frame in updated.frames if frame.frame_index != self.index]
        updated.frames.append(scoped_suggestion(predicted, updated.classes))
        self.session.replace_document(updated)
        self.refresh()
        self.status.set(
            "Predictions copied to editable drafts. Correct missed/incorrect objects before review."
        )

    def mark_draft(self) -> None:
        self.session.replace_frame(self.index, self.session.frame(self.index).objects)
        self.refresh()

    def undo(self) -> None:
        if self.session.undo():
            self.sync_metadata()
            self.refresh()

    def go(self, index: int) -> None:
        self.media.pause(refresh=False)
        if self.carry.busy:
            self.carry.cancel.set()
        index = max(0, min(self.reader.source.frame_count - 1, index))
        try:
            image = self.reader.read(index)
            self.image, self.index = image, index
            self.jump_index.set(str(index))
            self.refresh()
        except (ValueError, OSError, cv2.error) as exc:
            self.error(exc)

    def step(self, delta: int) -> None:
        self.media.pause()
        if delta == 1 and self.carry.enabled.get():
            self.carry.start()
        else:
            self.go(self.index + delta)

    def jump(self) -> None:
        try:
            self.go(int(self.jump_index.get()))
        except ValueError:
            self.status.set("Frame index must be an integer, starting at zero.")

    def next_unreviewed(self) -> None:
        reviewed = {f.frame_index for f in self.session.document.frames if f.reviewed}
        for step in range(1, self.reader.source.frame_count + 1):
            index = (self.index + step) % self.reader.source.frame_count
            if index not in reviewed:
                self.go(index)
                return
        self.status.set("All frames are marked reviewed.")

    def _metadata(self) -> None:
        incident, split = self.incident.get().strip(), self.split.get()
        if incident != self.session.document.incident_id or split != self.session.document.split:
            payload = self.session.document.model_dump()
            payload.update(incident_id=incident, split=split)
            self.session.document = type(self.session.document).model_validate(payload)
            self.session.dirty = True

    def save(self) -> bool:
        try:
            self._metadata()
            if self.session.dirty:
                self.session.save()
            save_position(
                self.session.path,
                self.reader.source,
                self.index,
                self.label.get(),
                auto_track=self.carry.enabled.get(),
                carry_mode=self.carry.method(),
            )
            self.status.set(f"Saved: {self.session.path.resolve()}")
            self.refresh()
            return True
        except (ValueError, OSError) as exc:
            self.error(exc)
            return False

    def export(self) -> None:
        try:
            if self.save():
                path = self.session.export()
                self.status.set(f"Exported reviewed frames only: {path.resolve()}")
        except (ValueError, OSError) as exc:
            self.error(exc)

    def choose_run(self) -> None:
        if self.busy or not self.save():
            return
        directory = filedialog.askdirectory(
            title="Select a rescue_review output folder", parent=self.root
        )
        if directory:
            self.evaluate(Path(directory))

    def evaluate(self, directory: Path) -> None:
        if self.busy:
            return
        self._metadata()
        snapshot = self.session.document.model_copy(deep=True)
        self.busy = True
        self.score_button.configure(state="disabled")
        self.status.set("Evaluating saved observations. No YOLO inference is rerun.")

        def work() -> None:
            try:
                result = score_saved_run(directory, snapshot)
                output = save_evaluation(self.session.path.parent / "evaluations", snapshot, result)
                self.jobs.put((result, str(output.resolve())))
            except Exception as exc:
                self.jobs.put((None, str(exc)))

        threading.Thread(target=work, daemon=True).start()

    def _poll(self) -> None:
        if self.pending_correction is not None and not self.import_busy:
            pending, self.pending_correction = self.pending_correction, None
            self.open_corrections(*pending)
        self.carry.poll()
        for project, job in list(self.validation_windows.items()):
            if job.poll() is not None:
                del self.validation_windows[project]
        try:
            imported = self.import_jobs.get_nowait()
        except queue.Empty:
            pass
        else:
            self.import_busy = False
            self.import_button.configure(state="normal")
            try:
                if isinstance(imported, Exception):
                    raise imported
                self.finish_import(imported)
            except (OSError, ValueError, RuntimeError) as exc:
                self.error(exc)
            finally:
                self.refresh_machine_predictions = False
        try:
            result, text = self.jobs.get_nowait()
        except queue.Empty:
            pass
        else:
            self.busy = False
            self.score_button.configure(state="normal")
            if result is None:
                self.error(ValueError(text))
            else:
                self.add_result(result, text)
        self.root.after(150, self._poll)

    def add_result(self, result: dict[str, Any], directory: str) -> None:
        evaluation, coverage = result["evaluation"], result["coverage"]
        overall = evaluation["overall"] or {}
        row = self.run_table.insert(
            "",
            "end",
            values=(
                Path(result["run_directory"]).name,
                metric(overall.get("precision"), True),
                metric(overall.get("recall"), True),
                metric(overall.get("false_positives")),
                metric(overall.get("false_negatives")),
                metric(evaluation["identity_switches"]),
                metric(result["processing_ms"]["p95"]),
                f"{coverage['scored_frames']}/{coverage['reviewed_frames']}",
            ),
        )
        result["output_directory"] = directory
        self.results[row] = result
        self.run_table.selection_set(row)
        self.refresh()
        self.status.set(f"Evaluation saved: {directory}")

    def select_result(self, event: tk.Event[ttk.Treeview] | None = None) -> None:
        selected = self.run_table.selection()
        if not selected:
            return
        result = self.results[selected[0]]
        self.error_panel.set_result(result)
        for row in self.class_table.get_children():
            self.class_table.delete(row)
        counts = result["evaluation"]["per_class"]
        for label in result["evaluation"]["label_scope"]:
            values = counts.get(label, {})
            self.class_table.insert(
                "",
                "end",
                values=(
                    label,
                    metric(values.get("true_positives", 0)),
                    metric(values.get("false_positives", 0)),
                    metric(values.get("false_negatives", 0)),
                    metric(values.get("precision"), True),
                    metric(values.get("recall"), True),
                ),
            )
        same = annotation_digest(self.session.document) == result["annotation_sha256"]
        coverage, fp = result["coverage"], result["false_positives"]
        freshness = "CURRENT LABEL SNAPSHOT" if same else "STALE LABELS: rescore before comparing"
        rate = metric(fp["box_detections_per_labeled_minute_nominal_fps"])
        baseline = next(iter(self.results.values()))
        reasons = comparison_reasons(baseline, result)
        comparison = (
            "NOT COMPARABLE to first run: " + ", ".join(reasons)
            if reasons
            else ("Same video, labels, IoU and scored frames as the first run.")
        )
        self._details(
            f"{freshness}\n"
            f"{comparison}\n"
            f"Reviewed coverage: {coverage['scored_frames']}/{coverage['reviewed_frames']}; "
            f"video total {coverage['source_frames']}. "
            f"Missing prediction frames: {len(coverage['missing_prediction_frames'])}.\n"
            f"Frames with false positives: {fp['frames_with_false_positives']}. "
            f"Reviewed negatives with false positives: {fp['negative_frames_with_false_positives']}"
            f"/{fp['reviewed_negative_frames']}. "
            f"FP box detections / labeled minute (nominal FPS): {rate}. "
            "Repeated boxes are not independent alarm events.\n"
            f"IoU: {result['evaluation']['iou_threshold']}. "
            "Processing p95 includes read / inference / rendering / encoding, "
            "not sensor-to-display latency. These metrics do not establish rescue readiness.\n"
            f"Run timing note: {result['processing_ms']['note']}\n"
            f"Labels SHA256: {result['annotation_sha256']}\n"
            f"Saved result: {result['output_directory']}"
        )

    def inspect_frame(self, result: dict[str, Any], frame: dict[str, Any]) -> None:
        if result["source_video_sha256"] != self.reader.source.sha256:
            self.error(ValueError("evaluation belongs to a different video"))
            return
        try:
            image = self.reader.read(frame["frame_index"])
        except (ValueError, OSError, cv2.error) as exc:
            self.error(exc)
            return

        def edit() -> None:
            inspection.window.destroy()
            self.go(frame["frame_index"])
            self.tabs.select(0)  # type: ignore[no-untyped-call]
            self.root.lift()
            self.status.set("Editing current labels. Scores retain their previous label snapshot.")

        inspection = InspectionWindow(
            self.root,
            image,
            result,
            frame,
            annotation_digest(self.session.document) == result["annotation_sha256"],
            edit,
        )

    def close(self) -> None:
        self.media.pause()
        self._metadata()
        if (
            self.busy
            or self.carry.busy
            or self.dataset_panel.busy
            or self.import_busy
            or self.training_panel.busy
            or self.assisted_panel.busy
            or any(
                isinstance(window, ClipExportWindow) and window.winfo_exists() and window.busy
                for window in self.project_windows.values()
            )
            or (
                self.tracking_window is not None
                and self.tracking_window.winfo_exists()
                and self.tracking_window.busy
            )
        ):
            self.status.set(
                "Wait for background work, or use Stop training / Stop check "
                "in Export and train, or cancel clip export / Assisted review / tracking work, "
                "before closing."
            )
            return
        if self.session.dirty:
            answer = messagebox.askyesnocancel(
                "Unsaved labels", "Save changes before closing?", parent=self.root
            )
            if answer is None or (answer and not self.save()):
                return
        try:
            save_position(
                self.session.path,
                self.reader.source,
                self.index,
                self.label.get(),
                auto_track=self.carry.enabled.get(),
                carry_mode=self.carry.method(),
            )
            self.training_panel.persist()
        except (OSError, ValueError) as exc:
            self.error(exc)
            return
        self.reader.close()
        self.root.destroy()

    def open_project_tool(self, kind: str) -> None:
        self.media.pause()
        previous = self.project_windows.get(kind)
        if previous is not None and previous.winfo_exists():
            if isinstance(previous, ProjectBoxesWindow):
                previous.reload()
            previous.lift()
            return
        if kind == "boxes":
            window: tk.Toplevel = ProjectBoxesWindow(self)
        elif kind == "review":
            window = BulkReviewWindow(self)
        elif kind == "clip":
            window = ClipExportWindow(self)
        else:
            raise ValueError("unknown project tool")
        self.project_windows[kind] = window
