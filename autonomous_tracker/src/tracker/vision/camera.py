"""Camera source protocols and optional OpenCV backends."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Protocol

import cv2
import numpy as np

from tracker.types import Frame


class CameraSource(Protocol):
    """Source of timestamped image frames."""

    def read(self) -> Frame | None:
        """Return the next frame, or None when unavailable."""
        ...

    def close(self) -> None:
        """Release owned acquisition resources."""
        ...


class OpenCVCamera:
    """USB camera source backed by OpenCV VideoCapture."""

    def __init__(
        self,
        device: int | str,
        width: int,
        height: int,
        fps: float,
        exposure: float | None = None,
    ) -> None:
        self._capture = cv2.VideoCapture(device)
        if not self._capture.isOpened():
            raise RuntimeError(f"unable to open camera: {device}")
        self._capture.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self._capture.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        self._capture.set(cv2.CAP_PROP_FPS, fps)
        if exposure is not None:
            self._capture.set(cv2.CAP_PROP_EXPOSURE, exposure)
        self._frame_id = 0

    def read(self) -> Frame | None:
        """Capture the next frame with monotonic capture and processing timestamps."""
        capture_timestamp_ns = time.monotonic_ns()
        ok, image = self._capture.read()
        if not ok:
            return None
        image_array = np.asarray(image, dtype=np.uint8)
        frame = Frame(image_array, capture_timestamp_ns, time.monotonic_ns(), self._frame_id)
        self._frame_id += 1
        return frame

    def close(self) -> None:
        """Release the video capture handle."""
        self._capture.release()


class VideoFileCamera(OpenCVCamera):
    """Deterministic video-file replay source."""

    def __init__(self, path: str | Path) -> None:
        super().__init__(str(path), 1, 1, 30.0)
