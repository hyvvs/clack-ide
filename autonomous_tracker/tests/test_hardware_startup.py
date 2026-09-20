"""Tests for actionable hardware startup validation."""

from pathlib import Path

import numpy as np
import pytest

from tracker.calibration.intrinsic import IntrinsicCalibration
from tracker.cli.run_hardware import _load_intrinsic_calibration
from tracker.config import AppConfig, CameraConfig


def test_missing_intrinsics_error_contains_calibration_command(tmp_path: Path) -> None:
    missing = tmp_path / "camera.json"
    config = AppConfig(camera=CameraConfig(intrinsics_path=missing))

    with pytest.raises(FileNotFoundError, match=r"tracker\.cli\.calibrate camera"):
        _load_intrinsic_calibration(config)


def test_intrinsics_must_match_configured_resolution(tmp_path: Path) -> None:
    path = tmp_path / "camera.json"
    IntrinsicCalibration(
        np.eye(3, dtype=np.float64),
        np.zeros(5, dtype=np.float64),
        640,
        480,
        0.1,
        0.1,
        (9, 6),
        0.024,
        "test",
        20,
    ).save(path)
    config = AppConfig(camera=CameraConfig(width=1280, height=720, intrinsics_path=path))

    with pytest.raises(ValueError, match="640x480"):
        _load_intrinsic_calibration(config)
