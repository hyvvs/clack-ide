"""Tests for deterministic simulation visualization."""

from __future__ import annotations

import numpy as np
import pytest

from tracker.simulation.visualizer import (
    SimulationFrame,
    SimulationVisualizer,
    opencv_gui_available,
    render_simulation_frame,
)
from tracker.state_machine import SystemState
from tracker.types import AimCommand, AlignmentMetrics, MotorState, Vector3


def test_simulation_frame_renders_camera_and_world_side_by_side() -> None:
    image = np.zeros((180, 320, 3), dtype=np.uint8)
    snapshot = SimulationFrame(
        image,
        (),
        (),
        MotorState(0.1, 0.05, 0.0, 0.0, 1),
        None,
        AimCommand(0.2, 0.1),
        AlignmentMetrics(0.1, 0.05, 0.11, 0.7),
        SystemState.TRACKING,
        None,
        (Vector3(20.0, 3.0, 2.0),),
        (Vector3(4.0, 0.5, 0.5),),
        60.0,
        5.0,
        1,
        1,
    )

    rendered = render_simulation_frame(snapshot)

    assert rendered.shape == (180, 640, 3)
    assert np.any(rendered[:, :320])
    assert np.any(rendered[:, 320:])
    assert not np.any(image)


def test_gui_detection_rejects_headless_opencv(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "tracker.simulation.visualizer.cv2.getBuildInformation",
        lambda: "General configuration\n  GUI: NONE\n",
    )

    assert not opencv_gui_available()
    with pytest.raises(RuntimeError, match="opencv-python package"):
        SimulationVisualizer(show=True)
