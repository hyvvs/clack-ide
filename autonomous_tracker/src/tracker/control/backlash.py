"""Configurable servo deadband and mechanical backlash compensation."""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(slots=True)
class BacklashCompensator:
    """Offset commands after direction reversal to take up mechanical slack."""

    backlash_rad: float
    deadband_rad: float
    approach_overshoot_rad: float = 0.0
    _last_direction: int = 0

    def compensate(self, current_rad: float, requested_rad: float) -> float:
        """Return a direction-aware compensated position request."""
        if not math.isfinite(current_rad) or not math.isfinite(requested_rad):
            raise ValueError("backlash inputs must be finite")
        error = requested_rad - current_rad
        if abs(error) <= self.deadband_rad:
            return current_rad
        direction = 1 if error > 0.0 else -1
        reversal = self._last_direction != 0 and direction != self._last_direction
        self._last_direction = direction
        compensation = self.backlash_rad if reversal else 0.0
        if reversal:
            compensation += self.approach_overshoot_rad
        return requested_rad + direction * compensation

    def reset(self) -> None:
        """Forget approach direction."""
        self._last_direction = 0


@dataclass(frozen=True, slots=True)
class DeadbandModel:
    """Suppress small velocity commands and remap motion above threshold."""

    threshold: float

    def apply(self, command: float) -> float:
        """Return zero inside deadband and remove the threshold outside it."""
        if abs(command) <= self.threshold:
            return 0.0
        return math.copysign(abs(command) - self.threshold, command)
