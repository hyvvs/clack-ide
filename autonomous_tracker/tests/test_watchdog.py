from tracker.config import PanTiltConfig
from tracker.hardware.simulated import SimulatedPanTilt
from tracker.hardware.watchdog import WatchdogManager
from tracker.state_machine import StateMachine, SystemState


def test_watchdog_fault() -> None:
    now = 0

    def clock() -> int:
        return now

    platform = SimulatedPanTilt(PanTiltConfig())
    machine = StateMachine()
    machine.transition(SystemState.TRACKING, "test started")
    watchdog = WatchdogManager(platform, machine, timeout_s=0.1, clock_ns=clock)
    now = 200_000_000
    health = watchdog.check()
    assert not health.healthy
    assert machine.state == SystemState.FAULT
    assert not platform.state().enabled
