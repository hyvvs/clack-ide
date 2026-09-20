from __future__ import annotations

import base64
import math
import tkinter as tk
from pathlib import Path
from tkinter import ttk

import cv2


class PredictionPreview(tk.Toplevel):
    def __init__(self, parent: tk.Misc, video: Path, model_name: str = "Model preview") -> None:
        capture = cv2.VideoCapture(str(video))
        if not capture.isOpened():
            capture.release()
            raise ValueError("The saved preview video could not be opened.")
        super().__init__(parent)
        self.capture = capture
        self.title(f"{model_name} | prediction preview")
        self.geometry("1000x700")
        self.minsize(650, 450)
        self.playing = False
        self.timer: str | None = None
        self.photo: tk.PhotoImage | None = None
        fps = float(capture.get(cv2.CAP_PROP_FPS))
        self.delay = max(15, round(1000 / fps)) if math.isfinite(fps) and fps > 0 else 40
        body = ttk.Frame(self, padding=12)
        body.pack(fill="both", expand=True)
        ttk.Label(body, text=model_name, font=("Segoe UI Semibold", 14)).pack(anchor="w", pady=4)
        ttk.Label(body, text="NOT INDEPENDENTLY TESTED", style="Accent.TLabel").pack(anchor="w")
        ttk.Label(
            body,
            text="Machine predictions on the first 300 frames, "
            "not approved labels or an accuracy score.",
        ).pack(anchor="w", pady=6)
        actions = ttk.Frame(body)
        actions.pack(fill="x", pady=8)
        self.button = ttk.Button(actions, text="Play", command=self.toggle)
        self.button.pack(side="left")
        ttk.Button(actions, text="Restart", command=self.restart).pack(side="left", padx=8)
        ttk.Button(actions, text="Close", command=self.destroy).pack(side="right")
        self.canvas = tk.Canvas(body, bg="#080e14", highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        self.timer = self.after_idle(self.draw_frame)
        self.protocol("WM_DELETE_WINDOW", self.destroy)

    def draw_frame(self) -> None:
        self.timer = None
        ok, frame = self.capture.read()
        if not ok:
            self.playing = False
            self.button.configure(text="Play")
            return
        height, width = frame.shape[:2]
        scale = min(
            max(320, self.canvas.winfo_width()) / width,
            max(240, self.canvas.winfo_height()) / height,
        )
        resized = cv2.resize(frame, (max(1, round(width * scale)), max(1, round(height * scale))))
        encoded_ok, encoded = cv2.imencode(".png", resized)
        if encoded_ok:
            self.photo = tk.PhotoImage(master=self, data=base64.b64encode(encoded.tobytes()))
            self.canvas.delete("all")
            self.canvas.create_image(0, 0, image=self.photo, anchor="nw")
        if self.playing:
            self.timer = self.after(self.delay, self.draw_frame)

    def toggle(self) -> None:
        self.playing = not self.playing
        self.button.configure(text="Pause" if self.playing else "Play")
        if self.timer is not None:
            self.after_cancel(self.timer)
            self.timer = None
        if self.playing:
            self.draw_frame()

    def restart(self) -> None:
        if self.timer is not None:
            self.after_cancel(self.timer)
            self.timer = None
        self.capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
        self.draw_frame()

    def destroy(self) -> None:
        if self.timer is not None:
            self.after_cancel(self.timer)
            self.timer = None
        self.capture.release()
        super().destroy()
