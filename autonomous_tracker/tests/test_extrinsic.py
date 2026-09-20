import numpy as np

from tracker.calibration.extrinsic import estimate_rigid_transform
from tracker.types import Vector3


def test_extrinsic_calibration_recovers_transform() -> None:
    source = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]])
    angle = 0.3
    rotation = np.array(
        [[np.cos(angle), -np.sin(angle), 0.0], [np.sin(angle), np.cos(angle), 0.0], [0.0, 0.0, 1.0]]
    )
    translation = np.array([0.2, -0.4, 1.0])
    destination = (rotation @ source.T).T + translation
    transform, rms = estimate_rigid_transform(source, destination)
    transformed = transform.transform_point(Vector3(1.0, 0.0, 0.0, "camera"))
    assert np.allclose(transformed.as_array(), destination[1], atol=1e-10)
    assert rms < 1e-10
