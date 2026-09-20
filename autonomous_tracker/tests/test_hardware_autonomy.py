"""Tests for hardware tracking's software-only autonomy state progression."""

from tracker.cli.run_hardware import _update_autonomy_state
from tracker.config import AppConfig
from tracker.state_machine import StateMachine, SystemState


def test_high_confidence_alignment_reaches_simulation_ready() -> None:
    machine = StateMachine()
    machine.transition(SystemState.TRACKING, "test started")

    _update_autonomy_state(machine, True, 1.0, 1.0, AppConfig())

    assert machine.state == SystemState.READY
    assert [transition.current for transition in machine.history[-2:]] == [
        SystemState.ALIGNED,
        SystemState.READY,
    ]


def test_alignment_loss_returns_to_tracking() -> None:
    machine = StateMachine()
    machine.transition(SystemState.TRACKING, "test started")
    _update_autonomy_state(machine, True, 1.0, 1.0, AppConfig())

    _update_autonomy_state(machine, False, 1.0, 1.0, AppConfig())

    assert machine.state == SystemState.TRACKING
