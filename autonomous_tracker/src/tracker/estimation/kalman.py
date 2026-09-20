"""Numerically guarded nine-state constant-acceleration Kalman filter."""

from __future__ import annotations

import numpy as np
from numpy.typing import ArrayLike

from tracker.types import FloatArray


def transition_matrix(dt: float) -> FloatArray:
    """Return the 9 by 9 transition matrix for [p, v, a] vector blocks."""
    if not np.isfinite(dt) or dt < 0.0:
        raise ValueError("dt must be finite and nonnegative")
    matrix = np.eye(9, dtype=np.float64)
    matrix[0:3, 3:6] = np.eye(3) * dt
    matrix[0:3, 6:9] = np.eye(3) * (0.5 * dt**2)
    matrix[3:6, 6:9] = np.eye(3) * dt
    return matrix


def process_covariance(dt: float, spectral_density: float) -> FloatArray:
    """Return discrete covariance for independent white jerk on each axis."""
    if spectral_density <= 0.0 or not np.isfinite(spectral_density):
        raise ValueError("spectral density must be positive and finite")
    block = np.array(
        [
            [dt**5 / 20.0, dt**4 / 8.0, dt**3 / 6.0],
            [dt**4 / 8.0, dt**3 / 3.0, dt**2 / 2.0],
            [dt**3 / 6.0, dt**2 / 2.0, dt],
        ],
        dtype=np.float64,
    )
    covariance = np.zeros((9, 9), dtype=np.float64)
    for axis in range(3):
        indexes = np.array([axis, axis + 3, axis + 6])
        covariance[np.ix_(indexes, indexes)] = block * spectral_density
    return covariance


class ConstantAccelerationKalman:
    """Estimate 3D position, velocity, and acceleration with covariance."""

    def __init__(
        self,
        initial_position: ArrayLike,
        process_noise: float,
        measurement_noise: float,
        initial_covariance: float = 10.0,
    ) -> None:
        position = np.asarray(initial_position, dtype=np.float64).reshape(-1)
        if position.shape != (3,) or not np.all(np.isfinite(position)):
            raise ValueError("initial position must contain three finite values")
        if measurement_noise <= 0.0 or not np.isfinite(measurement_noise):
            raise ValueError("measurement noise must be positive and finite")
        self.state = np.zeros(9, dtype=np.float64)
        self.state[:3] = position
        self.covariance = np.eye(9, dtype=np.float64) * initial_covariance
        self.covariance[:3, :3] = np.eye(3) * measurement_noise
        self.process_noise = process_noise
        self.measurement_covariance = np.eye(3, dtype=np.float64) * measurement_noise

    def predict(self, dt: float) -> FloatArray:
        """Advance state and covariance by monotonic elapsed time."""
        matrix = transition_matrix(dt)
        self.state = matrix @ self.state
        self.covariance = matrix @ self.covariance @ matrix.T + process_covariance(
            dt, self.process_noise
        )
        self._stabilize_covariance()
        return self.state.copy()

    def update(
        self,
        position: ArrayLike,
        measurement_covariance: ArrayLike | None = None,
    ) -> FloatArray:
        """Fuse a 3D position measurement with Joseph-form covariance update."""
        measurement = np.asarray(position, dtype=np.float64).reshape(-1)
        if measurement.shape != (3,) or not np.all(np.isfinite(measurement)):
            raise ValueError("position measurement must contain three finite values")
        covariance = (
            self.measurement_covariance
            if measurement_covariance is None
            else np.asarray(measurement_covariance, dtype=np.float64)
        )
        if covariance.shape != (3, 3) or not np.all(np.isfinite(covariance)):
            raise ValueError("measurement covariance must be finite and 3 by 3")
        observation = np.zeros((3, 9), dtype=np.float64)
        observation[:, :3] = np.eye(3)
        innovation = measurement - observation @ self.state
        innovation_covariance = observation @ self.covariance @ observation.T + covariance
        try:
            gain = np.linalg.solve(innovation_covariance.T, (self.covariance @ observation.T).T).T
        except np.linalg.LinAlgError as exc:
            raise ValueError("singular innovation covariance") from exc
        self.state = self.state + gain @ innovation
        identity = np.eye(9, dtype=np.float64)
        residual = identity - gain @ observation
        self.covariance = residual @ self.covariance @ residual.T + gain @ covariance @ gain.T
        self._stabilize_covariance()
        return self.state.copy()

    def predicted(self, dt: float) -> tuple[FloatArray, FloatArray]:
        """Return a future estimate without mutating this filter."""
        matrix = transition_matrix(dt)
        state = matrix @ self.state
        covariance = matrix @ self.covariance @ matrix.T + process_covariance(
            dt, self.process_noise
        )
        return state, 0.5 * (covariance + covariance.T)

    def mahalanobis_distance(
        self, position: ArrayLike, covariance: FloatArray | None = None
    ) -> float:
        """Return position innovation distance for association gating."""
        measurement = np.asarray(position, dtype=np.float64)
        delta = measurement - self.state[:3]
        total = self.covariance[:3, :3] + (
            self.measurement_covariance if covariance is None else covariance
        )
        try:
            squared = float(delta.T @ np.linalg.solve(total, delta))
        except np.linalg.LinAlgError:
            return float("inf")
        return float(np.sqrt(max(0.0, squared)))

    def _stabilize_covariance(self) -> None:
        self.covariance = 0.5 * (self.covariance + self.covariance.T)
        diagonal = np.maximum(np.diag(self.covariance), 1e-12)
        np.fill_diagonal(self.covariance, diagonal)
