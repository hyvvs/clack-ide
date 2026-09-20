"""Shared SI-unit data types and coordinate frame conventions.

The platform frame is right-handed with x forward, y left, and z up. Azimuth is
positive from x toward y. Elevation is positive above the x-y plane.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

import numpy as np
from numpy.typing import ArrayLike, NDArray

type Timestamp = int
type FloatArray = NDArray[np.float64]


@dataclass(frozen=True, slots=True)
class Vector3:
    """Three-dimensional vector in a named SI coordinate frame."""

    x: float
    y: float
    z: float
    frame: str = "platform"

    def as_array(self) -> FloatArray:
        """Return the vector as a float64 NumPy array."""
        return np.array([self.x, self.y, self.z], dtype=np.float64)

    @classmethod
    def from_array(cls, values: ArrayLike, frame: str = "platform") -> Vector3:
        """Build a vector from exactly three finite values."""
        array = np.asarray(values, dtype=np.float64).reshape(-1)
        if array.shape != (3,) or not np.all(np.isfinite(array)):
            raise ValueError("Vector3 requires three finite values")
        return cls(float(array[0]), float(array[1]), float(array[2]), frame)

    def norm(self) -> float:
        """Return Euclidean magnitude."""
        return float(np.linalg.norm(self.as_array()))


@dataclass(frozen=True, slots=True)
class Pose3D:
    """Rigid pose represented by a 4 by 4 homogeneous transform."""

    matrix: FloatArray
    source_frame: str
    destination_frame: str

    def __post_init__(self) -> None:
        matrix = np.asarray(self.matrix, dtype=np.float64)
        if matrix.shape != (4, 4) or not np.all(np.isfinite(matrix)):
            raise ValueError("pose matrix must be finite and 4 by 4")
        if not np.allclose(matrix[3], [0.0, 0.0, 0.0, 1.0], atol=1e-9):
            raise ValueError("pose matrix must be homogeneous")
        object.__setattr__(self, "matrix", matrix.copy())

    def inverse(self) -> Pose3D:
        """Return the inverse rigid transform."""
        try:
            inverse = np.linalg.inv(self.matrix)
        except np.linalg.LinAlgError as exc:
            raise ValueError("pose transform is singular") from exc
        return Pose3D(inverse, self.destination_frame, self.source_frame)

    def transform_point(self, point: Vector3) -> Vector3:
        """Transform a point from source frame to destination frame."""
        if point.frame != self.source_frame:
            raise ValueError(f"expected point in {self.source_frame}, got {point.frame}")
        homogeneous = np.append(point.as_array(), 1.0)
        transformed = self.matrix @ homogeneous
        if abs(transformed[3]) < 1e-12:
            raise ValueError("transform produced a point at infinity")
        return Vector3.from_array(transformed[:3] / transformed[3], self.destination_frame)


@dataclass(frozen=True, slots=True)
class Frame:
    """Camera frame with separate capture and processing timestamps."""

    image: NDArray[np.uint8]
    capture_timestamp_ns: Timestamp
    processing_timestamp_ns: Timestamp
    frame_id: int


@dataclass(frozen=True, slots=True)
class TargetDetection:
    """Detector output with optional platform-frame position measurement."""

    bbox_xywh: tuple[float, float, float, float]
    center_px: tuple[float, float]
    confidence: float
    class_label: str
    timestamp_ns: Timestamp
    marker_id: int | None = None
    position: Vector3 | None = None
    position_covariance: FloatArray | None = None


@dataclass(slots=True)
class Track:
    """Persistent tracked target and its 9-state estimate."""

    track_id: int
    state: FloatArray
    covariance: FloatArray
    confidence: float
    age_frames: int
    missed_frames: int
    last_update_ns: Timestamp
    detector_confidence: float = 0.0
    class_label: str = "unknown"


@dataclass(frozen=True, slots=True)
class TargetState:
    """Estimated target kinematics in one explicit coordinate frame."""

    position: Vector3
    velocity: Vector3
    acceleration: Vector3
    covariance: FloatArray
    timestamp_ns: Timestamp
    confidence: float
    track_id: int | None = None


@dataclass(frozen=True, slots=True)
class TargetPrediction:
    """Target state predicted to a future monotonic timestamp."""

    state: TargetState
    horizon_s: float
    confidence: float


@dataclass(frozen=True, slots=True)
class BallisticSolution:
    """Solution for a simulated projectile interception."""

    valid: bool
    azimuth_rad: float
    elevation_rad: float
    flight_time_s: float
    predicted_target_position: Vector3
    predicted_impact_position: Vector3
    miss_distance_m: float
    iterations: int
    confidence: float
    method: str
    trajectory: tuple[Vector3, ...] = ()
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class AimCommand:
    """Desired platform angles and feedforward rates."""

    azimuth_rad: float
    elevation_rad: float
    azimuth_velocity_radps: float = 0.0
    elevation_velocity_radps: float = 0.0
    timestamp_ns: Timestamp = 0
    azimuth_acceleration_radps2: float = 0.0
    elevation_acceleration_radps2: float = 0.0


@dataclass(frozen=True, slots=True)
class MotorState:
    """Observed pan and tilt state."""

    azimuth_rad: float
    elevation_rad: float
    azimuth_velocity_radps: float
    elevation_velocity_radps: float
    timestamp_ns: Timestamp
    enabled: bool = True
    homed: bool = False
    fault: str | None = None


@dataclass(frozen=True, slots=True)
class SystemHealth:
    """Health summary used by centralized permissions."""

    healthy: bool
    camera_fresh: bool = True
    tracker_fresh: bool = True
    serial_connected: bool = True
    host_heartbeat_fresh: bool = True
    faults: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class AlignmentMetrics:
    """Alignment errors and normalized confidence."""

    pan_error_rad: float
    tilt_error_rad: float
    total_error_rad: float
    confidence: float
    factor_scores: dict[str, float] = field(default_factory=dict)


class ShotMode(StrEnum):
    """Supported simulated shot cadence modes."""

    SINGLE = "single"
    BURST = "burst"
    ADAPTIVE = "adaptive"


@dataclass(frozen=True, slots=True)
class SimulatedShot:
    """Immutable record of one simulated projectile event."""

    shot_id: int
    timestamp_ns: Timestamp
    solution: BallisticSolution
    impact_position: Vector3
    target_position: Vector3
    miss_distance_m: float
    hit: bool
    mode: ShotMode
    aim_strategy: str = "predicted_center"
