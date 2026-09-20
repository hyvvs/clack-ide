"""Bounded motor zero, direction, scale, delay, backlash, and deadband fitting."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import ArrayLike, NDArray


@dataclass(frozen=True, slots=True)
class MotorCalibrationResult:
    """Fitted static and dynamic parameters for one motor axis."""

    zero_offset_rad: float
    direction: int
    angular_scale: float
    response_delay_s: float
    deadband_rad: float
    backlash_rad: float
    velocity_gain: float


def fit_motor_calibration(
    commanded_rad: ArrayLike,
    measured_rad: ArrayLike,
    timestamps_s: ArrayLike,
    safe_limits_rad: tuple[float, float],
) -> MotorCalibrationResult:
    """Fit an axis from operator-supervised samples already inside safe limits."""
    commanded = np.asarray(commanded_rad, dtype=np.float64).reshape(-1)
    measured = np.asarray(measured_rad, dtype=np.float64).reshape(-1)
    timestamps = np.asarray(timestamps_s, dtype=np.float64).reshape(-1)
    if (
        len(commanded) < 5
        or commanded.shape != measured.shape
        or commanded.shape != timestamps.shape
    ):
        raise ValueError("at least five matched motor samples are required")
    if not np.all(np.isfinite(commanded)) or not np.all(np.isfinite(measured)):
        raise ValueError("motor calibration samples must be finite")
    if np.any(commanded < safe_limits_rad[0]) or np.any(commanded > safe_limits_rad[1]):
        raise ValueError("motor calibration command exceeds configured safe limits")
    design = np.column_stack([commanded, np.ones_like(commanded)])
    scale, offset = np.linalg.lstsq(design, measured, rcond=None)[0]
    direction = 1 if scale >= 0.0 else -1
    residual = measured - (scale * commanded + offset)
    command_delta = np.diff(commanded)
    measurement_delta = np.diff(measured)
    moving = np.abs(command_delta) > 1e-6
    velocity_gain = float(
        np.median(np.abs(measurement_delta[moving] / command_delta[moving]))
        if np.any(moving)
        else 0.0
    )
    reversal_indexes = np.flatnonzero(np.sign(command_delta[1:]) != np.sign(command_delta[:-1])) + 1
    backlash = float(
        np.median(np.abs(residual[reversal_indexes])) * 2.0 if len(reversal_indexes) else 0.0
    )
    deadband = float(np.percentile(np.abs(residual), 25.0))
    response_delay = _estimate_delay(commanded, measured, timestamps)
    return MotorCalibrationResult(
        float(offset),
        direction,
        float(abs(scale)),
        response_delay,
        deadband,
        backlash,
        velocity_gain,
    )


def safe_sweep_points(
    minimum_rad: float, maximum_rad: float, count: int, margin_rad: float = 0.05
) -> NDArray[np.float64]:
    """Generate calibration points strictly inside configured safe limits."""
    if count < 2 or minimum_rad + margin_rad >= maximum_rad - margin_rad:
        raise ValueError("safe sweep limits or point count are invalid")
    return np.linspace(minimum_rad + margin_rad, maximum_rad - margin_rad, count)


def _estimate_delay(commanded: np.ndarray, measured: np.ndarray, timestamps: np.ndarray) -> float:
    if len(commanded) < 6:
        return 0.0
    command_velocity = np.gradient(commanded, timestamps)
    measured_velocity = np.gradient(measured, timestamps)
    correlation = np.correlate(
        command_velocity - command_velocity.mean(),
        measured_velocity - measured_velocity.mean(),
        mode="full",
    )
    lag = int(np.argmax(correlation) - (len(command_velocity) - 1))
    dt = float(np.median(np.diff(timestamps)))
    return max(0.0, lag * dt)
