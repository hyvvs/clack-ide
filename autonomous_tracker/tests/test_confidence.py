import time

import numpy as np

from tracker.autonomy.confidence import alignment_confidence, range_aware_alignment_tolerance
from tracker.config import AlignmentWeightConfig
from tracker.types import BallisticSolution, MotorState, Track, Vector3


def solution(valid: bool = True) -> BallisticSolution:
    point = Vector3(5.0, 0.0, 1.0)
    return BallisticSolution(valid, 0.0, 0.0, 0.3, point, point, 0.0, 2, 0.9, "test")


def test_alignment_confidence() -> None:
    track = Track(1, np.zeros(9), np.eye(9) * 0.001, 0.95, 20, 0, 0, 0.98)
    motor = MotorState(0.0, 0.0, 0.0, 0.0, time.monotonic_ns())
    good = alignment_confidence(
        0.001,
        0.001,
        track,
        solution(),
        motor,
        0.01,
        0.02,
        0.2,
        AlignmentWeightConfig(),
    )
    bad = alignment_confidence(
        0.2,
        0.2,
        track,
        solution(False),
        MotorState(0.0, 0.0, 2.0, 2.0, time.monotonic_ns()),
        1.0,
        0.02,
        0.2,
        AlignmentWeightConfig(),
    )
    assert 0.0 <= bad.confidence < good.confidence <= 1.0


def test_range_aware_tolerance_tightens_with_distance() -> None:
    origin = Vector3(0.0, 0.0, 0.0)

    near = range_aware_alignment_tolerance(origin, Vector3(10.0, 0.0, 0.0), 0.5, 0.01, 0.1, 0.5)
    far = range_aware_alignment_tolerance(origin, Vector3(100.0, 0.0, 0.0), 0.5, 0.01, 0.1, 0.5)

    assert 0.0 < far < near < 0.1
