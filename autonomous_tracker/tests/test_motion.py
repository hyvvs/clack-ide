import math

import pytest

from tracker.config import PanTiltConfig
from tracker.hardware.simulated import SimulatedPanTilt


def test_actuator_saturation_and_estop() -> None:
    config = PanTiltConfig()
    platform = SimulatedPanTilt(config)
    platform.command_angles(100.0, 100.0)
    for _ in range(500):
        platform.step(0.01)
    state = platform.state()
    assert state.azimuth_rad <= math.pi
    assert state.elevation_rad <= config.tilt.maximum_rad
    platform.emergency_stop()
    stopped = platform.state()
    assert not stopped.enabled
    with pytest.raises(RuntimeError):
        platform.command_angles(0.0, 0.0)
