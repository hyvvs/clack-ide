import numpy as np

from tracker.types import Pose3D, Vector3
from tracker.vision.calibration import TransformGraph


def test_transform_roundtrip() -> None:
    matrix = np.eye(4)
    matrix[:3, 3] = [1.0, -2.0, 0.5]
    graph = TransformGraph()
    graph.add(Pose3D(matrix, "camera", "platform"))
    point = Vector3(0.5, 0.25, 2.0, "camera")
    platform = graph.transform_point("camera", "platform", point)
    recovered = graph.transform_point("platform", "camera", platform)
    assert np.allclose(recovered.as_array(), point.as_array())


def test_transform_graph_rotates_position_covariance() -> None:
    rotation = np.array(
        [
            [0.0, -1.0, 0.0, 0.0],
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ],
        dtype=np.float64,
    )
    graph = TransformGraph()
    graph.add(Pose3D(rotation, "camera", "platform"))

    transformed = graph.transform_covariance("camera", "platform", np.diag([4.0, 1.0, 0.25]))

    assert np.allclose(transformed, np.diag([1.0, 4.0, 0.25]))
