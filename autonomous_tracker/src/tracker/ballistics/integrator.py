"""Fixed-step RK4 integration for deterministic simulated projectile flight."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import ArrayLike

from tracker.ballistics.models import ProjectileModel
from tracker.types import FloatArray, Vector3


@dataclass(frozen=True, slots=True)
class ProjectileTrajectory:
    """Sampled simulated projectile state over time."""

    times_s: FloatArray
    positions_m: FloatArray
    velocities_mps: FloatArray

    @property
    def final_position(self) -> Vector3:
        """Return final simulated position in the platform frame."""
        return Vector3.from_array(self.positions_m[-1])


def launch_velocity(speed_mps: float, azimuth_rad: float, elevation_rad: float) -> FloatArray:
    """Convert speed and aim angles to a platform-frame velocity vector."""
    if speed_mps <= 0.0 or not all(
        math.isfinite(value) for value in (speed_mps, azimuth_rad, elevation_rad)
    ):
        raise ValueError("launch speed and angles must be finite, with positive speed")
    horizontal = speed_mps * math.cos(elevation_rad)
    return np.array(
        [
            horizontal * math.cos(azimuth_rad),
            horizontal * math.sin(azimuth_rad),
            speed_mps * math.sin(elevation_rad),
        ],
        dtype=np.float64,
    )


def integrate_projectile(
    initial_position_m: ArrayLike,
    initial_velocity_mps: ArrayLike,
    model: ProjectileModel,
    duration_s: float,
    timestep_s: float,
) -> ProjectileTrajectory:
    """Integrate one simulated trajectory with deterministic RK4 steps."""
    if not math.isfinite(duration_s) or duration_s < 0.0:
        raise ValueError("duration must be finite and nonnegative")
    if not math.isfinite(timestep_s) or timestep_s <= 0.0:
        raise ValueError("timestep must be positive and finite")
    position = np.asarray(initial_position_m, dtype=np.float64).reshape(-1)
    velocity = np.asarray(initial_velocity_mps, dtype=np.float64).reshape(-1)
    if position.shape != (3,) or velocity.shape != (3,):
        raise ValueError("position and velocity must contain three values")
    if not np.all(np.isfinite(position)) or not np.all(np.isfinite(velocity)):
        raise ValueError("initial projectile state must be finite")
    step_count = max(1, math.ceil(duration_s / timestep_s))
    times = np.linspace(0.0, duration_s, step_count + 1, dtype=np.float64)
    positions = np.empty((step_count + 1, 3), dtype=np.float64)
    velocities = np.empty((step_count + 1, 3), dtype=np.float64)
    positions[0] = position
    velocities[0] = velocity
    state = np.concatenate([position, velocity])
    for index in range(step_count):
        dt = float(times[index + 1] - times[index])
        state = _rk4_step(state, dt, model)
        if not np.all(np.isfinite(state)):
            raise FloatingPointError("simulated projectile integration became non-finite")
        positions[index + 1] = state[:3]
        velocities[index + 1] = state[3:]
    return ProjectileTrajectory(times, positions, velocities)


def _derivative(state: FloatArray, model: ProjectileModel) -> FloatArray:
    return np.concatenate([state[3:], model.acceleration(state[3:])])


def _rk4_step(state: FloatArray, dt: float, model: ProjectileModel) -> FloatArray:
    k1 = _derivative(state, model)
    k2 = _derivative(state + 0.5 * dt * k1, model)
    k3 = _derivative(state + 0.5 * dt * k2, model)
    k4 = _derivative(state + dt * k3, model)
    return state + dt * (k1 + 2.0 * k2 + 2.0 * k3 + k4) / 6.0
