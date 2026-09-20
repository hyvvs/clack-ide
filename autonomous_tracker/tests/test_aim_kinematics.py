import numpy as np

from tracker.control.aimer import compute_aim_angles, compute_angular_velocity
from tracker.types import Vector3


def test_angular_velocity_matches_finite_difference() -> None:
    origin = Vector3(0.0, 0.0, 0.0)
    position = Vector3(20.0, -5.0, 2.0)
    velocity = Vector3(0.0, 55.5555556, 0.0)
    azimuth_rate, elevation_rate = compute_angular_velocity(origin, position, velocity)
    dt = 1e-6
    future = Vector3.from_array(position.as_array() + velocity.as_array() * dt)
    current_angles = np.asarray(compute_aim_angles(origin, position))
    future_angles = np.asarray(compute_aim_angles(origin, future))
    finite_difference = (future_angles - current_angles) / dt
    assert np.allclose([azimuth_rate, elevation_rate], finite_difference, rtol=1e-5)
