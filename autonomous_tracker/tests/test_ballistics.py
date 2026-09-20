import numpy as np

from tracker.ballistics.integrator import integrate_projectile
from tracker.ballistics.models import ProjectileModel


def model(*, drag: bool, wind: tuple[float, float, float] = (0.0, 0.0, 0.0)) -> ProjectileModel:
    return ProjectileModel(
        0.01,
        0.0001,
        0.5,
        1.225,
        np.array([0.0, 0.0, -9.80665]),
        np.asarray(wind),
        drag,
    )


def test_gravity_only_ballistics() -> None:
    trajectory = integrate_projectile(
        np.zeros(3), np.array([10.0, 0.0, 10.0]), model(drag=False), 1.0, 0.01
    )
    assert np.isclose(trajectory.positions_m[-1, 0], 10.0, atol=1e-7)
    assert np.isclose(trajectory.positions_m[-1, 2], 10.0 - 9.80665 / 2.0, atol=1e-5)


def test_drag_decreases_range() -> None:
    velocity = np.array([20.0, 0.0, 5.0])
    no_drag = integrate_projectile(np.zeros(3), velocity, model(drag=False), 1.0, 0.005)
    drag = integrate_projectile(np.zeros(3), velocity, model(drag=True), 1.0, 0.005)
    assert drag.positions_m[-1, 0] < no_drag.positions_m[-1, 0]


def test_wind_changes_trajectory() -> None:
    velocity = np.array([15.0, 0.0, 4.0])
    calm = integrate_projectile(np.zeros(3), velocity, model(drag=True), 1.0, 0.005)
    windy = integrate_projectile(
        np.zeros(3), velocity, model(drag=True, wind=(0.0, 5.0, 0.0)), 1.0, 0.005
    )
    assert windy.positions_m[-1, 1] > calm.positions_m[-1, 1]
