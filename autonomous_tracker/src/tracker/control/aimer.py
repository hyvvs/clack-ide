"""Aim geometry and dual-axis feedback plus feedforward control."""

from __future__ import annotations

import math

import numpy as np

from tracker.config import AxisConfig, PanTiltConfig
from tracker.control.pid import PIDController
from tracker.control.trajectory import MotionLimiter
from tracker.types import AimCommand, MotorState, Vector3


def compute_aim_angles(origin: Vector3, target_point: Vector3) -> tuple[float, float]:
    """Return azimuth and elevation from origin to a point in the same frame."""
    if origin.frame != target_point.frame:
        raise ValueError("aim origin and target must use the same frame")
    delta = target_point.as_array() - origin.as_array()
    if not np.all(np.isfinite(delta)) or np.linalg.norm(delta) <= 1e-12:
        raise ValueError("aim target must be finite and distinct from origin")
    azimuth = math.atan2(float(delta[1]), float(delta[0]))
    elevation = math.atan2(float(delta[2]), float(np.hypot(delta[0], delta[1])))
    return azimuth, elevation


def compute_angular_velocity(
    origin: Vector3,
    target_position: Vector3,
    target_velocity: Vector3,
) -> tuple[float, float]:
    """Return exact azimuth and elevation rates for target Cartesian velocity."""
    if origin.frame != target_position.frame or target_position.frame != target_velocity.frame:
        raise ValueError("aim kinematics must use one coordinate frame")
    position = target_position.as_array() - origin.as_array()
    velocity = target_velocity.as_array()
    x, y, z = (float(value) for value in position)
    vx, vy, vz = (float(value) for value in velocity)
    horizontal_squared = x * x + y * y
    if horizontal_squared <= 1e-12:
        raise ValueError("angular velocity is singular on the vertical axis")
    horizontal = math.sqrt(horizontal_squared)
    azimuth_rate = (x * vy - y * vx) / horizontal_squared
    horizontal_rate = (x * vx + y * vy) / horizontal
    range_squared = horizontal_squared + z * z
    elevation_rate = (horizontal * vz - z * horizontal_rate) / range_squared
    return azimuth_rate, elevation_rate


class PanTiltAimController:
    """Separate pan and tilt PID loops with velocity and acceleration feedforward."""

    def __init__(self, config: PanTiltConfig) -> None:
        self._config = config
        self._pan_pid = self._make_pid(config.pan)
        self._tilt_pid = self._make_pid(config.tilt)
        self._pan_limiter = MotionLimiter(
            config.pan.minimum_rad,
            config.pan.maximum_rad,
            config.pan.maximum_velocity_radps,
            config.pan.maximum_acceleration_radps2,
            config.pan.maximum_jerk_radps3,
        )
        self._tilt_limiter = MotionLimiter(
            config.tilt.minimum_rad,
            config.tilt.maximum_rad,
            config.tilt.maximum_velocity_radps,
            config.tilt.maximum_acceleration_radps2,
            config.tilt.maximum_jerk_radps3,
        )
        self._previous_pan_velocity_radps: float | None = None
        self._previous_tilt_velocity_radps: float | None = None

    def update(self, desired: AimCommand, measured: MotorState, dt: float) -> AimCommand:
        """Compute smoothly constrained angular velocity commands."""
        pan_acceleration = self._measured_acceleration(
            measured.azimuth_velocity_radps,
            self._previous_pan_velocity_radps,
            dt,
        )
        tilt_acceleration = self._measured_acceleration(
            measured.elevation_velocity_radps,
            self._previous_tilt_velocity_radps,
            dt,
        )
        self._previous_pan_velocity_radps = measured.azimuth_velocity_radps
        self._previous_tilt_velocity_radps = measured.elevation_velocity_radps
        self._pan_limiter.set_state(
            measured.azimuth_rad,
            measured.azimuth_velocity_radps,
            pan_acceleration,
        )
        self._tilt_limiter.set_state(
            measured.elevation_rad,
            measured.elevation_velocity_radps,
            tilt_acceleration,
        )
        pan_error = _wrap_angle(desired.azimuth_rad - measured.azimuth_rad)
        tilt_error = desired.elevation_rad - measured.elevation_rad
        pan_feedforward = self._config.pan.pid.velocity_feedforward * desired.azimuth_velocity_radps
        pan_feedforward += (
            self._config.pan.pid.acceleration_feedforward * desired.azimuth_acceleration_radps2
        )
        tilt_feedforward = (
            self._config.tilt.pid.velocity_feedforward * desired.elevation_velocity_radps
        )
        tilt_feedforward += (
            self._config.tilt.pid.acceleration_feedforward * desired.elevation_acceleration_radps2
        )
        raw_pan = self._pan_pid.update(pan_error, dt, pan_feedforward)
        raw_tilt = self._tilt_pid.update(tilt_error, dt, tilt_feedforward)
        _, pan_velocity = self._pan_limiter.update_velocity(raw_pan, dt)
        _, tilt_velocity = self._tilt_limiter.update_velocity(raw_tilt, dt)
        return AimCommand(
            float(
                np.clip(
                    desired.azimuth_rad, self._config.pan.minimum_rad, self._config.pan.maximum_rad
                )
            ),
            float(
                np.clip(
                    desired.elevation_rad,
                    self._config.tilt.minimum_rad,
                    self._config.tilt.maximum_rad,
                )
            ),
            pan_velocity,
            tilt_velocity,
            desired.timestamp_ns,
            desired.azimuth_acceleration_radps2,
            desired.elevation_acceleration_radps2,
        )

    @staticmethod
    def _make_pid(axis: AxisConfig) -> PIDController:
        config = axis.pid
        return PIDController(
            config.kp,
            config.ki,
            config.kd,
            config.derivative_filter_hz,
            (-config.output_limit_radps, config.output_limit_radps),
            (-config.integral_limit, config.integral_limit),
        )

    @staticmethod
    def _measured_acceleration(
        velocity_radps: float,
        previous_velocity_radps: float | None,
        dt: float,
    ) -> float:
        if previous_velocity_radps is None:
            return 0.0
        return (velocity_radps - previous_velocity_radps) / dt


def _wrap_angle(angle: float) -> float:
    return (angle + math.pi) % (2.0 * math.pi) - math.pi
