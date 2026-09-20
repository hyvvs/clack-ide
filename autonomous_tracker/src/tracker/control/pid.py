"""Reusable PID feedback controller with robust saturation handling."""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class PIDTerms:
    """Latest controller term values for diagnostics."""

    proportional: float = 0.0
    integral: float = 0.0
    derivative: float = 0.0
    feedforward: float = 0.0
    unsaturated: float = 0.0
    output: float = 0.0


class PIDController:
    """PID with derivative filtering, clamping, conditional integration, and restart."""

    def __init__(
        self,
        kp: float,
        ki: float,
        kd: float,
        derivative_filter_hz: float = 12.0,
        output_limits: tuple[float, float] = (-math.inf, math.inf),
        integral_limits: tuple[float, float] = (-math.inf, math.inf),
    ) -> None:
        if derivative_filter_hz <= 0.0:
            raise ValueError("derivative filter frequency must be positive")
        if output_limits[0] >= output_limits[1]:
            raise ValueError("output limits must be ordered")
        if integral_limits[0] > integral_limits[1]:
            raise ValueError("integral limits must be ordered")
        self.kp = kp
        self.ki = ki
        self.kd = kd
        self.derivative_filter_hz = derivative_filter_hz
        self.output_limits = output_limits
        self.integral_limits = integral_limits
        self._integral_error = 0.0
        self._previous_error: float | None = None
        self._filtered_derivative = 0.0
        self.terms = PIDTerms()

    def update(self, error: float, dt: float, feedforward: float = 0.0) -> float:
        """Update the controller from a monotonic-loop error sample."""
        if not all(math.isfinite(value) for value in (error, dt, feedforward)) or dt <= 0.0:
            raise ValueError("error, positive dt, and feedforward must be finite")
        raw_derivative = (
            0.0 if self._previous_error is None else (error - self._previous_error) / dt
        )
        time_constant = 1.0 / (2.0 * math.pi * self.derivative_filter_hz)
        alpha = dt / (time_constant + dt)
        self._filtered_derivative += alpha * (raw_derivative - self._filtered_derivative)
        candidate_integral = _clamp(
            self._integral_error + error * dt,
            self.integral_limits[0],
            self.integral_limits[1],
        )
        p_term = self.kp * error
        d_term = self.kd * self._filtered_derivative
        candidate_i_term = self.ki * candidate_integral
        candidate = p_term + candidate_i_term + d_term + feedforward
        output = _clamp(candidate, self.output_limits[0], self.output_limits[1])
        pushes_high = candidate > self.output_limits[1] and error > 0.0
        pushes_low = candidate < self.output_limits[0] and error < 0.0
        if not (pushes_high or pushes_low):
            self._integral_error = candidate_integral
        i_term = self.ki * self._integral_error
        unsaturated = p_term + i_term + d_term + feedforward
        output = _clamp(unsaturated, self.output_limits[0], self.output_limits[1])
        self._previous_error = error
        self.terms = PIDTerms(p_term, i_term, d_term, feedforward, unsaturated, output)
        return output

    def reset(self) -> None:
        """Clear all stored controller state."""
        self._integral_error = 0.0
        self._previous_error = None
        self._filtered_derivative = 0.0
        self.terms = PIDTerms()

    def restart_bumpless(
        self, error: float, desired_output: float, feedforward: float = 0.0
    ) -> None:
        """Initialize state so the next output begins near the current actuator output."""
        if not all(math.isfinite(value) for value in (error, desired_output, feedforward)):
            raise ValueError("restart inputs must be finite")
        self._previous_error = error
        self._filtered_derivative = 0.0
        if abs(self.ki) > 1e-12:
            self._integral_error = _clamp(
                (desired_output - self.kp * error - feedforward) / self.ki,
                self.integral_limits[0],
                self.integral_limits[1],
            )
        else:
            self._integral_error = 0.0


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))
