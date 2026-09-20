import numpy as np

from tracker.estimation.prediction import predict_target
from tracker.types import TargetState, Vector3


def test_constant_acceleration_prediction() -> None:
    state = TargetState(
        Vector3(1.0, 2.0, 3.0),
        Vector3(2.0, 0.0, -1.0),
        Vector3(0.5, 0.0, 0.0),
        np.eye(9) * 0.01,
        10,
        0.9,
    )
    prediction = predict_target(state, 2.0, process_noise=0.01)
    assert np.allclose(prediction.state.position.as_array(), [6.0, 2.0, 1.0])
    assert prediction.state.timestamp_ns == 2_000_000_010
