import numpy as np

from tracker.config import EstimatorConfig, TargetConfig
from tracker.types import TargetDetection, Vector3
from tracker.vision.tracker import MultiTargetTracker


def detection(
    position: tuple[float, float, float], timestamp_ns: int, label: str = "test"
) -> TargetDetection:
    return TargetDetection(
        (0.0, 0.0, 10.0, 10.0),
        (5.0, 5.0),
        0.95,
        label,
        timestamp_ns,
        position=Vector3(*position),
        position_covariance=np.eye(3) * 0.001,
    )


def test_tracker_keeps_persistent_ids() -> None:
    tracker = MultiTargetTracker(TargetConfig(), EstimatorConfig())
    tracks = tracker.update([detection((3.0, 0.0, 1.0), 0)], 0)
    track_id = tracks[0].track_id
    tracks = tracker.update([detection((3.01, 0.02, 1.0), 50_000_000)], 50_000_000)
    assert tracks[0].track_id == track_id
    assert tracks[0].missed_frames == 0


def test_temporary_target_loss_expires_after_limit() -> None:
    estimator = EstimatorConfig(max_missed_frames=2, track_timeout_s=10.0)
    tracker = MultiTargetTracker(TargetConfig(), estimator)
    tracker.update([detection((3.0, 0.0, 1.0), 0)], 0)
    assert tracker.update([], 10_000_000)
    assert tracker.update([], 20_000_000)
    assert not tracker.update([], 30_000_000)


def test_tracker_does_not_associate_different_object_classes() -> None:
    tracker = MultiTargetTracker(TargetConfig(), EstimatorConfig())
    tracker.update([detection((3.0, 0.0, 1.0), 0, "ball")], 0)

    tracks = tracker.update([detection((3.0, 0.0, 1.0), 10_000_000, "kite")], 10_000_000)

    assert len(tracks) == 2
    assert {track.class_label for track in tracks} == {"ball", "kite"}
