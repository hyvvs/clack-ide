"""Online simulation metrics with finite, mergeable summaries."""

from __future__ import annotations

import math
from dataclasses import dataclass, field


@dataclass(slots=True)
class SimulationMetrics:
    """Collect tracking, solving, motion, and simulated impact statistics."""

    tracking_error_squared: list[float] = field(default_factory=list)
    velocity_error_squared: list[float] = field(default_factory=list)
    prediction_error_squared: list[float] = field(default_factory=list)
    ballistic_miss_m: list[float] = field(default_factory=list)
    truth_impact_miss_m: list[float] = field(default_factory=list)
    pan_error_rad: list[float] = field(default_factory=list)
    tilt_error_rad: list[float] = field(default_factory=list)
    post_alignment_prediction_error_squared: list[float] = field(default_factory=list)
    post_alignment_pan_error_rad: list[float] = field(default_factory=list)
    post_alignment_tilt_error_rad: list[float] = field(default_factory=list)
    solver_attempts: int = 0
    solver_successes: int = 0
    simulated_shots: int = 0
    simulated_hits: int = 0
    track_losses: int = 0
    state_machine_faults: int = 0
    first_alignment_s: float | None = None

    def summary(self) -> dict[str, float | int | None]:
        """Return JSON-serializable metrics for one complete run."""
        return {
            "tracking_rms_error_m": _rms(self.tracking_error_squared),
            "velocity_rms_error_mps": _rms(self.velocity_error_squared),
            "prediction_rms_error_m": _rms(self.prediction_error_squared),
            "solver_success_rate": _ratio(self.solver_successes, self.solver_attempts),
            "ballistic_miss_rms_m": _rms_values(self.ballistic_miss_m),
            "truth_impact_rms_m": _rms_values(self.truth_impact_miss_m),
            "pan_rms_error_rad": _rms_values(self.pan_error_rad),
            "tilt_rms_error_rad": _rms_values(self.tilt_error_rad),
            "post_alignment_prediction_rms_error_m": _rms(
                self.post_alignment_prediction_error_squared
            ),
            "post_alignment_pan_rms_error_rad": _rms_values(self.post_alignment_pan_error_rad),
            "post_alignment_tilt_rms_error_rad": _rms_values(self.post_alignment_tilt_error_rad),
            "alignment_time_s": self.first_alignment_s,
            "simulated_hit_rate": _ratio(self.simulated_hits, self.simulated_shots),
            "track_loss_count": self.track_losses,
            "state_machine_faults": self.state_machine_faults,
            "simulated_shots": self.simulated_shots,
        }


def _rms(squared_values: list[float]) -> float:
    if not squared_values:
        return 0.0
    return math.sqrt(sum(squared_values) / len(squared_values))


def _rms_values(values: list[float]) -> float:
    return _rms([value * value for value in values])


def _ratio(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 0.0
