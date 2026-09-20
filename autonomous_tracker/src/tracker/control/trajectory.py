"""Stateful angular velocity, acceleration, and optional jerk limiting."""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(slots=True)
class MotionLimiter:
    """Smooth one angular command axis under kinematic constraints."""

    minimum_position_rad: float
    maximum_position_rad: float
    maximum_velocity_radps: float
    maximum_acceleration_radps2: float
    maximum_jerk_radps3: float | None = None
    position_rad: float = 0.0
    velocity_radps: float = 0.0
    acceleration_radps2: float = 0.0

    def update_velocity(self, requested_velocity_radps: float, dt: float) -> tuple[float, float]:
        """Apply velocity, acceleration, jerk, and position bounds."""
        if not math.isfinite(requested_velocity_radps) or not math.isfinite(dt) or dt <= 0.0:
            raise ValueError("motion command and positive dt must be finite")
        requested = _clamp(
            requested_velocity_radps,
            -self.maximum_velocity_radps,
            self.maximum_velocity_radps,
        )
        velocity_error = requested - self.velocity_radps
        desired_acceleration = _clamp(
            velocity_error / dt,
            -self.maximum_acceleration_radps2,
            self.maximum_acceleration_radps2,
        )
        if self.maximum_jerk_radps3 is not None:
            # Begin reducing acceleration early enough to arrive at the requested
            # velocity with zero acceleration. Without this stopping-speed bound,
            # a naive jerk clamp carries acceleration through the target velocity
            # and creates a large, nonphysical limit cycle.
            stopping_acceleration = math.sqrt(2.0 * self.maximum_jerk_radps3 * abs(velocity_error))
            desired_acceleration = math.copysign(
                min(self.maximum_acceleration_radps2, stopping_acceleration),
                velocity_error,
            )
            delta_limit = self.maximum_jerk_radps3 * dt
            desired_acceleration = _clamp(
                desired_acceleration,
                self.acceleration_radps2 - delta_limit,
                self.acceleration_radps2 + delta_limit,
            )
        self.acceleration_radps2 = desired_acceleration
        self.velocity_radps = _clamp(
            self.velocity_radps + self.acceleration_radps2 * dt,
            -self.maximum_velocity_radps,
            self.maximum_velocity_radps,
        )
        proposed_position = self.position_rad + self.velocity_radps * dt
        bounded_position = _clamp(
            proposed_position, self.minimum_position_rad, self.maximum_position_rad
        )
        if bounded_position != proposed_position:
            self.velocity_radps = 0.0
            self.acceleration_radps2 = 0.0
        self.position_rad = bounded_position
        return self.position_rad, self.velocity_radps

    def set_state(
        self,
        position_rad: float,
        velocity_radps: float = 0.0,
        acceleration_radps2: float = 0.0,
    ) -> None:
        """Synchronize limiter state to a measured platform state."""
        if not all(
            math.isfinite(value) for value in (position_rad, velocity_radps, acceleration_radps2)
        ):
            raise ValueError("motion state must be finite")
        self.position_rad = _clamp(
            position_rad, self.minimum_position_rad, self.maximum_position_rad
        )
        self.velocity_radps = _clamp(
            velocity_radps, -self.maximum_velocity_radps, self.maximum_velocity_radps
        )
        self.acceleration_radps2 = _clamp(
            acceleration_radps2,
            -self.maximum_acceleration_radps2,
            self.maximum_acceleration_radps2,
        )


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))
