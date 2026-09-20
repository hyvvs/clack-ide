import pytest

from tracker.state_machine import InvalidTransitionError, StateMachine, SystemState


def test_state_machine_valid_transitions() -> None:
    machine = StateMachine()
    machine.transition(SystemState.TRACKING, "target acquired")
    machine.transition(SystemState.ALIGNED, "within tolerance")
    machine.transition(SystemState.READY, "permission inputs valid")
    machine.transition(SystemState.SIMULATED_FIRING, "simulation requested")
    machine.transition(SystemState.COOLDOWN, "simulated shot complete")
    machine.transition(SystemState.TRACKING, "cooldown complete")
    assert machine.state == SystemState.TRACKING
    assert len(machine.history) == 6


def test_state_machine_fault() -> None:
    machine = StateMachine()
    machine.transition(SystemState.FAULT, "watchdog timeout")
    with pytest.raises(InvalidTransitionError):
        machine.transition(SystemState.TRACKING, "unsafe reset")
    machine.reset_fault("operator reset")
    assert machine.state == SystemState.IDLE
