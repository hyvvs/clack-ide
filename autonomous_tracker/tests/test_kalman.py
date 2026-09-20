import numpy as np

from tracker.estimation.kalman import ConstantAccelerationKalman


def test_constant_velocity_kalman() -> None:
    rng = np.random.default_rng(4)
    filter_ = ConstantAccelerationKalman(np.zeros(3), 0.01, 0.0025)
    velocity = np.array([1.0, -0.4, 0.2])
    for step in range(1, 101):
        filter_.predict(0.05)
        measurement = velocity * (step * 0.05) + rng.normal(0.0, 0.02, 3)
        filter_.update(measurement)
    assert np.allclose(filter_.state[3:6], velocity, atol=0.08)


def test_acceleration_estimation() -> None:
    filter_ = ConstantAccelerationKalman(np.zeros(3), 0.001, 0.0004)
    acceleration = np.array([0.2, -0.1, 0.05])
    dt = 0.05
    for step in range(1, 161):
        filter_.predict(dt)
        time_s = step * dt
        filter_.update(0.5 * acceleration * time_s**2)
    assert np.allclose(filter_.state[6:9], acceleration, atol=0.03)
