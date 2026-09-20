from __future__ import annotations

import queue
import threading
import tkinter as tk
from tkinter import messagebox, ttk
from typing import TYPE_CHECKING, Literal

import cv2
import numpy as np
from numpy.typing import NDArray

from tracker.rescue.annotations import AnnotationDocument
from tracker.rescue.frame_tracking import TrackingResult, merge_tracking, track_frames
from tracker.rescue.state_store import WorkCancelled
from tracker.rescue.tracking_labels import STATE_COLORS, box_caption, box_state

if TYPE_CHECKING:
    from tracker.rescue.annotation_ui import AnnotationApp


class TrackingWindow(tk.Toplevel):
    def __init__(self, app: AnnotationApp, *, update: bool = False) -> None:
        super().__init__(app.root)
        self.app = app
        self.title("Rescue Studio | Carry boxes forward")
        self.geometry("1040x810")
        self.minsize(900, 680)
        self.busy = False
        self.cancel = threading.Event()
        self.events: queue.Queue[TrackingResult | Exception] = queue.Queue()
        self.progress: queue.Queue[str] = queue.Queue()
        self.result: TrackingResult | None = None
        self.merged: AnnotationDocument | None = None
        self.request: tuple[str, str, str, bool] | None = None
        self.scope = tk.StringVar(
            value="Selected box" if update and app.selected is not None else "All boxes"
        )
        self.mode = tk.StringVar(value="Follow motion")
        self.end = tk.StringVar(value=str(app.reader.source.frame_count - 1))
        self.update_generated = tk.BooleanVar(value=True)
        self.status = tk.StringVar(
            value="Preview first. Nothing changes until you apply the drafts."
        )
        self.seed_hint = tk.StringVar()
        self.photo: tk.PhotoImage | None = None
        self.preview_image: NDArray[np.uint8] | None = None
        body = ttk.Frame(self, padding=16)
        body.pack(fill="both", expand=True)
        body.columnconfigure(0, weight=1)
        body.rowconfigure(5, weight=1)
        ttk.Label(body, text="Carry boxes forward", style="Title.TLabel").grid(
            row=0, column=0, sticky="w"
        )
        self.seed_hint.set(f"Starting frame: {app.index}. Uses the current frame when you preview.")
        ttk.Label(body, textvariable=self.seed_hint).grid(row=1, column=0, sticky="w", pady=6)
        controls = ttk.Frame(body)
        controls.grid(row=2, column=0, sticky="ew")
        ttk.Combobox(
            controls,
            textvariable=self.scope,
            values=["All boxes", "Selected box"],
            state="readonly",
            width=15,
        ).pack(side="left")
        ttk.Combobox(
            controls,
            textvariable=self.mode,
            values=["Follow motion", "Fixed positions (copy)"],
            state="readonly",
            width=24,
        ).pack(side="left", padx=6)
        ttk.Label(controls, text="End frame:").pack(side="left", padx=(8, 4))
        ttk.Entry(controls, textvariable=self.end, width=8).pack(side="left")
        ttk.Button(
            controls,
            text="To end of video",
            command=lambda: self.end.set(str(app.reader.source.frame_count - 1)),
        ).pack(side="left", padx=6)
        settings = ttk.Frame(body)
        settings.grid(row=3, column=0, sticky="ew", pady=8)
        ttk.Checkbutton(
            settings,
            text="Update this track's untouched generated drafts",
            variable=self.update_generated,
        ).pack(anchor="w")
        ttk.Label(
            settings,
            text="Hand edits and reviewed frames are protected keyframes. "
            "Fixed positions do not compensate for camera motion.\n"
            "Limit: 5,000 frames / 100,000 box-frames per preview. "
            "Motion checks can stop a track early; support is not accuracy.",
            wraplength=860,
            style="Muted.TLabel",
        ).pack(anchor="w", pady=5)
        navigation = ttk.Frame(body)
        navigation.grid(row=4, column=0, sticky="ew", pady=(0, 8))
        self.preview_button = ttk.Button(navigation, text="Preview tracking", command=self.start)
        self.preview_button.pack(side="left")
        ttk.Button(navigation, text="Cancel", command=self.cancel.set).pack(side="left", padx=6)
        ttk.Label(navigation, text="Preview frame:").pack(side="left", padx=6)
        self.frames = ttk.Combobox(navigation, state="readonly", width=10)
        self.frames.pack(side="left")
        self.frames.bind("<<ComboboxSelected>>", lambda _: self.preview())
        ttk.Button(navigation, text="Previous", command=lambda: self.step(-1)).pack(
            side="left", padx=6
        )
        ttk.Button(navigation, text="Next", command=lambda: self.step(1)).pack(side="left")
        self.canvas = tk.Canvas(body, background="#080e15", highlightthickness=0, height=260)
        self.canvas.grid(row=5, column=0, sticky="nsew")
        self.canvas.bind("<Configure>", lambda _: self.draw())
        ttk.Label(
            body,
            text="Blue: tracked. Purple: copied/draft. Green: reviewed. Yellow: corrected. "
            "Red: needs attention. White: manual/keyframe. "
            "The preview shows the proposed merged result.",
            wraplength=860,
            style="Muted.TLabel",
        ).grid(row=6, column=0, sticky="w", pady=6)
        self.log = tk.Text(
            body,
            height=4,
            wrap="word",
            background="#1b2938",
            foreground="#e9f0f7",
            state="disabled",
        )
        self.log.grid(row=7, column=0, sticky="ew")
        actions = ttk.Frame(body)
        actions.grid(row=8, column=0, sticky="ew", pady=8)
        self.apply_button = ttk.Button(
            actions, text="Apply drafts and review...", command=self.apply, state="disabled"
        )
        self.apply_button.pack(side="left")
        ttk.Button(actions, text="Close preview", command=self.close).pack(side="right")
        ttk.Label(body, textvariable=self.status, wraplength=860, style="Accent.TLabel").grid(
            row=9, column=0, sticky="ew"
        )
        self.protocol("WM_DELETE_WINDOW", self.close)
        self.after_id = self.after(100, self.poll)
        self.bind("<Destroy>", self.cleanup)
        for variable in (self.scope, self.mode, self.end, self.update_generated):
            variable.trace_add("write", self.invalidate)

    def options(self) -> tuple[str, str, str, bool]:
        return self.scope.get(), self.mode.get(), self.end.get(), self.update_generated.get()

    def invalidate(self, *_: object) -> None:
        self.result = None
        self.merged = None
        self.preview_image = None
        self.canvas.delete("all")
        self.frames.set("")
        self.frames.configure(values=[])
        self.apply_button.configure(state="disabled")
        self.status.set("Settings changed. Preview again before applying.")

    def cleanup(self, event: tk.Event[tk.Misc]) -> None:
        if event.widget is self:
            self.cancel.set()
            self.after_cancel(self.after_id)

    def error(self, exc: Exception) -> None:
        self.status.set(str(exc))
        messagebox.showerror("Carry boxes forward", str(exc), parent=self)

    def start(self) -> None:
        if self.busy:
            return
        try:
            end = int(self.end.get())
            index = self.app.index
            selected = None
            if self.scope.get() == "Selected box":
                if self.app.selected is None:
                    raise ValueError("Select a box in the editor, or choose All boxes.")
                selected = [self.app.selected]
            snapshot = self.app.session.document.model_copy(deep=True)
            self.invalidate()
            self.request = self.options()
            method: Literal["fixed", "motion"] = (
                "fixed" if self.mode.get().startswith("Fixed") else "motion"
            )
            self.seed_hint.set(f"Preview starts at frame {index}, ends at frame {end}.")
            self.cancel.clear()
            self.busy = True
            self.preview_button.configure(state="disabled")
            self.status.set("Building suggestions in the background. You can cancel.")

            def check_stop() -> None:
                if self.cancel.is_set():
                    raise WorkCancelled("Cancelled. No labels were changed.")

            def work() -> None:
                try:
                    self.events.put(
                        track_frames(
                            snapshot,
                            index,
                            end,
                            selected,
                            method=method,
                            check_stop=check_stop,
                            progress=self.progress.put,
                        )
                    )
                except Exception as exc:
                    self.events.put(exc)

            threading.Thread(target=work, daemon=True).start()
        except (OSError, ValueError) as exc:
            self.error(exc)

    def receive(self, result: TrackingResult) -> None:
        if self.request != self.options():
            self.status.set("Settings changed while tracking. Preview again.")
            return
        merged, changes = merge_tracking(
            self.app.session.document, result, update_generated=self.update_generated.get()
        )
        self.result, self.merged = result, merged
        frames = sorted(
            set(changes.frames)
            | {item.frame_index for item in result.proposals}
            | {min(result.end_frame, item.last_frame + 1) for item in result.stops}
        )
        self.frames.configure(values=[str(index) for index in frames])
        if frames:
            self.frames.current(0)
            self.preview()
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.insert(
            "1.0",
            "\n".join(
                f"{item.label}: last suggestion {item.last_frame}. {item.reason}"
                for item in result.stops
            ),
        )
        self.log.configure(state="disabled")
        self.status.set(changes.describe() + " No changes saved yet.")
        self.apply_button.configure(state="normal" if changes.count else "disabled")

    def step(self, delta: int) -> None:
        values = self.frames.cget("values")
        index = self.frames.current() + delta
        if 0 <= index < len(values):
            self.frames.current(index)
            self.preview()

    def preview(self) -> None:
        if self.merged is None or not self.frames.get():
            return
        try:
            index = int(self.frames.get())
            image = self.app.reader.read(index)
            frame = next((item for item in self.merged.frames if item.frame_index == index), None)
            if frame is not None:
                for ordinal, obj in enumerate(frame.objects):
                    shade = STATE_COLORS[box_state(frame, ordinal)]
                    color = (int(shade[5:7], 16), int(shade[3:5], 16), int(shade[1:3], 16))
                    x1, y1, x2, y2 = map(round, obj.bbox_xyxy)
                    cv2.rectangle(image, (x1, y1), (x2, y2), color, 2)
                    cv2.putText(
                        image,
                        box_caption(frame, ordinal),
                        (x1, max(12, y1 - 4)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.45,
                        color,
                        1,
                    )
            self.preview_image = image
            self.draw()
        except (ValueError, OSError, cv2.error) as exc:
            self.error(exc)

    def draw(self) -> None:
        if self.preview_image is None:
            return
        height, width = self.preview_image.shape[:2]
        available_width, available_height = (
            max(1, self.canvas.winfo_width()),
            max(1, self.canvas.winfo_height()),
        )
        scale = min(available_width / width, available_height / height)
        resized = cv2.resize(
            self.preview_image, (max(1, round(width * scale)), max(1, round(height * scale)))
        )
        ok, encoded = cv2.imencode(".png", resized)
        if ok:
            self.photo = tk.PhotoImage(data=encoded.tobytes())
            self.canvas.delete("all")
            self.canvas.create_image(available_width / 2, available_height / 2, image=self.photo)

    def apply(self) -> None:
        if self.busy or self.result is None:
            return
        try:
            self.app.reader.read(self.result.seed_frame)
            updated, changes = merge_tracking(
                self.app.session.document,
                self.result,
                update_generated=self.update_generated.get(),
            )
            if not changes.count:
                return
            if not messagebox.askyesno(
                "Apply draft boxes?",
                changes.describe() + "\nHand-edited boxes and reviewed frames are preserved. "
                "Removed boxes are only untouched suggestions from these tracks. "
                "One Undo restores this entire edit. Continue?",
                parent=self,
            ):
                return
            self.app.session.replace_document(updated)
            self.app.assisted_panel.follow_queue = False
            self.app.go(changes.frames[0])
            self.app.refresh()
            self.app.status.set(
                "Carried boxes added as drafts. Review each frame and save. "
                "Correct a box, then use Update following to refresh later drafts."
            )
            self.destroy()
        except (ValueError, OSError) as exc:
            self.error(exc)

    def poll(self) -> None:
        try:
            while True:
                self.status.set(self.progress.get_nowait())
        except queue.Empty:
            pass
        try:
            result = self.events.get_nowait()
        except queue.Empty:
            pass
        else:
            self.busy = False
            self.preview_button.configure(state="normal")
            if self.cancel.is_set() or isinstance(result, WorkCancelled):
                self.status.set("Cancelled. No labels were changed.")
            elif isinstance(result, Exception):
                self.error(result)
            else:
                try:
                    self.receive(result)
                except (OSError, ValueError) as exc:
                    self.error(exc)
        self.after_id = self.after(100, self.poll)

    def close(self) -> None:
        if self.busy:
            self.cancel.set()
            self.status.set("Cancelling. Close this preview when the worker has stopped.")
        else:
            self.destroy()
