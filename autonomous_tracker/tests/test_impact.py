import numpy as np

from tracker.ballistics.impact import (
    evaluate_closest_approach,
    evaluate_sampled_closest_approach,
)
from tracker.ballistics.integrator import ProjectileTrajectory
from tracker.types import TargetState, Vector3


def test_continuous_collision_between_samples() -> None:
    trajectory = ProjectileTrajectory(
        np.array([0.0, 1.0]),
        np.array([[0.0, 0.0, 0.0], [2.0, 0.0, 0.0]]),
        np.array([[2.0, 0.0, 0.0], [2.0, 0.0, 0.0]]),
    )
    target = TargetState(
        Vector3(1.0, 0.0, 0.0),
        Vector3(0.0, 0.0, 0.0),
        Vector3(0.0, 0.0, 0.0),
        np.eye(9),
        0,
        1.0,
    )
    evaluation = evaluate_closest_approach(trajectory, target, 0.01, 0.05)
    assert evaluation.collided
    assert np.isclose(evaluation.time_s, 0.5)
    assert evaluation.center_distance_m < 1e-12


def test_sampled_truth_collision_between_samples() -> None:
    trajectory = ProjectileTrajectory(
        np.array([0.0, 1.0]),
        np.array([[0.0, 0.0, 0.0], [2.0, 0.0, 0.0]]),
        np.array([[2.0, 0.0, 0.0], [2.0, 0.0, 0.0]]),
    )
    target_positions = np.array([[1.0, -1.0, 0.0], [1.0, 1.0, 0.0]])

    evaluation = evaluate_sampled_closest_approach(
        trajectory, target_positions, "platform", 0.01, 0.01
    )

    assert evaluation.collided
    assert np.isclose(evaluation.time_s, 0.5)


def test_mach_drag_curve_increases_transonic_drag() -> None:
    from tracker.ballistics.models import ProjectileModel

    model = ProjectileModel(
        0.02,
        0.0001,
        0.3,
        1.225,
        np.array([0.0, 0.0, -9.80665]),
        np.zeros(3),
        True,
        "mach_curve",
        343.0,
        ((0.0, 0.3), (0.8, 0.32), (1.0, 0.55), (1.2, 0.4), (3.0, 0.3)),
    )
    assert model.drag_coefficient_at_speed(343.0) > model.drag_coefficient_at_speed(100.0)
