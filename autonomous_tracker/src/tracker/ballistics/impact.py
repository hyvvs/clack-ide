"""Continuous closest-approach evaluation for simulated projectile trajectories."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from tracker.ballistics.integrator import ProjectileTrajectory
from tracker.types import TargetState, Vector3


@dataclass(frozen=True, slots=True)
class ImpactEvaluation:
    """Closest simulated projectile-to-target approach over a sampled trajectory."""

    time_s: float
    projectile_position: Vector3
    target_position: Vector3
    center_distance_m: float
    surface_clearance_m: float
    collided: bool


def evaluate_closest_approach(
    trajectory: ProjectileTrajectory,
    target: TargetState,
    projectile_radius_m: float,
    target_radius_m: float,
) -> ImpactEvaluation:
    """Evaluate closest approach continuously across each integration segment."""
    if projectile_radius_m < 0.0 or target_radius_m < 0.0:
        raise ValueError("collision radii cannot be negative")
    times = trajectory.times_s
    target_positions = (
        target.position.as_array()[None, :]
        + times[:, None] * target.velocity.as_array()[None, :]
        + 0.5 * times[:, None] ** 2 * target.acceleration.as_array()[None, :]
    )
    return evaluate_sampled_closest_approach(
        trajectory,
        target_positions,
        target.position.frame,
        projectile_radius_m,
        target_radius_m,
    )


def evaluate_sampled_closest_approach(
    trajectory: ProjectileTrajectory,
    target_positions_m: np.ndarray,
    target_frame: str,
    projectile_radius_m: float,
    target_radius_m: float,
) -> ImpactEvaluation:
    """Evaluate closest approach to independently sampled target truth."""
    if projectile_radius_m < 0.0 or target_radius_m < 0.0:
        raise ValueError("collision radii cannot be negative")
    target_positions = np.asarray(target_positions_m, dtype=np.float64)
    if target_positions.shape != trajectory.positions_m.shape:
        raise ValueError("target positions must match projectile trajectory samples")
    if not np.all(np.isfinite(target_positions)):
        raise ValueError("target positions must be finite")
    times = trajectory.times_s
    relative = trajectory.positions_m - target_positions
    best_distance = float("inf")
    best_time = 0.0
    best_projectile = trajectory.positions_m[0]
    best_target = target_positions[0]
    for index in range(len(times) - 1):
        relative_start = relative[index]
        relative_delta = relative[index + 1] - relative_start
        denominator = float(relative_delta @ relative_delta)
        fraction = (
            0.0
            if denominator <= 1e-18
            else float(np.clip(-(relative_start @ relative_delta) / denominator, 0.0, 1.0))
        )
        separation = relative_start + fraction * relative_delta
        distance = float(np.linalg.norm(separation))
        if distance < best_distance:
            best_distance = distance
            best_time = float(times[index] + fraction * (times[index + 1] - times[index]))
            best_projectile = trajectory.positions_m[index] + fraction * (
                trajectory.positions_m[index + 1] - trajectory.positions_m[index]
            )
            best_target = target_positions[index] + fraction * (
                target_positions[index + 1] - target_positions[index]
            )
    combined_radius = projectile_radius_m + target_radius_m
    clearance = best_distance - combined_radius
    return ImpactEvaluation(
        best_time,
        Vector3.from_array(best_projectile, target_frame),
        Vector3.from_array(best_target, target_frame),
        best_distance,
        clearance,
        clearance <= 0.0,
    )
