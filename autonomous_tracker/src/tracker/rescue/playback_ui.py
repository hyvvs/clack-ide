from __future__ import annotations

import time
import tkinter as tk
from functools import partial
from tkinter import ttk
from typing import TYPE_CHECKING

import cv2

from tracker.rescue.project_tools import timestamp

if TYPE_CHECKING:
    from tracker.rescue.annotation_ui import AnnotationApp


class PlaybackBar(ttk.Frame):
    def __init__(self, parent: ttk.Frame, app: AnnotationApp) -> None:
        super().__init__(parent)
        self.app = app
        self.playing = False
        self.callback: str | None = None
        self.syncing = False
        self.speed = tk.StringVar(value="1x")
        self.position = tk.DoubleVar(value=app.index)
        self.clock = tk.StringVar()
        self.button = ttk.Button(self, text="Play", width=6, command=self.toggle)
        self.button.pack(side="left")
        ttk.Combobox(
            self,
            textvariable=self.speed,
            values=["0.25x", "0.5x", "1x", "2x", "4x"],
            state="readonly",
            width=5,
        ).pack(side="left", padx=4)
        self.slider = ttk.Scale(
            self,
            from_=0,
            to=app.reader.source.frame_count - 1,
            variable=self.position,
            command=self.seek,
        )
        self.slider.pack(side="left", fill="x", expand=True, padx=6)
        ttk.Label(self, textvariable=self.clock, width=23).pack(side="left")
        for label, kind in (
            ("All boxes...", "boxes"),
            ("Cut clip...", "clip"),
            ("Bulk review...", "review"),
        ):
            ttk.Button(self, text=label, command=partial(app.open_project_tool, kind)).pack(
                side="left", padx=2
            )
        self.bindings = {
            sequence: app.root.bind(sequence, self.interaction, add="+")
            for sequence in ("<ButtonPress-1>", "<KeyPress>")
        }
        self.bind("<Destroy>", self.dispose)
        self.sync()

    def dispose(self, event: tk.Event[tk.Misc]) -> None:
        if event.widget != self:
            return
        self.playing = False
        if self.callback is not None:
            self.after_cancel(self.callback)
            self.callback = None
        for sequence, binding in self.bindings.items():
            self.app.root.unbind(sequence, binding)

    def interaction(self, event: tk.Event[tk.Misc]) -> None:
        if event.widget != self.button:
            self.pause()

    def sync(self) -> None:
        self.syncing = True
        try:
            self.position.set(self.app.index)
        finally:
            self.syncing = False
        self.clock.set(
            f"{timestamp(self.app.index, self.app.reader.source.nominal_fps)} | "
            f"frame {self.app.index}"
        )

    def seek(self, value: str) -> None:
        if not self.syncing:
            self.app.go(round(float(value)))

    def toggle(self) -> None:
        if self.playing:
            self.pause()
            return
        if (
            self.app.carry.busy
            or self.app.import_busy
            or (
                self.app.tracking_window is not None
                and self.app.tracking_window.winfo_exists()
                and self.app.tracking_window.busy
            )
        ):
            self.app.status.set("Finish or cancel box generation before playback.")
            return
        if self.app.index == self.app.reader.source.frame_count - 1:
            self.app.go(0)
        self.playing = True
        self.button.configure(text="Pause")
        self.app.status.set(
            "Playing video only (no audio). Existing boxes are shown; playback never carries "
            "boxes or marks frames reviewed. Click the image to pause and edit."
        )
        self.schedule()

    def schedule(self, elapsed: float = 0.0) -> None:
        interval = 1 / (self.app.reader.source.nominal_fps * float(self.speed.get()[:-1]))
        self.callback = self.after(max(1, round((interval - elapsed) * 1000)), self.tick)

    def tick(self) -> None:
        self.callback = None
        if not self.playing:
            return
        if self.app.index >= self.app.reader.source.frame_count - 1:
            self.pause()
            self.app.status.set("End of video. Playback did not change any labels or review flags.")
            return
        started = time.monotonic()
        try:
            index = self.app.index + 1
            self.app.image = self.app.reader.read(index)
            self.app.index = index
            self.app.jump_index.set(str(index))
            self.app.refresh(light=True)
        except (ValueError, OSError, cv2.error) as exc:
            self.pause()
            self.app.status.set(f"Playback stopped: {exc}")
            return
        if self.playing:
            self.schedule(time.monotonic() - started)

    def pause(self, *, refresh: bool = True) -> None:
        was_playing = self.playing
        self.playing = False
        if self.callback is not None:
            self.after_cancel(self.callback)
            self.callback = None
        self.button.configure(text="Play")
        if was_playing and refresh:
            self.app.refresh()
