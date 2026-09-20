import time

import numpy as np

from tracker.state_machine import SystemState
from tracker.types import AlignmentMetrics, MotorState
from tracker.vision.overlay import OverlayDiagnostics, draw_debug_overlay


def test_debug_overlay_draws_without_mutating_input() -> None:
    image = np.zeros((120, 320, 3), dtype=np.uint8)
    diagnostics = OverlayDiagnostics(
        0.1,
        0.2,
        AlignmentMetrics(0.1, 0.2, 0.22, 0.8),
        SystemState.TRACKING,
        30.0,
        12.0,
    )
    rendered = draw_debug_overlay(
        image,
        [],
        (),
        MotorState(0.0, 0.0, 0.0, 0.0, time.monotonic_ns()),
        None,
        diagnostics,
    )
    assert not np.any(image)
    assert np.any(rendered)
