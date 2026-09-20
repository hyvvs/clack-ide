"""Host, firmware, camera, tracker, and serial freshness watchdogs."""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass

from tracker.hardware.interfaces import PanTiltController
from tracker.state_machine import StateMachine, SystemState
from tracker.types import SystemHealth


@dataclass(slots=True)
class WatchdogChannel:
    """One named monotonic freshness deadline."""

    name: str
    timeout_ns: int
    last_heartbeat_ns: int
    required: bool = True

    def fresh(self, now_ns: int) -> bool:
        """Return whether this channel is within its deadline."""
        return not self.required or now_ns - self.last_heartbeat_ns <= self.timeout_ns


class WatchdogManager:
    """Aggregate communication freshness and force a fail-safe stop."""

    def __init__(
        self,
        controller: PanTiltController,
        state_machine: StateMachine,
        timeout_s: float = 0.5,
        clock_ns: Callable[[], int] = time.monotonic_ns,
    ) -> None:
        now = clock_ns()
        timeout_ns = int(timeout_s * 1e9)
        self._controller = controller
        self._state_machine = state_machine
        self._clock_ns = clock_ns
        self._channels = {
            name: WatchdogChannel(name, timeout_ns, now)
            for name in ("host", "firmware", "camera", "tracker", "serial")
        }
        self._faulted = False

    def heartbeat(self, channel: str, timestamp_ns: int | None = None) -> None:
        """Mark one named channel fresh."""
        if channel not in self._channels:
            raise KeyError(f"unknown watchdog channel: {channel}")
        self._channels[channel].last_heartbeat_ns = timestamp_ns or self._clock_ns()

    def set_required(self, channel: str, required: bool) -> None:
        """Enable or disable one backend-specific freshness input."""
        self._channels[channel].required = required

    def check(self) -> SystemHealth:
        """Stop motion and enter FAULT on the first expired required input."""
        now = self._clock_ns()
        expired = tuple(name for name, channel in self._channels.items() if not channel.fresh(now))
        if expired and not self._faulted:
            self._controller.stop()
            if self._state_machine.state != SystemState.FAULT:
                self._state_machine.transition(
                    SystemState.FAULT, f"watchdog timeout: {','.join(expired)}"
                )
            self._faulted = True
        return SystemHealth(
            not expired,
            "camera" not in expired,
            "tracker" not in expired,
            "serial" not in expired,
            "host" not in expired,
            tuple(f"{name}_timeout" for name in expired),
        )

    def reset(self) -> None:
        """Refresh all channels after an explicit operator fault reset."""
        now = self._clock_ns()
        for channel in self._channels.values():
            channel.last_heartbeat_ns = now
        self._faulted = False
