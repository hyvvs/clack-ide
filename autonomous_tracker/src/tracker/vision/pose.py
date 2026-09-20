"""Marker and known-geometry monocular pose estimation."""

from __future__ import annotations

import cv2
import numpy as np
from numpy.typing import ArrayLike

from tracker.types import FloatArray, TargetDetection, Vector3


def estimate_range_from_width(
    detection: TargetDetection,
    target_width_m: float,
    focal_length_px: float,
    principal_point_px: tuple[float, float] = (0.0, 0.0),
) -> tuple[Vector3, FloatArray]:
    """Estimate camera-frame range using known target width.

    OpenCV camera axes are converted to platform convention: optical z becomes x,
    negative optical x becomes y, and negative optical y becomes z.
    """
    _, _, width_px, _ = detection.bbox_xywh
    if width_px <= 0.0 or target_width_m <= 0.0 or focal_length_px <= 0.0:
        raise ValueError("range geometry inputs must be positive")
    range_m = focal_length_px * target_width_m / width_px
    u, v = detection.center_px
    camera_x = ((u - principal_point_px[0]) / focal_length_px) * range_m
    camera_y = ((v - principal_point_px[1]) / focal_length_px) * range_m
    position = Vector3(range_m, -camera_x, -camera_y, "camera")
    relative_sigma = max(0.03, 2.0 / width_px)
    covariance = np.diag(
        [(range_m * relative_sigma) ** 2, (range_m * 0.02) ** 2, (range_m * 0.02) ** 2]
    )
    return position, covariance


def estimate_aruco_pose(
    corners: ArrayLike,
    marker_size_m: float,
    camera_matrix: FloatArray,
    distortion: FloatArray,
) -> tuple[Vector3, FloatArray]:
    """Estimate one square marker pose with solvePnP."""
    half = marker_size_m * 0.5
    object_points = np.array(
        [[-half, half, 0.0], [half, half, 0.0], [half, -half, 0.0], [-half, -half, 0.0]],
        dtype=np.float64,
    )
    ok, _, translation = cv2.solvePnP(
        object_points,
        np.asarray(corners, dtype=np.float64).reshape(4, 2),
        camera_matrix,
        distortion,
        flags=cv2.SOLVEPNP_IPPE_SQUARE,
    )
    if not ok or not np.all(np.isfinite(translation)):
        raise ValueError("marker pose estimation failed")
    tx, ty, tz = translation.reshape(3)
    position = Vector3(float(tz), float(-tx), float(-ty), "camera")
    covariance = np.eye(3, dtype=np.float64) * max(1e-4, position.norm() ** 2 * 1e-4)
    return position, covariance
