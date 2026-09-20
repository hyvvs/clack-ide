"""Rigid camera-to-platform extrinsic calibration from matched 3D points."""

from __future__ import annotations

import numpy as np
from numpy.typing import ArrayLike

from tracker.types import Pose3D


def estimate_rigid_transform(
    source_points: ArrayLike,
    destination_points: ArrayLike,
    source_frame: str = "camera",
    destination_frame: str = "platform",
) -> tuple[Pose3D, float]:
    """Estimate a proper rigid transform with the Kabsch algorithm."""
    source = np.asarray(source_points, dtype=np.float64)
    destination = np.asarray(destination_points, dtype=np.float64)
    if source.shape != destination.shape or source.ndim != 2 or source.shape[1] != 3:
        raise ValueError("matched point arrays must both have shape N by 3")
    if len(source) < 3 or not np.all(np.isfinite(source)) or not np.all(np.isfinite(destination)):
        raise ValueError("at least three finite point pairs are required")
    source_center = source.mean(axis=0)
    destination_center = destination.mean(axis=0)
    source_zero = source - source_center
    destination_zero = destination - destination_center
    covariance = source_zero.T @ destination_zero
    left, _, right = np.linalg.svd(covariance)
    rotation = right.T @ left.T
    if np.linalg.det(rotation) < 0.0:
        right[-1, :] *= -1.0
        rotation = right.T @ left.T
    translation = destination_center - rotation @ source_center
    matrix = np.eye(4, dtype=np.float64)
    matrix[:3, :3] = rotation
    matrix[:3, 3] = translation
    transformed = (rotation @ source.T).T + translation
    rms = float(np.sqrt(np.mean(np.sum((transformed - destination) ** 2, axis=1))))
    return Pose3D(matrix, source_frame, destination_frame), rms
