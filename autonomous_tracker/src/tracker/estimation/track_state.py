"""Conversion between mutable filter tracks and immutable target states."""

from __future__ import annotations

import math

import numpy as np

from tracker.types import TargetState, Track, Vector3


def confidence_from_covariance(covariance: np.ndarray, scale: float = 3.0) -> float:
    """Map position covariance trace to a normalized confidence."""
    trace = float(np.trace(covariance[:3, :3]))
    if not math.isfinite(trace):
        return 0.0
    return float(math.exp(-max(0.0, trace) / max(scale, 1e-9)))


def track_to_target_state(track: Track) -> TargetState:
    """Create an immutable target state from a tracked filter state."""
    frame = "platform"
    return TargetState(
        Vector3.from_array(track.state[:3], frame),
        Vector3.from_array(track.state[3:6], frame),
        Vector3.from_array(track.state[6:9], frame),
        track.covariance.copy(),
        track.last_update_ns,
        track.confidence,
        track.track_id,
    )
