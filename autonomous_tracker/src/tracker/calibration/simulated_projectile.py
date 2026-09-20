"""Safe synthetic trajectory experiment and simulated parameter estimation."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.optimize import least_squares

from tracker.ballistics.integrator import integrate_projectile
from tracker.ballistics.models import ProjectileModel


@dataclass(frozen=True, slots=True)
class SyntheticProjectileCalibration:
    """Estimated simulation parameters and fit residual."""

    muzzle_velocity_mps: float
    drag_coefficient: float
    wind_mps: tuple[float, float, float]
    rms_residual_m: float
    observation_count: int


def generate_synthetic_observations(
    model: ProjectileModel,
    initial_velocity_mps: np.ndarray,
    duration_s: float,
    timestep_s: float,
    noise_standard_deviation_m: float,
    seed: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Generate noisy simulated positions with a deterministic random seed."""
    trajectory = integrate_projectile(
        np.zeros(3), initial_velocity_mps, model, duration_s, timestep_s
    )
    rng = np.random.default_rng(seed)
    observations = trajectory.positions_m + rng.normal(
        0.0, noise_standard_deviation_m, trajectory.positions_m.shape
    )
    return trajectory.times_s, observations


def estimate_simulated_parameters(
    times_s: np.ndarray,
    observations_m: np.ndarray,
    launch_direction: np.ndarray,
    mass_kg: float,
    reference_area_m2: float,
    air_density_kgpm3: float,
    gravity_mps2: np.ndarray,
    initial_guess: tuple[float, float, float, float, float] = (15.0, 0.4, 0.0, 0.0, 0.0),
) -> SyntheticProjectileCalibration:
    """Fit muzzle speed, drag coefficient, and wind from simulated observations."""
    times = np.asarray(times_s, dtype=np.float64)
    observations = np.asarray(observations_m, dtype=np.float64)
    direction = np.asarray(launch_direction, dtype=np.float64)
    direction /= max(float(np.linalg.norm(direction)), 1e-12)
    if times.ndim != 1 or observations.shape != (len(times), 3) or len(times) < 5:
        raise ValueError(
            "trajectory observations must have shape N by 3 with at least five samples"
        )
    timestep = float(np.min(np.diff(times)))

    def residual(parameters: np.ndarray) -> np.ndarray:
        speed, drag, wind_x, wind_y, wind_z = parameters
        model = ProjectileModel(
            mass_kg,
            reference_area_m2,
            float(drag),
            air_density_kgpm3,
            gravity_mps2,
            np.array([wind_x, wind_y, wind_z]),
            True,
        )
        trajectory = integrate_projectile(
            observations[0], direction * speed, model, float(times[-1] - times[0]), timestep
        )
        predicted = np.column_stack(
            [
                np.interp(times - times[0], trajectory.times_s, trajectory.positions_m[:, axis])
                for axis in range(3)
            ]
        )
        return (predicted - observations).reshape(-1)

    result = least_squares(
        residual,
        np.asarray(initial_guess, dtype=np.float64),
        bounds=([1.0, 0.0, -20.0, -20.0, -20.0], [100.0, 3.0, 20.0, 20.0, 20.0]),
        max_nfev=120,
    )
    rms = float(np.sqrt(np.mean(result.fun**2)))
    return SyntheticProjectileCalibration(
        float(result.x[0]),
        float(result.x[1]),
        (float(result.x[2]), float(result.x[3]), float(result.x[4])),
        rms,
        len(times),
    )
