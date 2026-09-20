from pathlib import Path

import pytest

from tracker.config import AppConfig, load_config


def test_default_config_is_valid() -> None:
    config = AppConfig()
    assert config.system.mode == "simulation"
    assert config.projectile.reference_area_m2 > 0.0


def test_config_rejects_invalid_axis_limits() -> None:
    with pytest.raises(ValueError):
        AppConfig.model_validate(
            {
                "pan_tilt": {
                    "pan": {"minimum_rad": 1.0, "maximum_rad": -1.0},
                }
            }
        )


def test_load_config(tmp_path: Path) -> None:
    path = tmp_path / "config.yaml"
    path.write_text("system:\n  mode: simulation\n  loop_hz: 50\n", encoding="utf-8")
    assert load_config(path).system.loop_hz == 50.0
