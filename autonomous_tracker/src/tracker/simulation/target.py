"""Synthetic target trajectory models."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from tracker.config import TargetSimulationConfig
from tracker.types import TargetState, Vector3


@dataclass(slots=True)
class SyntheticTarget:
    """Evaluate a deterministic configured target trajectory."""

    target_id: int
    config: TargetSimulationConfig
    start_timestamp_ns: int
    random_seed: int = 0

    def state_at(self, timestamp_ns: int) -> TargetState:
        """Return exact target state at a monotonic timestamp."""
        t = max(0.0, (timestamp_ns - self.start_timestamp_ns) * 1e-9)
        p0 = np.asarray(self.config.initial_position_m, dtype=np.float64)
        velocity = np.asarray(self.config.velocity_mps, dtype=np.float64)
        acceleration = np.asarray(self.config.acceleration_mps2, dtype=np.float64)
        trajectory = self.config.trajectory

        if trajectory == "stationary":
            position = p0
            velocity = np.zeros(3)
            acceleration = np.zeros(3)
        elif trajectory == "constant_velocity":
            position = p0 + velocity * t
            acceleration = np.zeros(3)
        elif trajectory == "accelerating":
            position = p0 + velocity * t + 0.5 * acceleration * t**2
            velocity = velocity + acceleration * t
        elif trajectory == "circular":
            omega = self.config.speed_mps / self.config.radius_m
            phase = omega * t
            radius = self.config.radius_m
            position = p0 + np.array(
                [0.0, radius * math.sin(phase), radius * (1 - math.cos(phase))]
            )
            velocity = np.array(
                [0.0, radius * omega * math.cos(phase), radius * omega * math.sin(phase)]
            )
            acceleration = np.array(
                [0.0, -radius * omega**2 * math.sin(phase), radius * omega**2 * math.cos(phase)]
            )
        elif trajectory == "sinusoidal":
            omega = max(self.config.speed_mps / self.config.radius_m, 1e-6)
            position = p0 + np.array([0.0, self.config.radius_m * math.sin(omega * t), 0.0])
            velocity = np.array([0.0, self.config.radius_m * omega * math.cos(omega * t), 0.0])
            acceleration = np.array(
                [0.0, -self.config.radius_m * omega**2 * math.sin(omega * t), 0.0]
            )
        else:
            segment_s = 1.5
            segment = int(t // segment_s)
            rng = np.random.default_rng(self.random_seed + segment)
            direction = rng.normal(size=3)
            direction[0] *= 0.2
            direction /= max(np.linalg.norm(direction), 1e-9)
            velocity = direction * self.config.speed_mps
            position = p0 + velocity * (t % segment_s)
            acceleration = np.zeros(3)

        covariance = np.eye(9, dtype=np.float64) * 1e-6
        return TargetState(
            Vector3.from_array(position),
            Vector3.from_array(velocity),
            Vector3.from_array(acceleration),
            covariance,
            timestamp_ns,
            1.0,
            self.target_id,
        )
