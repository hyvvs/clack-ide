import time

import numpy as np

from tracker.autonomy.selector import TargetSelector
from tracker.config import SelectionWeightConfig
from tracker.types import MotorState, Track


def track(track_id: int, confidence: float) -> Track:
    state = np.zeros(9)
    state[0] = 5.0
    return Track(track_id, state, np.eye(9) * 0.01, confidence, 20, 0, 0, confidence)


def test_target_selection_hysteresis() -> None:
    selector = TargetSelector(SelectionWeightConfig(switch_margin=0.15))
    motor = MotorState(0.0, 0.0, 0.0, 0.0, time.monotonic_ns())
    first = selector.select((track(1, 0.9), track(2, 0.7)), motor)
    assert first is not None and first.track_id == 1
    retained = selector.select((track(1, 0.8), track(2, 0.95)), motor)
    assert retained is not None and retained.track_id == 1
