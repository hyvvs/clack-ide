from __future__ import annotations

import queue
import threading
import tkinter as tk
from functools import partial
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import TYPE_CHECKING

import cv2

from tracker.rescue.annotations import AnnotationDocument
from tracker.rescue.clip_export import export_clip
from tracker.rescue.desktop_jobs import DesktopJob
from tracker.rescue.project_tools import bulk_review, frame_range, timestamp
from tracker.rescue.tracking_labels import STATE_COLORS, attention_count, box_state

if TYPE_CHECKING:
    from tracker.rescue.annotation_ui import AnnotationApp


class RangeWindow(tk.Toplevel):
    def __init__(self, app: AnnotationApp, title: str) -> None:
        super().__init__(app.root)
        self.app = app
        self.title(title)
        self.geometry("960x700")
        self.minsize(900, 650)
        self.start = tk.StringVar(value=str(app.index))
        self.end = tk.StringVar(value=str(app.reader.source.frame_count - 1))
        self.status = tk.StringVar()
        self.shell = ttk.Frame(self, padding=16)
        self.shell.pack(fill="both", expand=True)
        ttk.Label(
            self.shell,
            text="Inclusive frame range (numbered from zero). Navigate the main video, "
            "then use Set from current for the In and Out points.",
            wraplength=880,
        ).pack(anchor="w", pady=(0, 10))
        controls = ttk.Frame(self.shell)
        controls.pack(fill="x")
        for name, variable in (("In", self.start), ("Out", self.end)):
            ttk.Label(controls, text=name).pack(side="left", padx=(6, 2))
            ttk.Entry(controls, textvariable=variable, width=8).pack(side="left")
            ttk.Button(
                controls,
                text="Set from current",
                command=partial(self.mark_current, variable),
            ).pack(side="left", padx=3)
            ttk.Button(
                controls,
                text=f"View {name}",
                command=partial(self.view, variable),
            ).pack(side="left", padx=(0, 8))
        ttk.Button(controls, text="Whole video", command=self.whole_video).pack(side="right")
        ttk.Label(self.shell, textvariable=self.status, wraplength=880).pack(
            side="bottom", fill="x", pady=10
        )

    def bounds(self) -> tuple[int, int]:
        start, end = int(self.start.get()), int(self.end.get())
        frame_range(self.app.session.document, start, end)
        return start, end

    def mark_current(self, variable: tk.StringVar) -> None:
        self.app.media.pause()
        variable.set(str(self.app.index))

    def whole_video(self) -> None:
        self.start.set("0")
        self.end.set(str(self.app.reader.source.frame_count - 1))

    def view(self, variable: tk.StringVar) -> None:
        try:
            index = int(variable.get())
            frame_range(self.app.session.document, index, index)
            self.app.go(index)
        except ValueError as exc:
            self.status.set(str(exc))


