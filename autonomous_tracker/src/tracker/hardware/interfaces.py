"""Narrow protocols between platform-independent logic and I/O backends."""

from __future__ import annotations

from typing import Protocol

from tracker.types import AimCommand, BallisticSolution, MotorState, SimulatedShot


class PanTiltController(Protocol):
    """Interface implemented by simulated and physical pan and tilt devices."""

    def command_angles(self, azimuth: float, elevation: float) -> None:
        """Command bounded target angles in radians."""
        ...

    def command_velocity(self, azimuth_velocity: float, elevation_velocity: float) -> None:
        """Command bounded target angular velocities."""
        ...

    def stop(self) -> None:
        """Disable movement and clear pending commands."""
        ...

    def home(self) -> None:
        """Move to the configured safe home pose."""
        ...

    def emergency_stop(self) -> None:
        """Latch the software emergency stop."""
        ...

    def reset_emergency_stop(self) -> None:
        """Reset the emergency stop after an explicit operator action."""
        ...

    def state(self) -> MotorState:
        """Return current motor state."""
        ...


class AimController(Protocol):
    """Controller producing a motor command from desired angles."""

    def update(self, desired: AimCommand, measured: MotorState, dt: float) -> AimCommand:
        """Return a constrained angular velocity command."""
        ...


class Launcher(Protocol):
    """Simulation-only launcher interface.

    Implementations return data records only. No physical trigger interface exists.
    """

    def fire(self, solution: BallisticSolution) -> SimulatedShot:
        """Create one simulated projectile event."""
        ...
