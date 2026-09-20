"""Simulation-only alternative aim-point placement strategies."""

from __future__ import annotations

import math
from enum import StrEnum

import numpy as np

from tracker.types import BallisticSolution, TargetState, Vector3


class AimStrategy(StrEnum):
    """Supported software-only aim-point strategies."""

    PREDICTED_CENTER = "predicted_center"
    LEADING_PREDICTION = "leading_prediction"
    UNCERTAINTY_WEIGHTED = "uncertainty_weighted"


def simulated_aim_point(
    target: TargetState,
    solution: BallisticSolution,
    strategy: AimStrategy,
) -> Vector3:
    """Return a software-only target point for impact-placement experiments."""
    if strategy == AimStrategy.PREDICTED_CENTER:
        return solution.predicted_target_position
    current = target.position.as_array()
    leading = (
        current
        + target.velocity.as_array() * solution.flight_time_s
        + 0.5 * target.acceleration.as_array() * solution.flight_time_s**2
    )
    if strategy == AimStrategy.LEADING_PREDICTION:
        return Vector3.from_array(leading, target.position.frame)
    covariance_trace = float(np.trace(target.covariance[:3, :3]))
    lead_weight = math.exp(-max(0.0, covariance_trace))
    weighted = current + lead_weight * (leading - current)
    return Vector3.from_array(weighted, target.position.frame)