class BulkReviewWindow(RangeWindow):
    PAGE_SIZE = 6

    def __init__(self, app: AnnotationApp) -> None:
        super().__init__(app, "Review frames in batches")
        self.page = 0
        self.shown_bounds = (0, 0)
        self.snapshot = app.session.document.model_copy(deep=True)
        self.ready = False
        self.photos: list[tk.PhotoImage] = []
        self.indices: list[int] = []
        self.include_empty = tk.BooleanVar(value=False)
        navigation = ttk.Frame(self.shell)
        navigation.pack(fill="x", pady=10)
        ttk.Button(navigation, text="Show / refresh range", command=self.reload).pack(side="left")
        ttk.Button(navigation, text="Previous 6", command=lambda: self.turn_page(-1)).pack(
            side="left", padx=6
        )
        ttk.Button(navigation, text="Next 6", command=lambda: self.turn_page(1)).pack(side="left")
        self.page_label = tk.StringVar()
        ttk.Label(navigation, textvariable=self.page_label).pack(side="left", padx=12)
        ttk.Label(
            self.shell,
            text="Check ALL scoped classes, missing boxes and false positives. "
            "Click a thumbnail to correct it in the main editor, then refresh this page.",
            wraplength=880,
        ).pack(anchor="w", pady=(0, 8))
        self.grid_frame = ttk.Frame(self.shell)
        self.grid_frame.pack(fill="both", expand=True)
        self.canvases: list[tk.Canvas] = []
        for index in range(self.PAGE_SIZE):
            canvas = tk.Canvas(
                self.grid_frame, width=275, height=170, background="#080e15", highlightthickness=1
            )
            canvas.grid(row=index // 3, column=index % 3, sticky="nsew", padx=3, pady=3)
            canvas.bind("<Button-1>", partial(self.open_frame, index))
            self.canvases.append(canvas)
        for column in range(3):
            self.grid_frame.columnconfigure(column, weight=1)
        for row in range(2):
            self.grid_frame.rowconfigure(row, weight=1)
        ttk.Checkbutton(
            self.shell,
            text="Include empty / unlabeled frames as reviewed NEGATIVES (explicitly checked)",
            variable=self.include_empty,
        ).pack(anchor="w", pady=8)
        actions = ttk.Frame(self.shell)
        actions.pack(fill="x")
        ttk.Button(
            actions, text="Mark this page reviewed...", command=lambda: self.apply(True, True)
        ).pack(side="left")
        ttk.Button(
            actions, text="Mark entire range reviewed...", command=lambda: self.apply(True, False)
        ).pack(side="left", padx=6)
        ttk.Button(
            actions, text="Return range to draft...", command=lambda: self.apply(False, False)
        ).pack(side="right")
        self.reload()

    def reload(self) -> None:
        self.page = 0
        self.render()

    def turn_page(self, delta: int) -> None:
        try:
            start, end = self.bounds()
            self.page = max(0, min((end - start) // self.PAGE_SIZE, self.page + delta))
            self.render()
        except ValueError as exc:
            self.status.set(str(exc))

    def render(self) -> None:
        self.app.media.pause()
        self.ready = False
        self.photos.clear()
        self.indices.clear()
        for canvas in self.canvases:
            canvas.delete("all")
        try:
            start, end = self.bounds()
            if self.shown_bounds != (start, end):
                self.page = 0
            self.shown_bounds = (start, end)
            self.snapshot = self.app.session.document.model_copy(deep=True)
            begin = start + self.page * self.PAGE_SIZE
            indices = list(range(begin, min(end + 1, begin + self.PAGE_SIZE)))
            frames = {frame.frame_index: frame for frame in self.snapshot.frames}
            for slot, index in enumerate(indices):
                image = self.app.reader.read(index)
                scale = min(275 / image.shape[1], 140 / image.shape[0])
                resized = cv2.resize(
                    image,
                    (max(1, round(image.shape[1] * scale)), max(1, round(image.shape[0] * scale))),
                )
                frame = frames.get(index)
                ok, encoded = cv2.imencode(".ppm", resized)
                if not ok:
                    raise ValueError("Could not render thumbnail.")
                photo = tk.PhotoImage(master=self, data=encoded.tobytes(), format="PPM")
                self.photos.append(photo)
                canvas = self.canvases[slot]
                canvas.create_image(0, 0, anchor="nw", image=photo)
                if frame is not None:
                    for box_index, obj in enumerate(frame.objects):
                        color = STATE_COLORS[box_state(frame, box_index)]
                        coords = [value * scale for value in obj.bbox_xyxy]
                        canvas.create_rectangle(*coords, outline=color, width=2)
                        canvas.create_text(
                            coords[0], coords[1], anchor="nw", fill=color, text=obj.label, width=180
                        )
                state = (
                    "NEEDS ATTENTION"
                    if frame and attention_count(frame)
                    else ("REVIEWED" if frame and frame.reviewed else "DRAFT")
                )
                caption = f"Frame {index} | {len(frame.objects) if frame else 0} boxes | {state}"
                canvas.create_text(4, 146, anchor="nw", fill="#e9f0f7", text=caption, width=265)
            self.indices = indices
            self.page_label.set(f"Page {self.page + 1}/{(end - start) // self.PAGE_SIZE + 1}")
            self.status.set(
                f"Frames {start}-{end} | {timestamp(start, self.snapshot.source.nominal_fps)} to "
                f"{timestamp(end, self.snapshot.source.nominal_fps)}. "
                "Nothing is approved automatically. Bulk changes support one Undo; "
                "Save persists them."
            )
            self.ready = True
        except (ValueError, OSError, cv2.error) as exc:
            self.status.set(str(exc))

    def open_frame(self, slot: int, _: object = None) -> None:
        if self.ready and slot < len(self.indices):
            self.app.go(self.indices[slot])

    def apply(self, reviewed: bool, page_only: bool) -> None:
        self.app.media.pause()
        if (
            self.app.carry.busy
            or self.app.import_busy
            or (
                self.app.tracking_window is not None
                and self.app.tracking_window.winfo_exists()
                and self.app.tracking_window.busy
            )
        ):
            self.status.set("Finish or cancel box generation first, then refresh the thumbnails.")
            return
        try:
            bounds = self.bounds()
            if (
                not self.ready
                or bounds != self.shown_bounds
                or self.snapshot != self.app.session.document
            ):
                self.render()
                self.status.set(
                    "Range or labels changed. Thumbnails refreshed; inspect them and click again."
                )
                return
            start, end = (self.indices[0], self.indices[-1]) if page_only else bounds
            updated, changes = bulk_review(
                self.snapshot,
                start,
                end,
                reviewed=reviewed,
                include_empty=self.include_empty.get(),
            )
            if not changes.changed:
                self.status.set(changes.describe())
                return
            confirm = (
                f"Frames {start}-{end}: {'mark reviewed' if reviewed else 'return to draft'}?\n\n"
                + changes.describe()
                + "\n\n"
                + (
                    "The ENTIRE range includes frames not on this thumbnail page.\n"
                    if not page_only
                    else ""
                )
                + (
                    "Confirm you checked every affected frame for all scoped classes.\n"
                    if reviewed
                    else ""
                )
                + "No boxes are changed. One Undo restores this batch. Save is separate."
            )
            if not messagebox.askyesno("Confirm bulk review", confirm, parent=self):
                return
            if self.snapshot != self.app.session.document:
                self.status.set("Labels changed during confirmation. Refresh and retry.")
                return
            self.app.reader.read(start)
            self.app.session.replace_document(updated)
            self.app.refresh()
            self.render()
            self.status.set(
                f"Changed {changes.changed} frames. Undo in the main editor restores this batch; "
                "Save persists it."
            )
        except (ValueError, OSError, cv2.error) as exc:
            self.status.set(str(exc))


class ClipExportWindow(RangeWindow):
    def __init__(self, app: AnnotationApp) -> None:
        super().__init__(app, "Cut a clip without changing the original")
        self.geometry("960x440")
        self.minsize(900, 420)
        self.busy = False
        self.cancel = threading.Event()
        self.events: queue.Queue[tuple[str, str | Path | Exception]] = queue.Queue()
        self.output = tk.StringVar(value=str(app.session.path.parent / "clips"))
        self.result: Path | None = None
        ttk.Label(
            self.shell,
            text="Creates a separate, lossless AVI video and editable label project. "
            "The selected In and Out frames are both included. Boxes, IDs and review states "
            "are preserved with frame numbers starting at zero.\n\n"
            "Video only: audio is not copied. Lossless clips can be large. "
            "The original video and project are never trimmed or overwritten. "
            "Labels are a snapshot taken when you press Export. "
            "Related clips stay in the same dataset split.",
            wraplength=870,
        ).pack(fill="x", pady=20)
        output = ttk.Frame(self.shell)
        output.pack(fill="x")
        ttk.Label(output, text="Destination folder").pack(side="left")
        ttk.Entry(output, textvariable=self.output).pack(side="left", fill="x", expand=True, padx=6)
        ttk.Button(output, text="Browse...", command=self.browse).pack(side="left")
        actions = ttk.Frame(self.shell)
        actions.pack(fill="x", pady=12)
        self.export_button = ttk.Button(
            actions, text="Export clip + labels", command=self.start_export
        )
        self.export_button.pack(side="left")
        self.cancel_button = ttk.Button(
            actions, text="Cancel export", command=self.cancel.set, state="disabled"
        )
        self.cancel_button.pack(side="left", padx=6)
        self.open_button = ttk.Button(
            actions, text="Open exported project", command=self.open_result, state="disabled"
        )
        self.open_button.pack(side="right")
        self.protocol("WM_DELETE_WINDOW", self.close)

    def browse(self) -> None:
        directory = filedialog.askdirectory(title="Choose a destination for new clips", parent=self)
        if directory:
            self.output.set(directory)

    def start_export(self) -> None:
        self.app.media.pause()
        if self.busy:
            return
        try:
            start, end = self.bounds()
            if not self.output.get().strip():
                raise ValueError("Choose a destination folder.")
            output = Path(self.output.get()).resolve()
            self.app._metadata()
            snapshot = self.app.session.document.model_copy(deep=True)
        except (ValueError, OSError) as exc:
            self.status.set(str(exc))
            return
        self.busy = True
        self.result = None
        self.cancel.clear()
        self.export_button.configure(state="disabled")
        self.open_button.configure(state="disabled")
        self.cancel_button.configure(state="normal")
        self.status.set(f"Exporting frames {start}-{end} to a new folder in {output}...")

        def work() -> None:
            try:
                result = export_clip(
                    snapshot,
                    output,
                    start,
                    end,
                    cancel=self.cancel,
                    progress=lambda text: self.events.put(("progress", text)),
                )
                self.events.put(("done", result))
            except Exception as exc:
                self.events.put(("error", exc))

        threading.Thread(target=work, daemon=True).start()
        self.after(100, self.poll)

    def poll(self) -> None:
        while not self.events.empty():
            kind, value = self.events.get_nowait()
            if kind == "progress":
                self.status.set(str(value))
                continue
            self.busy = False
            self.export_button.configure(state="normal")
            self.cancel_button.configure(state="disabled")
            if kind == "done" and isinstance(value, Path):
                self.result = value
                self.open_button.configure(state="normal")
                self.status.set(
                    f"Verified clip and label project saved: {value}. "
                    "Original unchanged. Audio not included."
                )
            else:
                self.status.set(f"Clip export stopped: {value}")
        if self.busy:
            self.after(100, self.poll)

    def open_result(self) -> None:
        if self.result is None:
            return
        existing = self.app.validation_windows.get(self.result)
        if existing is not None and existing.poll() is None:
            self.status.set("This clip project is already open in another Studio window.")
            return
        try:
            document = AnnotationDocument.model_validate_json(self.result.read_bytes())
            self.app.validation_windows[self.result] = DesktopJob(
                Path.cwd(),
                "tracker.cli.rescue_annotate",
                ["--video", document.source.path, "--project", str(self.result)],
            )
        except (ValueError, OSError) as exc:
            self.status.set(str(exc))

    def close(self) -> None:
        if self.busy:
            self.cancel.set()
            self.status.set("Cancelling export. Wait for cleanup, then close this window.")
        else:
            self.destroy()
