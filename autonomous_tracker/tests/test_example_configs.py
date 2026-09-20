from pathlib import Path

from tracker.config import load_config


def test_all_example_configs_are_valid() -> None:
    root = Path(__file__).parents[1]
    for name in (
        "default.yaml",
        "simulation.yaml",
        "hardware.yaml",
        "high_speed_200kmh.yaml",
        "yolo_camera.yaml",
    ):
        config = load_config(root / "configs" / name)
        assert config.system.loop_hz > 0.0
