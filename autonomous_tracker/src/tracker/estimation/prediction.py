"""Target-motion prediction with covariance-based confidence."""

from __future__ import annotations

import math

import numpy as np

from tracker.estimation.kalman import process_covariance, transition_matrix
from tracker.estimation.track_state import confidence_from_covariance
from tracker.types import TargetPrediction, TargetState, Vector3


def predict_target(
    target: TargetState,
    dt: float,
    model: str = "constant_acceleration",
    process_noise: float = 0.5,
    maximum_horizon_s: float | None = None,
) -> TargetPrediction:
    """Predict a target state using position, velocity, or acceleration dynamics."""
    if not math.isfinite(dt) or dt < 0.0:
        raise ValueError("prediction horizon must be finite and nonnegative")
    if maximum_horizon_s is not None and dt > maximum_horizon_s:
        raise ValueError("prediction horizon exceeds configured maximum")
    state = np.concatenate(
        [
            target.position.as_array(),
            target.velocity.as_array(),
            target.acceleration.as_array(),
        ]
    )
    if model == "constant_position":
        state[3:] = 0.0
        transition = np.eye(9)
    elif model == "constant_velocity":
        state[6:] = 0.0
        transition = transition_matrix(dt)
    elif model == "constant_acceleration":
        transition = transition_matrix(dt)
    else:
        raise ValueError(f"unsupported prediction model: {model}")
    predicted_state = transition @ state
    covariance = transition @ target.covariance @ transition.T
    if dt > 0.0:
        covariance += process_covariance(dt, process_noise)
    confidence = min(target.confidence, confidence_from_covariance(covariance))
    prediction = TargetState(
        Vector3.from_array(predicted_state[:3], target.position.frame),
        Vector3.from_array(predicted_state[3:6], target.velocity.frame),
        Vector3.from_array(predicted_state[6:9], target.acceleration.frame),
        covariance,
        target.timestamp_ns + int(dt * 1e9),
        confidence,
        target.track_id,
    )
    return TargetPrediction(prediction, dt, confidence)
