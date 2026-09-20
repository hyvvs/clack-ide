"""OpenCV checkerboard intrinsic calibration and diagnostics."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import cv2
import numpy as np
from numpy.typing import NDArray

from tracker.types import FloatArray


@dataclass(frozen=True, slots=True)
class IntrinsicCalibration:
    """Serializable camera intrinsic calibration record."""

    camera_matrix: FloatArray
    distortion_coefficients: FloatArray
    image_width: int
    image_height: int
    rms_error: float
    mean_reprojection_error_px: float
    checkerboard: tuple[int, int]
    square_size_m: float
    timestamp: str
    image_count: int

    def save(self, path: str | Path) -> None:
        """Save calibration as a human-readable JSON record."""
        payload = {
            "version": 1,
            "camera_matrix": self.camera_matrix.tolist(),
            "distortion_coefficients": self.distortion_coefficients.tolist(),
            "image_width": self.image_width,
            "image_height": self.image_height,
            "rms_error": self.rms_error,
            "mean_reprojection_error_px": self.mean_reprojection_error_px,
            "checkerboard": list(self.checkerboard),
            "square_size_m": self.square_size_m,
            "timestamp": self.timestamp,
            "image_count": self.image_count,
        }
        Path(path).write_text(json.dumps(payload, indent=2), encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> IntrinsicCalibration:
        """Load and validate a saved intrinsic calibration."""
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls(
            np.asarray(payload["camera_matrix"], dtype=np.float64),
            np.asarray(payload["distortion_coefficients"], dtype=np.float64),
            int(payload["image_width"]),
            int(payload["image_height"]),
            float(payload["rms_error"]),
            float(payload["mean_reprojection_error_px"]),
            (int(payload["checkerboard"][0]), int(payload["checkerboard"][1])),
            float(payload["square_size_m"]),
            str(payload["timestamp"]),
            int(payload["image_count"]),
        )


class CheckerboardCalibrator:
    """Accumulate checkerboard observations and solve camera intrinsics."""

    def __init__(self, checkerboard: tuple[int, int], square_size_m: float) -> None:
        if checkerboard[0] < 2 or checkerboard[1] < 2 or square_size_m <= 0.0:
            raise ValueError("checkerboard dimensions and square size must be positive")
        self.checkerboard = checkerboard
        self.square_size_m = square_size_m
        object_points = np.zeros((checkerboard[0] * checkerboard[1], 3), dtype=np.float32)
        object_points[:, :2] = (
            np.mgrid[0 : checkerboard[0], 0 : checkerboard[1]].T.reshape(-1, 2) * square_size_m
        )
        self._object_template = object_points
        self._object_points: list[NDArray[np.float32]] = []
        self._image_points: list[NDArray[np.float32]] = []
        self._image_size: tuple[int, int] | None = None

    @property
    def observation_count(self) -> int:
        """Return number of accepted checkerboard views."""
        return len(self._image_points)

    def add_image(self, image: NDArray[np.uint8]) -> tuple[bool, NDArray[np.uint8]]:
        """Detect and refine corners, returning an annotated diagnostic image."""
        gray = np.asarray(
            cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image,
            dtype=np.uint8,
        )
        size = (gray.shape[1], gray.shape[0])
        if self._image_size is not None and size != self._image_size:
            raise ValueError("all calibration images must use the same dimensions")
        found, corners = cv2.findChessboardCorners(
            gray,
            self.checkerboard,
            flags=cv2.CALIB_CB_ADAPTIVE_THRESH | cv2.CALIB_CB_NORMALIZE_IMAGE,
        )
        diagnostic = np.asarray(cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR), dtype=np.uint8)
        if not found:
            return False, diagnostic
        refined = np.asarray(
            cv2.cornerSubPix(
                gray,
                corners,
                (11, 11),
                (-1, -1),
                (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001),
            ),
            dtype=np.float32,
        )
        self._image_size = size
        self._object_points.append(self._object_template.copy())
        self._image_points.append(refined)
        cv2.drawChessboardCorners(diagnostic, self.checkerboard, refined, True)
        return True, diagnostic

    def calibrate(self) -> IntrinsicCalibration:
        """Solve intrinsics and compute mean per-view reprojection error."""
        if self._image_size is None or len(self._image_points) < 3:
            raise ValueError("at least three valid checkerboard views are required")
        rms, camera_matrix, distortion, rotations, translations = cv2.calibrateCamera(
            self._object_points,
            self._image_points,
            self._image_size,
            None,
            None,
        )
        errors: list[float] = []
        for object_points, image_points, rotation, translation in zip(
            self._object_points,
            self._image_points,
            rotations,
            translations,
            strict=True,
        ):
            projected, _ = cv2.projectPoints(
                object_points, rotation, translation, camera_matrix, distortion
            )
            errors.append(float(cv2.norm(image_points, projected, cv2.NORM_L2) / len(projected)))
        return IntrinsicCalibration(
            np.asarray(camera_matrix, dtype=np.float64),
            np.asarray(distortion, dtype=np.float64).reshape(-1),
            self._image_size[0],
            self._image_size[1],
            float(rms),
            float(np.mean(errors)),
            self.checkerboard,
            self.square_size_m,
            datetime.now(UTC).isoformat(),
            len(self._image_points),
        )
