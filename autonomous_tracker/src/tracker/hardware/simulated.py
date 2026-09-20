"""Safe simulated pan and tilt dynamics with a latched emergency stop."""

from __future__ import annotations

import math
import time

from tracker.config import PanTiltConfig
from tracker.control.trajectory import MotionLimiter
from tracker.types import MotorState


class SimulatedPanTilt:
    """Deterministic two-axis actuator model used by simulation and tests."""

    def __init__(self, config: PanTiltConfig) -> None:
        self._config = config
        self._pan = MotionLimiter(
            config.pan.minimum_rad,
            config.pan.maximum_rad,
            config.pan.maximum_velocity_radps,
            config.pan.maximum_acceleration_radps2,
            config.pan.maximum_jerk_radps3,
            config.pan.home_rad,
        )
        self._tilt = MotionLimiter(
            config.tilt.minimum_rad,
            config.tilt.maximum_rad,
            config.tilt.maximum_velocity_radps,
            config.tilt.maximum_acceleration_radps2,
            config.tilt.maximum_jerk_radps3,
            config.tilt.home_rad,
        )
        self._target_pan = config.pan.home_rad
        self._target_tilt = config.tilt.home_rad
        self._velocity_command: tuple[float, float] | None = None
        self._enabled = True
        self._estop_latched = False
        self._homed = True

    def command_angles(self, azimuth: float, elevation: float) -> None:
        """Set bounded target angles unless emergency stop is latched."""
        self._require_enabled()
        if not math.isfinite(azimuth) or not math.isfinite(elevation):
            raise ValueError("angle commands must be finite")
        self._target_pan = min(
            self._config.pan.maximum_rad, max(self._config.pan.minimum_rad, azimuth)
        )
        self._target_tilt = min(
            self._config.tilt.maximum_rad, max(self._config.tilt.minimum_rad, elevation)
        )
        self._velocity_command = None
        self._homed = False

    def command_velocity(self, azimuth_velocity: float, elevation_velocity: float) -> None:
        """Set bounded velocity commands unless emergency stop is latched."""
        self._require_enabled()
        self._velocity_command = (azimuth_velocity, elevation_velocity)
        self._homed = False

    def step(self, dt: float) -> MotorState:
        """Advance simulated motor dynamics by monotonic-loop elapsed time."""
        if not self._enabled:
            return self.state()
        if self._velocity_command is None:
            pan_velocity = (self._target_pan - self._pan.position_rad) / max(dt, 1e-9)
            tilt_velocity = (self._target_tilt - self._tilt.position_rad) / max(dt, 1e-9)
        else:
            pan_velocity, tilt_velocity = self._velocity_command
        self._pan.update_velocity(pan_velocity, dt)
        self._tilt.update_velocity(tilt_velocity, dt)
        return self.state()

    def stop(self) -> None:
        """Clear pending movement and disable motion."""
        self._velocity_command = (0.0, 0.0)
        self._target_pan = self._pan.position_rad
        self._target_tilt = self._tilt.position_rad
        self._enabled = False
        self._pan.velocity_radps = 0.0
        self._tilt.velocity_radps = 0.0

    def home(self) -> None:
        """Command configured home pose."""
        self._require_enabled()
        self.command_angles(self._config.pan.home_rad, self._config.tilt.home_rad)
        self._homed = True

    def emergency_stop(self) -> None:
        """Immediately stop and latch movement inhibition."""
        self.stop()
        self._estop_latched = True

    def reset_emergency_stop(self) -> None:
        """Explicitly clear the emergency stop latch without starting motion."""
        self._estop_latched = False
        self._enabled = True
        self._velocity_command = (0.0, 0.0)

    def state(self) -> MotorState:
        """Return current simulated motor state."""
        return MotorState(
            self._pan.position_rad,
            self._tilt.position_rad,
            self._pan.velocity_radps,
            self._tilt.velocity_radps,
            time.monotonic_ns(),
            self._enabled,
            self._homed,
            "emergency_stop" if self._estop_latched else None,
        )

    def _require_enabled(self) -> None:
        if self._estop_latched:
            raise RuntimeError("emergency stop is latched")
        if not self._enabled:
            raise RuntimeError("motor motion is disabled")
