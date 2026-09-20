from __future__ import annotations

import queue
import threading
import tkinter as tk
from collections import Counter
from tkinter import messagebox, ttk
from typing import TYPE_CHECKING, Literal

import cv2

from tracker.rescue.annotations import LabelFrame
from tracker.rescue.frame_tracking import (
    TrackingResult,
    hold_failed_step,
    merge_tracking,
    track_frames,
)
from tracker.rescue.state_store import WorkCancelled
from tracker.rescue.tracking_labels import STATE_COLORS, attention_count, box_caption, box_state

if TYPE_CHECKING:
    from tracker.rescue.annotation_ui import AnnotationApp


class FrameCarryBar(ttk.LabelFrame):
    def __init__(self, parent: ttk.Frame, app: AnnotationApp) -> None:
        super().__init__(parent, text="Carry boxes forward", padding=(8, 5))
        self.app = app
        self.busy = False
        self.cancel = threading.Event()
        self.events: queue.Queue[TrackingResult | Exception] = queue.Queue()
        self.start_index = -1
        self.enabled = tk.BooleanVar(value=app.carry_initial[0])
        self.mode = tk.StringVar(
            value="Follow motion" if app.carry_initial[1] == "motion" else "Keep positions"
        )
        self.summary = tk.StringVar()
        self.auto_label = tk.StringVar()
        top = ttk.Frame(self)
        top.pack(fill="x")
        self.track_button = ttk.Button(
            top, text="Track & next", style="Carry.TButton", command=self.start
        )
        self.track_button.pack(side="left")
        ttk.Combobox(
            top,
            textvariable=self.mode,
            values=["Follow motion", "Keep positions"],
            state="readonly",
            width=16,
        ).pack(side="left", padx=8)
        ttk.Checkbutton(
            top, text="Auto-track on Next", variable=self.enabled, command=self.toggle
        ).pack(side="left")
        ttk.Label(top, textvariable=self.auto_label, style="Accent.TLabel").pack(
            side="left", padx=8
        )
        self.cancel_button = ttk.Button(
            top, text="Cancel tracking", command=self.cancel.set, state="disabled"
        )
        self.cancel_button.pack(side="right")
        actions = ttk.Frame(self)
        actions.pack(fill="x", pady=(5, 3))
        ttk.Button(actions, text="Copy all boxes to next", command=app.copy_boxes_next).pack(
            side="left"
        )
        ttk.Button(actions, text="Track range...", command=app.open_tracking).pack(
            side="left", padx=6
        )
        ttk.Button(
            actions, text="Update following...", command=lambda: app.open_tracking(True)
        ).pack(side="left")
        ttk.Button(actions, text="Track details...", command=self.details).pack(side="right")
        legend = ttk.Frame(self)
        legend.pack(fill="x", pady=2)
        for name in ("Predicted", "Tracked", "Copied", "Corrected", "Reviewed", "Needs attention"):
            ttk.Label(legend, text=name, foreground=STATE_COLORS[name]).pack(
                side="left", padx=(0, 16)
            )
        self.summary_label = ttk.Label(self, textvariable=self.summary, wraplength=950)
        self.summary_label.pack(fill="x", pady=(3, 0))
        self.bind(
            "<Configure>",
            lambda event: self.summary_label.configure(wraplength=max(200, event.width - 20)),
        )
        self.mode.trace_add("write", self.change_mode)
        self.toggle()

    def method(self) -> Literal["motion", "fixed"]:
        return "motion" if self.mode.get() == "Follow motion" else "fixed"

    def toggle(self) -> None:
        if not self.enabled.get() and self.busy:
            self.cancel.set()
        self.auto_label.set("AUTO ON" if self.enabled.get() else "AUTO OFF")
        self.app.next_button.configure(text="Next (auto-track)" if self.enabled.get() else "Next")
        self.refresh(self.app.session.frame(self.app.index))

    def change_mode(self, *_: object) -> None:
        if self.busy:
            self.cancel.set()
        self.refresh(self.app.session.frame(self.app.index))

    def refresh(self, frame: LabelFrame) -> None:
        counts = Counter(box_state(frame, i) for i in range(len(frame.objects)))
        summary = ", ".join(f"{n} {name.lower()}" for name, n in counts.items()) or "No boxes"
        warning = attention_count(frame)
        hint = (
            "Correct, confirm, or delete RED boxes before tracking/reviewing."
            if warning
            else "Prediction track IDs are retained. Correct a box, then use Update following."
        )
        mode = (
            "Auto ON: Next carries one frame; jumps only navigate."
            if self.enabled.get()
            else "Auto OFF: Next only navigates. Use Track & next to carry boxes."
        )
        if self.method() == "fixed":
            mode += " Fixed positions do not check motion or presence."
        self.summary.set(f"{summary}. {hint}\n{mode}")
        self.summary_label.configure(
            foreground=STATE_COLORS["Needs attention"] if warning else "#d4dee9"
        )

    def details(self) -> None:
        frame = self.app.session.frame(self.app.index)
        lines = []
        for index in range(len(frame.objects)):
            link = frame.box_links.get(index)
            lines.append(box_caption(frame, index))
            if link:
                lines.append(f"  Internal track: {link.track_key}")
                if link.needs_attention:
                    lines.append(f"  {link.needs_attention}")
        messagebox.showinfo(
            "Tracking on this frame",
            "\n".join(lines) or "No boxes on this frame. Tracking does not discover new objects.",
            parent=self.app.root,
        )

    def start(self) -> None:
        app = self.app
        app.media.pause()
        if self.busy:
            return
        if app.import_busy or (
            app.tracking_window is not None
            and app.tracking_window.winfo_exists()
            and app.tracking_window.busy
        ):
            app.status.set("Finish or cancel the other box suggestion operation first.")
            return
        index, end = app.index, app.index + 1
        if end >= app.reader.source.frame_count:
            app.status.set("End of video. No next frame to track.")
            return
        seed = app.session.frame(index)
        if attention_count(seed):
            app.status.set(
                "Resolve red boxes: move/resize, Confirm / update selected box, or delete."
            )
            return
        if app.session.frame(end).reviewed or (not seed.objects and not seed.blocked_tracks):
            app.go(end)
            app.status.set(
                "Opened existing reviewed frame; boxes protected."
                if app.session.frame(end).reviewed
                else "No boxes to carry. Add boxes for new objects on this frame."
            )
            return
        try:
            pair = (app.image.copy(), app.reader.read(end))
            snapshot = app.session.document.model_copy(deep=True)
            method = self.method()
            self.cancel.clear()
            self.busy, self.start_index = True, index
            self.track_button.configure(state="disabled")
            self.cancel_button.configure(state="normal")
            app.status.set(
                f"Tracking frame {index} to {end}... Cancel or navigate away to discard."
            )

            def check_stop() -> None:
                if self.cancel.is_set():
                    raise WorkCancelled("Cancelled")

            def work() -> None:
                try:
                    result = track_frames(
                        snapshot, index, end, method=method, check_stop=check_stop, frame_pair=pair
                    )
                    check_stop()
                    self.events.put(hold_failed_step(result))
                except Exception as exc:
                    self.events.put(exc)

            threading.Thread(target=work, daemon=True).start()
        except (ValueError, OSError, cv2.error) as exc:
            app.status.set(str(exc))

    def poll(self) -> None:
        try:
            result = self.events.get_nowait()
        except queue.Empty:
            return
        self.busy = False
        self.track_button.configure(state="normal")
        self.cancel_button.configure(state="disabled")
        app = self.app
        if (
            self.cancel.is_set()
            or isinstance(result, WorkCancelled)
            or app.index != self.start_index
        ):
            app.status.set("Tracking cancelled or navigation changed. No suggestions applied.")
            return
        if isinstance(result, Exception):
            app.status.set(f"Tracking could not finish: {result}")
            return
        try:
            app.reader.read(result.end_frame)
            updated, changes = merge_tracking(app.session.document, result)
            if changes.count:
                app.session.replace_document(updated)
            app.assisted_panel.follow_queue = False
            app.go(result.end_frame)
            failed = sum(bool(proposal.needs_attention) for proposal in result.proposals)
            app.status.set(
                (f"{failed} tracking failures. " if failed else "")
                + changes.describe()
                + " Drafts only. One Undo restores the carry edit."
            )
        except (ValueError, OSError, cv2.error) as exc:
            app.status.set(f"Suggestions not applied: {exc}")
