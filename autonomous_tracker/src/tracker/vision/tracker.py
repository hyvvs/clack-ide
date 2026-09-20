"""Gated Hungarian multi-target tracking with persistent identifiers."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import linear_sum_assignment

from tracker.config import EstimatorConfig, TargetConfig
from tracker.estimation.kalman import ConstantAccelerationKalman
from tracker.estimation.track_state import confidence_from_covariance
from tracker.types import TargetDetection, Track


@dataclass(slots=True)
class _ManagedTrack:
    track: Track
    filter: ConstantAccelerationKalman


class MultiTargetTracker:
    """Associate 3D measurements and maintain independent Kalman tracks."""

    def __init__(self, target: TargetConfig, estimator: EstimatorConfig) -> None:
        self._target_config = target
        self._estimator_config = estimator
        self._tracks: dict[int, _ManagedTrack] = {}
        self._next_track_id = 1
        self._last_predict_ns: int | None = None

    @property
    def tracks(self) -> tuple[Track, ...]:
        """Return track snapshots sorted by identifier."""
        return tuple(self._tracks[key].track for key in sorted(self._tracks))

    def update(self, detections: list[TargetDetection], timestamp_ns: int) -> tuple[Track, ...]:
        """Predict, associate, update, create, and prune tracks."""
        if self._last_predict_ns is None:
            dt = 0.0
        else:
            dt = max(0.0, (timestamp_ns - self._last_predict_ns) * 1e-9)
        self._last_predict_ns = timestamp_ns
        for managed in self._tracks.values():
            if dt > 0.0:
                managed.filter.predict(dt)
            managed.track.state = managed.filter.state.copy()
            managed.track.covariance = managed.filter.covariance.copy()
            managed.track.age_frames += 1
            managed.track.missed_frames += 1

        valid_detections = [
            detection
            for detection in detections
            if detection.position is not None
            and detection.confidence >= self._target_config.minimum_confidence
        ]
        track_ids = list(self._tracks)
        assigned_detections: set[int] = set()
        if track_ids and valid_detections:
            costs = np.full((len(track_ids), len(valid_detections)), 1e9, dtype=np.float64)
            for row, track_id in enumerate(track_ids):
                managed = self._tracks[track_id]
                for column, detection in enumerate(valid_detections):
                    assert detection.position is not None
                    if detection.class_label != managed.track.class_label:
                        continue
                    euclidean = float(
                        np.linalg.norm(detection.position.as_array() - managed.filter.state[:3])
                    )
                    if euclidean <= self._target_config.association_gate_m:
                        costs[row, column] = euclidean
            rows, columns = linear_sum_assignment(costs)
            for row_index, column_index in zip(rows, columns, strict=True):
                if costs[row_index, column_index] >= 1e8:
                    continue
                track_id = track_ids[int(row_index)]
                detection = valid_detections[int(column_index)]
                self._apply_detection(self._tracks[track_id], detection, timestamp_ns)
                assigned_detections.add(int(column_index))

        for index, detection in enumerate(valid_detections):
            if index not in assigned_detections:
                self._create_track(detection, timestamp_ns)

        expired = [
            track_id
            for track_id, managed in self._tracks.items()
            if managed.track.missed_frames > self._estimator_config.max_missed_frames
            or (timestamp_ns - managed.track.last_update_ns) * 1e-9
            > self._estimator_config.track_timeout_s
            or float(np.trace(managed.track.covariance[:3, :3]))
            > self._estimator_config.maximum_covariance_trace
        ]
        for track_id in expired:
            del self._tracks[track_id]
        return self.tracks

    def _apply_detection(
        self, managed: _ManagedTrack, detection: TargetDetection, timestamp_ns: int
    ) -> None:
        assert detection.position is not None
        covariance = detection.position_covariance
        managed.filter.update(detection.position.as_array(), covariance)
        track = managed.track
        track.state = managed.filter.state.copy()
        track.covariance = managed.filter.covariance.copy()
        track.missed_frames = 0
        track.last_update_ns = timestamp_ns
        track.detector_confidence = detection.confidence
        track.class_label = detection.class_label
        covariance_confidence = confidence_from_covariance(track.covariance)
        age_confidence = min(1.0, track.age_frames / 8.0)
        track.confidence = float(
            np.clip(detection.confidence * covariance_confidence * age_confidence, 0.0, 1.0)
        )

    def _create_track(self, detection: TargetDetection, timestamp_ns: int) -> None:
        assert detection.position is not None
        filter_ = ConstantAccelerationKalman(
            detection.position.as_array(),
            self._estimator_config.process_noise,
            self._estimator_config.measurement_noise,
        )
        if detection.position_covariance is not None:
            filter_.covariance[:3, :3] = detection.position_covariance
        track = Track(
            self._next_track_id,
            filter_.state.copy(),
            filter_.covariance.copy(),
            min(0.25, detection.confidence),
            1,
            0,
            timestamp_ns,
            detection.confidence,
            detection.class_label,
        )
        self._tracks[track.track_id] = _ManagedTrack(track, filter_)
        self._next_track_id += 1
