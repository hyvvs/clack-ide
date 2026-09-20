"""Robotics-oriented multi-target scoring with switching hysteresis."""

from __future__ import annotations

import math

import numpy as np

from tracker.config import SelectionWeightConfig
from tracker.control.aimer import compute_aim_angles
from tracker.types import MotorState, Track, Vector3


class TargetSelector:
    """Select stable visible tracks without semantic or threat assessment."""

    def __init__(self, weights: SelectionWeightConfig) -> None:
        self._weights = weights
        self._selected_id: int | None = None

    @property
    def selected_id(self) -> int | None:
        """Return the current persistent selection identifier."""
        return self._selected_id

    def select(self, tracks: tuple[Track, ...], motor: MotorState) -> Track | None:
        """Score tracks and switch only when the challenger clears the margin."""
        if not tracks:
            self._selected_id = None
            return None
        scores = {track.track_id: self.score(track, motor) for track in tracks}
        best = max(tracks, key=lambda track: scores[track.track_id])
        current = next((track for track in tracks if track.track_id == self._selected_id), None)
        if (
            current is None
            or scores[best.track_id] > scores[current.track_id] + self._weights.switch_margin
        ):
            self._selected_id = best.track_id
            return best
        return current

    def score(self, track: Track, motor: MotorState) -> float:
        """Return a bounded criteria score based only on robotics observability."""
        position = Vector3.from_array(track.state[:3])
        distance = max(position.norm(), 1e-6)
        try:
            azimuth, elevation = compute_aim_angles(Vector3(0.0, 0.0, 0.0), position)
            slew = math.hypot(azimuth - motor.azimuth_rad, elevation - motor.elevation_rad)
        except ValueError:
            slew = math.pi
        covariance = float(np.trace(track.covariance[:3, :3]))
        stability = math.exp(-float(np.linalg.norm(track.state[6:9])))
        visibility = 1.0 if track.missed_frames == 0 else math.exp(-track.missed_frames)
        age = 1.0 - math.exp(-track.age_frames / 10.0)
        distance_score = math.exp(-distance / 20.0)
        return (
            self._weights.confidence * track.confidence
            + self._weights.stability * stability
            + self._weights.visibility * visibility
            + self._weights.age * age
            + self._weights.distance * distance_score
            - self._weights.uncertainty * min(covariance, 10.0) / 10.0
            - self._weights.slew * min(slew, math.pi) / math.pi
        )
