import numpy as np

from tracker.types import TargetDetection
from tracker.vision.pose import estimate_range_from_width


def test_geometry_range_estimation() -> None:
    detection = TargetDetection((0.0, 0.0, 100.0, 50.0), (0.0, 0.0), 0.9, "test", 0)
    position, covariance = estimate_range_from_width(detection, 0.2, 500.0)
    assert np.isclose(position.x, 1.0)
    assert covariance.shape == (3, 3)
    assert covariance[0, 0] > covariance[1, 1]
