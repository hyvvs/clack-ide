from __future__ import annotations

import hashlib
import math
from pathlib import Path

import cv2
import numpy as np
from numpy.typing import NDArray
from pydantic import Field

from tracker.rescue.config import ReviewModel


def file_sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


class VideoIdentity(ReviewModel):
    path: str
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    frame_count: int = Field(gt=0)
    nominal_fps: float = Field(gt=0)


class FrameReader:
    def __init__(self, path: Path) -> None:
        if not path.is_file():
            raise ValueError(f"video does not exist: {path}")
        self.path = path
        stat = path.stat()
        self.signature = (stat.st_size, stat.st_mtime_ns)
        self._cached_index: int | None = None
        self._cached_image: NDArray[np.uint8] | None = None
        self.capture = cv2.VideoCapture(str(path))
        try:
            if not self.capture.isOpened():
                raise ValueError("could not open video")
            self.source = VideoIdentity(
                path=str(path.resolve()),
                sha256=file_sha256(path),
                width=int(self.capture.get(cv2.CAP_PROP_FRAME_WIDTH)),
                height=int(self.capture.get(cv2.CAP_PROP_FRAME_HEIGHT)),
                frame_count=int(self.capture.get(cv2.CAP_PROP_FRAME_COUNT)),
                nominal_fps=float(self.capture.get(cv2.CAP_PROP_FPS)),
            )
            self.read(0)
        except Exception:
            self.close()
            raise

    def read(self, index: int) -> NDArray[np.uint8]:
        stat = self.path.stat()
        if (stat.st_size, stat.st_mtime_ns) != self.signature:
            raise ValueError("video changed while annotating; reopen the original source")
        if not 0 <= index < self.source.frame_count:
            raise ValueError("frame index is outside the video")
        if index == self._cached_index and self._cached_image is not None:
            return self._cached_image.copy()
        position = self.capture.get(cv2.CAP_PROP_POS_FRAMES)
        if (not math.isfinite(position) or round(position) != index) and not self.capture.set(
            cv2.CAP_PROP_POS_FRAMES, index
        ):
            raise ValueError(f"decoder could not seek to frame {index}")
        ok, raw = self.capture.read()
        position = self.capture.get(cv2.CAP_PROP_POS_FRAMES)
        if not ok or not math.isfinite(position) or abs(position - index - 1) > 0.01:
            raise ValueError(f"could not verify decoded frame index {index}")
        image = np.asarray(raw, dtype=np.uint8)
        if image.shape[:2] != (self.source.height, self.source.width):
            raise ValueError("video resolution changed")
        self._cached_index, self._cached_image = index, image
        return image.copy()

    def close(self) -> None:
        self._cached_index, self._cached_image = None, None
        self.capture.release()
