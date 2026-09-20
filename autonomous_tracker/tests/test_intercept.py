import math

import numpy as np

from tracker.ballistics.models import ProjectileModel
from tracker.ballistics.solver import SolverConstraints, solve_intercept, solve_with_fallback
from tracker.types import TargetState, Vector3


def target(position: Vector3, velocity: Vector3 | None = None) -> TargetState:
    velocity = velocity or Vector3(0.0, 0.0, 0.0)
    return TargetState(
        position,
        velocity,
        Vector3(0.0, 0.0, 0.0),
        np.eye(9) * 0.001,
        0,
        0.95,
    )


def projectile() -> ProjectileModel:
    return ProjectileModel(
        0.01,
        0.0001,
        0.45,
        1.225,
        np.array([0.0, 0.0, -9.80665]),
        np.zeros(3),
        False,
    )


def test_stationary_target_intercept() -> None:
    solution = solve_intercept(
        Vector3(0.0, 0.0, 0.0),
        target(Vector3(8.0, 0.0, 1.0)),
        18.0,
        projectile(),
        SolverConstraints(integration_timestep_s=0.01),
    )
    assert solution is not None and solution.valid
    assert solution.miss_distance_m < 0.02


def test_moving_target_intercept() -> None:
    solution = solve_intercept(
        Vector3(0.0, 0.0, 0.0),
        target(Vector3(8.0, 0.0, 1.0), Vector3(0.0, 1.2, 0.0)),
        18.0,
        projectile(),
        SolverConstraints(integration_timestep_s=0.01),
    )
    assert solution is not None and solution.valid
    assert solution.azimuth_rad > 0.0
    assert solution.miss_distance_m < 0.03


def test_solver_failure_fallback() -> None:
    constraints = SolverConstraints(
        maximum_flight_time_s=0.1,
        maximum_iterations=1,
        valid_miss_distance_m=1e-9,
        integration_timestep_s=0.01,
    )
    solution = solve_with_fallback(
        Vector3(0.0, 0.0, 0.0),
        target(Vector3(8.0, 0.0, 1.0)),
        18.0,
        projectile(),
        constraints,
    )
    assert solution is not None
    assert solution.method == "fallback"
    assert solution.confidence < 0.5


def test_invalid_muzzle_speed_is_rejected() -> None:
    solution = solve_intercept(
        Vector3(0.0, 0.0, 0.0),
        target(Vector3(8.0, 0.0, 1.0)),
        math.nan,
        projectile(),
        SolverConstraints(),
    )
    assert solution is None
