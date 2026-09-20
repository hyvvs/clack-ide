"""Monotonic per-stage and end-to-end latency calibration."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np


@dataclass(frozen=True, slots=True)
class LatencySummary:
    """Robust statistics for one measured pipeline stage."""

    mean_s: float
    standard_deviation_s: float
    p95_s: float
    sample_count: int


@dataclass(slots=True)
class LatencyCalibrator:
    """Collect monotonic latency samples for named pipeline stages."""

    samples: dict[str, list[float]] = field(default_factory=dict)

    def record(self, stage: str, start_ns: int, end_ns: int) -> None:
        """Record one nonnegative monotonic stage duration."""
        if not stage.strip() or end_ns < start_ns:
            raise ValueError("latency stage and monotonic timestamps are invalid")
        self.samples.setdefault(stage, []).append((end_ns - start_ns) * 1e-9)

    def summarize(self) -> dict[str, LatencySummary]:
        """Return mean, standard deviation, and p95 for every stage."""
        summaries: dict[str, LatencySummary] = {}
        for stage, values in self.samples.items():
            array = np.asarray(values, dtype=np.float64)
            summaries[stage] = LatencySummary(
                float(array.mean()),
                float(array.std()),
                float(np.percentile(array, 95.0)),
                len(values),
            )
        return summaries

    def end_to_end_s(self) -> float:
        """Return sum of measured stage means used for prediction compensation."""
        value = sum(summary.mean_s for summary in self.summarize().values())
        return value if math.isfinite(value) else 0.0


def effective_prediction_time_s(system_latency_s: float, flight_time_s: float) -> float:
    """Combine system latency and simulated projectile time of flight."""
    if system_latency_s < 0.0 or flight_time_s < 0.0:
        raise ValueError("latency and flight time cannot be negative")
    return system_latency_s + flight_time_s
