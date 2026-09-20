import numpy as np

from tracker.autonomy.placement import AimStrategy, simulated_aim_point
from tracker.types import BallisticSolution, TargetState, Vector3


def test_uncertainty_weighted_placement_reduces_lead() -> None:
    target = TargetState(
        Vector3(5.0, 0.0, 1.0),
        Vector3(0.0, 2.0, 0.0),
        Vector3(0.0, 0.0, 0.0),
        np.eye(9) * 2.0,
        0,
        0.5,
    )
    solution = BallisticSolution(
        True,
        0.0,
        0.0,
        1.0,
        Vector3(5.0, 2.0, 1.0),
        Vector3(5.0, 2.0, 1.0),
        0.0,
        1,
        0.5,
        "test",
    )
    leading = simulated_aim_point(target, solution, AimStrategy.LEADING_PREDICTION)
    weighted = simulated_aim_point(target, solution, AimStrategy.UNCERTAINTY_WEIGHTED)
    assert 0.0 < weighted.y < leading.y
