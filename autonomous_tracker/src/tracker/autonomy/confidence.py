"""Configurable normalized alignment-confidence calculation."""

from __future__ import annotations

import math

import numpy as np

from tracker.config import AlignmentWeightConfig
from tracker.types import AlignmentMetrics, BallisticSolution, MotorState, Track, Vector3


def range_aware_alignment_tolerance(
    origin: Vector3,
    target: Vector3,
    target_radius_m: float,
    projectile_radius_m: float,
    maximum_tolerance_rad: float,
    usable_radius_fraction: float,
) -> float:
    """Return an angular tolerance bounded inside a target's apparent radius."""
    if origin.frame != target.frame:
        raise ValueError("alignment geometry must use one coordinate frame")
    if target_radius_m <= 0.0 or projectile_radius_m < 0.0:
        raise ValueError("alignment radii must be positive and nonnegative")
    if maximum_tolerance_rad <= 0.0 or not 0.0 < usable_radius_fraction <= 1.0:
        raise ValueError("alignment tolerance and usable radius fraction are invalid")
    distance_m = float(np.linalg.norm(target.as_array() - origin.as_array()))
    collision_radius_m = target_radius_m + projectile_radius_m
    reserved_radius_m = collision_radius_m * usable_radius_fraction
    geometric_tolerance = math.asin(min(1.0, reserved_radius_m / max(distance_m, 1e-9)))
    return min(maximum_tolerance_rad, geometric_tolerance)


def alignment_confidence(
    pan_error_rad: float,
    tilt_error_rad: float,
    track: Track,
    solution: BallisticSolution | None,
    motor: MotorState,
    target_age_s: float,
    angular_tolerance_rad: float,
    freshness_limit_s: float,
    weights: AlignmentWeightConfig,
) -> AlignmentMetrics:
    """Combine seven bounded factors into one normalized confidence score."""
    total_error = float(math.hypot(pan_error_rad, tilt_error_rad))
    covariance_trace = float(np.trace(track.covariance[:3, :3]))
    miss = solution.miss_distance_m if solution is not None else float("inf")
    platform_speed = math.hypot(motor.azimuth_velocity_radps, motor.elevation_velocity_radps)
    factors = {
        "angular_error": math.exp(-((total_error / max(angular_tolerance_rad, 1e-9)) ** 2)),
        "covariance": math.exp(-max(0.0, covariance_trace)),
        "detector_confidence": float(np.clip(track.detector_confidence, 0.0, 1.0)),
        "miss_distance": math.exp(-max(0.0, miss) / 0.1) if math.isfinite(miss) else 0.0,
        "platform_velocity": math.exp(-platform_speed / 0.5),
        "solver_validity": 1.0 if solution is not None and solution.valid else 0.0,
        "freshness": math.exp(-max(0.0, target_age_s) / max(freshness_limit_s, 1e-9)),
    }
    weight_map = weights.model_dump()
    total_weight = sum(float(value) for value in weight_map.values())
    confidence = (
        sum(factors[name] * float(weight_map[name]) for name in factors) / total_weight
        if total_weight > 0.0
        else 0.0
    )
    return AlignmentMetrics(
        pan_error_rad,
        tilt_error_rad,
        total_error,
        float(np.clip(confidence, 0.0, 1.0)),
        factors,
    )
