"""Tests for measured motion-state synchronization."""

from __future__ import annotations

import pytest

from tracker.control.trajectory import MotionLimiter


def test_motion_limiter_preserves_measured_acceleration_for_jerk_limit() -> None:
    limiter = MotionLimiter(-2.0, 2.0, 10.0, 20.0, 100.0)
    limiter.set_state(0.1, 1.0, 12.0)

    _, velocity = limiter.update_velocity(10.0, 0.01)

    assert limiter.acceleration_radps2 == pytest.approx(13.0)
    assert velocity == pytest.approx(1.13)


def test_jerk_limiter_brakes_before_requested_velocity() -> None:
    limiter = MotionLimiter(-2.0, 2.0, 10.0, 20.0, 100.0)

    samples = [limiter.update_velocity(1.0, 0.001)[1] for _ in range(2_000)]

    assert max(samples) <= 1.006
    assert samples[-1] == pytest.approx(1.0, abs=0.006)
