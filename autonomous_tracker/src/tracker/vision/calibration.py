"""Rigid transform helpers shared by calibration and pose estimation."""

from __future__ import annotations

from collections.abc import Mapping

import numpy as np

from tracker.types import FloatArray, Pose3D, Vector3


class TransformGraph:
    """Small explicit graph of rigid transforms between coordinate frames."""

    def __init__(self, transforms: Mapping[tuple[str, str], Pose3D] | None = None) -> None:
        self._transforms: dict[tuple[str, str], Pose3D] = dict(transforms or {})

    def add(self, transform: Pose3D) -> None:
        """Add both directions of a rigid transform."""
        self._transforms[(transform.source_frame, transform.destination_frame)] = transform
        inverse = transform.inverse()
        self._transforms[(inverse.source_frame, inverse.destination_frame)] = inverse

    def transform_point(self, source_frame: str, destination_frame: str, point: Vector3) -> Vector3:
        """Transform a point across a direct calibrated frame edge."""
        if source_frame == destination_frame:
            return Vector3(point.x, point.y, point.z, destination_frame)
        transform = self._transforms.get((source_frame, destination_frame))
        if transform is None:
            raise KeyError(f"no transform {source_frame} -> {destination_frame}")
        return transform.transform_point(point)

    def transform_covariance(
        self,
        source_frame: str,
        destination_frame: str,
        covariance: FloatArray,
    ) -> FloatArray:
        """Rotate a 3D position covariance across a direct calibrated frame edge."""
        matrix = np.asarray(covariance, dtype=np.float64)
        if matrix.shape != (3, 3) or not np.all(np.isfinite(matrix)):
            raise ValueError("position covariance must be a finite 3 by 3 matrix")
        if source_frame == destination_frame:
            return matrix.copy()
        transform = self._transforms.get((source_frame, destination_frame))
        if transform is None:
            raise KeyError(f"no transform {source_frame} -> {destination_frame}")
        rotation = transform.matrix[:3, :3]
        return rotation @ matrix @ rotation.T
