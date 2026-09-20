from pathlib import Path

import numpy as np

from tracker.ballistics.models import ProjectileModel
from tracker.calibration.database import CalibrationDatabase
from tracker.calibration.latency import LatencyCalibrator, effective_prediction_time_s
from tracker.calibration.motor import fit_motor_calibration, safe_sweep_points
from tracker.calibration.simulated_projectile import (
    estimate_simulated_parameters,
    generate_synthetic_observations,
)


def test_calibration_database_versions_records(tmp_path: Path) -> None:
    database = CalibrationDatabase(tmp_path / "calibrations.json")
    first = database.add("camera_latency", "test", {"seconds": 0.01}, {"seconds": 0.001})
    second = database.add("camera_latency", "test", {"seconds": 0.02}, {"seconds": 0.001})
    assert first.version == 1
    assert second.version == 2
    assert database.latest("camera_latency") == second


def test_latency_calibration() -> None:
    calibrator = LatencyCalibrator()
    calibrator.record("camera", 0, 10_000_000)
    calibrator.record("camera", 10_000_000, 30_000_000)
    summary = calibrator.summarize()["camera"]
    assert summary.sample_count == 2
    assert np.isclose(summary.mean_s, 0.015)
    assert np.isclose(effective_prediction_time_s(calibrator.end_to_end_s(), 0.5), 0.515)


def test_motor_calibration_and_safe_points() -> None:
    commands = np.array([-0.8, -0.4, 0.0, 0.4, 0.8, 0.4, 0.0, -0.4])
    timestamps = np.arange(len(commands), dtype=float) * 0.1
    measured = -1.1 * commands + 0.05
    result = fit_motor_calibration(commands, measured, timestamps, (-1.0, 1.0))
    assert result.direction == -1
    assert np.isclose(result.angular_scale, 1.1)
    points = safe_sweep_points(-1.0, 1.0, 5)
    assert np.all(points > -1.0) and np.all(points < 1.0)


def test_synthetic_projectile_calibration() -> None:
    model = ProjectileModel(
        0.01,
        0.0001,
        0.35,
        1.225,
        np.array([0.0, 0.0, -9.80665]),
        np.array([0.0, 0.0, 0.0]),
        True,
    )
    direction = np.array([0.95, 0.1, 0.2])
    direction /= np.linalg.norm(direction)
    times, observations = generate_synthetic_observations(
        model, direction * 17.0, 0.5, 0.025, 0.0, 5
    )
    fitted = estimate_simulated_parameters(
        times,
        observations,
        direction,
        model.mass_kg,
        model.reference_area_m2,
        model.air_density_kgpm3,
        model.gravity_mps2,
        (16.0, 0.3, 0.0, 0.0, 0.0),
    )
    assert abs(fitted.muzzle_velocity_mps - 17.0) < 0.5
    assert fitted.rms_residual_m < 0.01
