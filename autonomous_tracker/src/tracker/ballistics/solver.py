"""Bounded numerical moving-target interception for simulated projectiles."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy.optimize import least_squares

from tracker.ballistics.fallback import fallback_intercept
from tracker.ballistics.impact import evaluate_closest_approach
from tracker.ballistics.integrator import integrate_projectile, launch_velocity
from tracker.ballistics.models import ProjectileModel
from tracker.types import BallisticSolution, TargetState, Vector3


@dataclass(frozen=True, slots=True)
class SolverConstraints:
    """Bounds and validity thresholds for interception optimization."""

    maximum_flight_time_s: float = 3.0
    minimum_flight_time_s: float = 0.01
    minimum_azimuth_rad: float = -math.pi
    maximum_azimuth_rad: float = math.pi
    minimum_elevation_rad: float = math.radians(-20.0)
    maximum_elevation_rad: float = math.radians(80.0)
    maximum_iterations: int = 80
    valid_miss_distance_m: float = 0.08
    integration_timestep_s: float = 0.01
    projectile_radius_m: float = 0.0065
    target_radius_m: float = 0.075


def target_position_at(target: TargetState, time_s: float) -> np.ndarray:
    """Return constant-acceleration target position at a future time."""
    return (
        target.position.as_array()
        + target.velocity.as_array() * time_s
        + 0.5 * target.acceleration.as_array() * time_s**2
    )


def solve_intercept(
    launcher_position: Vector3,
    target_state: TargetState,
    muzzle_velocity_mps: float,
    projectile_model: ProjectileModel,
    constraints: SolverConstraints,
) -> BallisticSolution | None:
    """Minimize projectile-to-moving-target miss with bounded least squares."""
    if muzzle_velocity_mps <= 0.0 or not math.isfinite(muzzle_velocity_mps):
        return None
    if launcher_position.frame != target_state.position.frame:
        return None
    values = np.concatenate(
        [
            launcher_position.as_array(),
            target_state.position.as_array(),
            target_state.velocity.as_array(),
            target_state.acceleration.as_array(),
        ]
    )
    if not np.all(np.isfinite(values)):
        return None
    if constraints.minimum_flight_time_s >= constraints.maximum_flight_time_s:
        return None
    relative = target_state.position.as_array() - launcher_position.as_array()
    distance = float(np.linalg.norm(relative))
    if distance <= 1e-9:
        return None
    time_guess = float(
        np.clip(
            distance / muzzle_velocity_mps,
            constraints.minimum_flight_time_s,
            constraints.maximum_flight_time_s,
        )
    )
    predicted = target_position_at(target_state, time_guess)
    azimuth_guess, elevation_guess = _initial_angles(
        predicted - launcher_position.as_array(),
        muzzle_velocity_mps,
        projectile_model.gravity_mps2,
    )
    lower = np.array(
        [
            constraints.minimum_azimuth_rad,
            constraints.minimum_elevation_rad,
            constraints.minimum_flight_time_s,
        ],
        dtype=np.float64,
    )
    upper = np.array(
        [
            constraints.maximum_azimuth_rad,
            constraints.maximum_elevation_rad,
            constraints.maximum_flight_time_s,
        ],
        dtype=np.float64,
    )
    initial = np.clip(np.array([azimuth_guess, elevation_guess, time_guess]), lower, upper)

    def residual(parameters: np.ndarray) -> np.ndarray:
        azimuth, elevation, flight_time = (float(value) for value in parameters)
        try:
            trajectory = integrate_projectile(
                launcher_position.as_array(),
                launch_velocity(muzzle_velocity_mps, azimuth, elevation),
                projectile_model,
                flight_time,
                constraints.integration_timestep_s,
            )
            return np.asarray(
                trajectory.positions_m[-1] - target_position_at(target_state, flight_time),
                dtype=np.float64,
            )
        except (ValueError, FloatingPointError):
            return np.full(3, 1e6, dtype=np.float64)

    try:
        result = least_squares(
            residual,
            initial,
            bounds=(lower, upper),
            max_nfev=constraints.maximum_iterations,
            xtol=1e-9,
            ftol=1e-9,
            gtol=1e-9,
        )
    except (ValueError, FloatingPointError, OverflowError):
        return None
    if not np.all(np.isfinite(result.x)):
        return None
    azimuth, elevation, flight_time = (float(value) for value in result.x)
    try:
        trajectory = integrate_projectile(
            launcher_position.as_array(),
            launch_velocity(muzzle_velocity_mps, azimuth, elevation),
            projectile_model,
            flight_time,
            constraints.integration_timestep_s,
        )
    except (ValueError, FloatingPointError):
        return None
    evaluation = evaluate_closest_approach(
        trajectory,
        target_state,
        constraints.projectile_radius_m,
        constraints.target_radius_m,
    )
    target_position = evaluation.target_position.as_array()
    impact = evaluation.projectile_position.as_array()
    flight_time = evaluation.time_s
    miss = evaluation.center_distance_m
    valid = bool(result.success and miss <= constraints.valid_miss_distance_m)
    confidence = float(
        np.clip(
            target_state.confidence
            * math.exp(-miss / max(constraints.valid_miss_distance_m, 1e-9)),
            0.0,
            1.0,
        )
    )
    sample_step = max(1, len(trajectory.times_s) // 60)
    return BallisticSolution(
        valid,
        azimuth,
        elevation,
        flight_time,
        Vector3.from_array(target_position),
        Vector3.from_array(impact),
        miss,
        int(result.nfev),
        confidence,
        "numerical",
        tuple(Vector3.from_array(point) for point in trajectory.positions_m[::sample_step]),
        None if valid else "optimizer did not converge within miss tolerance",
    )


def solve_with_fallback(
    launcher_position: Vector3,
    target_state: TargetState,
    muzzle_velocity_mps: float,
    projectile_model: ProjectileModel,
    constraints: SolverConstraints,
) -> BallisticSolution | None:
    """Return a valid numerical solution or a marked fallback approximation."""
    numerical = solve_intercept(
        launcher_position,
        target_state,
        muzzle_velocity_mps,
        projectile_model,
        constraints,
    )
    if numerical is not None and numerical.valid:
        return numerical
    return fallback_intercept(
        launcher_position,
        target_state,
        muzzle_velocity_mps,
        projectile_model,
        constraints.maximum_flight_time_s,
        constraints.integration_timestep_s,
        constraints.projectile_radius_m,
        constraints.target_radius_m,
    )


def _initial_angles(
    relative_position: np.ndarray, speed_mps: float, gravity: np.ndarray
) -> tuple[float, float]:
    horizontal = float(np.hypot(relative_position[0], relative_position[1]))
    azimuth = math.atan2(float(relative_position[1]), float(relative_position[0]))
    direct = math.atan2(float(relative_position[2]), max(horizontal, 1e-9))
    gravity_magnitude = float(np.linalg.norm(gravity))
    if horizontal <= 1e-9 or gravity_magnitude <= 1e-9:
        return azimuth, direct
    discriminant = speed_mps**4 - gravity_magnitude * (
        gravity_magnitude * horizontal**2 + 2.0 * relative_position[2] * speed_mps**2
    )
    if discriminant < 0.0:
        return azimuth, direct
    elevation = math.atan2(speed_mps**2 - math.sqrt(discriminant), gravity_magnitude * horizontal)
    return azimuth, elevation
