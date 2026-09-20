"""Closed-form, lower-confidence fallback lead approximation."""

from __future__ import annotations

import math

import numpy as np

from tracker.ballistics.impact import evaluate_closest_approach
from tracker.ballistics.integrator import integrate_projectile, launch_velocity
from tracker.ballistics.models import ProjectileModel
from tracker.types import BallisticSolution, TargetState, Vector3


def fallback_intercept(
    launcher_position: Vector3,
    target_state: TargetState,
    muzzle_velocity_mps: float,
    model: ProjectileModel,
    maximum_flight_time_s: float,
    timestep_s: float,
    projectile_radius_m: float = 0.0065,
    target_radius_m: float = 0.075,
) -> BallisticSolution | None:
    """Approximate time by range over speed and compensate gravity analytically."""
    if muzzle_velocity_mps <= 0.0 or not math.isfinite(muzzle_velocity_mps):
        return None
    relative = target_state.position.as_array() - launcher_position.as_array()
    flight_time = float(np.linalg.norm(relative) / muzzle_velocity_mps)
    flight_time = min(maximum_flight_time_s, max(1e-3, flight_time))
    predicted_target = (
        target_state.position.as_array()
        + target_state.velocity.as_array() * flight_time
        + 0.5 * target_state.acceleration.as_array() * flight_time**2
    )
    gravity_compensated = predicted_target - 0.5 * model.gravity_mps2 * flight_time**2
    aim = gravity_compensated - launcher_position.as_array()
    horizontal = float(np.hypot(aim[0], aim[1]))
    if horizontal <= 1e-9:
        return None
    azimuth = math.atan2(float(aim[1]), float(aim[0]))
    elevation = math.atan2(float(aim[2]), horizontal)
    try:
        trajectory = integrate_projectile(
            launcher_position.as_array(),
            launch_velocity(muzzle_velocity_mps, azimuth, elevation),
            model,
            flight_time,
            timestep_s,
        )
    except (ValueError, FloatingPointError):
        return None
    evaluation = evaluate_closest_approach(
        trajectory,
        target_state,
        projectile_radius_m,
        target_radius_m,
    )
    impact = evaluation.projectile_position.as_array()
    predicted_target = evaluation.target_position.as_array()
    flight_time = evaluation.time_s
    miss = evaluation.center_distance_m
    return BallisticSolution(
        True,
        azimuth,
        elevation,
        flight_time,
        Vector3.from_array(predicted_target),
        Vector3.from_array(impact),
        miss,
        0,
        float(0.45 * math.exp(-miss)),
        "fallback",
        tuple(
            Vector3.from_array(point)
            for point in trajectory.positions_m[:: max(1, len(trajectory.times_s) // 50)]
        ),
    )
