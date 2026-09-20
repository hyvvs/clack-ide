"""Deterministic, logged system state machine."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from enum import StrEnum


class SystemState(StrEnum):
    """Operating states for tracking, tests, and simulated shots."""

    IDLE = "IDLE"
    CALIBRATING = "CALIBRATING"
    TRACKING = "TRACKING"
    ALIGNED = "ALIGNED"
    READY = "READY"
    SIMULATED_FIRING = "SIMULATED_FIRING"
    COOLDOWN = "COOLDOWN"
    FAULT = "FAULT"
    SUPERVISED_TEST = "SUPERVISED_TEST"


@dataclass(frozen=True, slots=True)
class StateTransition:
    """Auditable state transition record."""

    previous: SystemState
    current: SystemState
    reason: str
    timestamp_ns: int


_ALLOWED: dict[SystemState, frozenset[SystemState]] = {
    SystemState.IDLE: frozenset(
        {SystemState.CALIBRATING, SystemState.TRACKING, SystemState.SUPERVISED_TEST}
    ),
    SystemState.CALIBRATING: frozenset({SystemState.IDLE}),
    SystemState.TRACKING: frozenset({SystemState.IDLE, SystemState.ALIGNED}),
    SystemState.ALIGNED: frozenset({SystemState.TRACKING, SystemState.READY}),
    SystemState.READY: frozenset({SystemState.TRACKING, SystemState.SIMULATED_FIRING}),
    SystemState.SIMULATED_FIRING: frozenset({SystemState.COOLDOWN}),
    SystemState.COOLDOWN: frozenset({SystemState.TRACKING}),
    SystemState.FAULT: frozenset(),
    SystemState.SUPERVISED_TEST: frozenset({SystemState.IDLE}),
}


class InvalidTransitionError(RuntimeError):
    """Raised when a requested state transition is not allowed."""


class StateMachine:
    """Own deterministic system state and transition history."""

    def __init__(self, logger: logging.Logger | None = None) -> None:
        self._state = SystemState.IDLE
        self._history: list[StateTransition] = []
        self._logger = logger or logging.getLogger(__name__)

    @property
    def state(self) -> SystemState:
        """Return current state."""
        return self._state

    @property
    def history(self) -> tuple[StateTransition, ...]:
        """Return immutable transition history."""
        return tuple(self._history)

    def transition(self, destination: SystemState, reason: str) -> StateTransition:
        """Apply a validated transition, with FAULT allowed from every state."""
        if not reason.strip():
            raise ValueError("transition reason is required")
        if destination != SystemState.FAULT and destination not in _ALLOWED[self._state]:
            raise InvalidTransitionError(f"invalid transition {self._state} -> {destination}")
        return self._record(destination, reason)

    def reset_fault(self, reason: str) -> StateTransition:
        """Explicitly reset a faulted system to IDLE."""
        if self._state != SystemState.FAULT:
            raise InvalidTransitionError("fault reset is only valid from FAULT")
        return self._record(SystemState.IDLE, reason)

    def _record(self, destination: SystemState, reason: str) -> StateTransition:
        transition = StateTransition(self._state, destination, reason, time.monotonic_ns())
        self._state = destination
        self._history.append(transition)
        self._logger.info(
            "state_transition",
            extra={
                "previous_state": transition.previous.value,
                "current_state": transition.current.value,
                "reason": transition.reason,
                "timestamp_ns": transition.timestamp_ns,
            },
        )
        return transition
