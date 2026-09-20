"""Physical pan and tilt serial backend with strict limits and E-stop latch."""

from __future__ import annotations

import importlib
import math
import time
from typing import Any

from tracker.config import PanTiltConfig
from tracker.hardware.protocol import (
    FrameParser,
    MessageType,
    ProtocolFrame,
    encode_frame,
    pack_two_floats,
    unpack_motor_state,
)
from tracker.types import MotorState


class SerialPanTilt:
    """Send motor-only framed commands to an optional microcontroller."""

    def __init__(self, config: PanTiltConfig, transport: Any | None = None) -> None:
        if config.serial_port is None and transport is None:
            raise ValueError("serial_port is required for the serial backend")
        self._config = config
        if transport is None:
            try:
                serial_module = importlib.import_module("serial")
            except ImportError as exc:
                raise RuntimeError("install the hardware extra to use SerialPanTilt") from exc
            transport = serial_module.Serial(
                config.serial_port,
                config.serial_baud,
                timeout=0.02,
                write_timeout=0.1,
            )
        self._transport = transport
        self._parser = FrameParser()
        self._sequence = 0
        self._estop_latched = False
        self._state = MotorState(0.0, 0.0, 0.0, 0.0, time.monotonic_ns())

    def command_angles(self, azimuth: float, elevation: float) -> None:
        """Send a finite, mechanically bounded angle command."""
        self._require_motion_allowed()
        if not math.isfinite(azimuth) or not math.isfinite(elevation):
            raise ValueError("angle commands must be finite")
        pan = min(self._config.pan.maximum_rad, max(self._config.pan.minimum_rad, azimuth))
        tilt = min(self._config.tilt.maximum_rad, max(self._config.tilt.minimum_rad, elevation))
        self._send(MessageType.SET_ANGLES, pack_two_floats(pan, tilt))

    def command_velocity(self, azimuth_velocity: float, elevation_velocity: float) -> None:
        """Send a finite, rate-bounded velocity command."""
        self._require_motion_allowed()
        if not math.isfinite(azimuth_velocity) or not math.isfinite(elevation_velocity):
            raise ValueError("velocity commands must be finite")
        pan = min(
            self._config.pan.maximum_velocity_radps,
            max(-self._config.pan.maximum_velocity_radps, azimuth_velocity),
        )
        tilt = min(
            self._config.tilt.maximum_velocity_radps,
            max(-self._config.tilt.maximum_velocity_radps, elevation_velocity),
        )
        self._send(MessageType.SET_VELOCITY, pack_two_floats(pan, tilt))

    def stop(self) -> None:
        """Request immediate motor stop and clear pending MCU commands."""
        self._send(MessageType.STOP)

    def home(self) -> None:
        """Request configured firmware home motion if E-stop is clear."""
        self._require_motion_allowed()
        self._send(MessageType.HOME)

    def emergency_stop(self) -> None:
        """Latch the host E-stop before transmitting the stop request."""
        self._estop_latched = True
        self._send(MessageType.EMERGENCY_STOP)

    def reset_emergency_stop(self) -> None:
        """Explicitly request E-stop reset and leave motors stationary."""
        self._send(MessageType.RESET_EMERGENCY_STOP)
        self._estop_latched = False

    def ping(self) -> None:
        """Transmit the host heartbeat."""
        self._send(MessageType.PING)

    def poll(self) -> tuple[ProtocolFrame, ...]:
        """Read available telemetry and update the latest motor state."""
        waiting = int(getattr(self._transport, "in_waiting", 0))
        data = self._transport.read(max(1, waiting))
        frames = self._parser.feed(data)
        for frame in frames:
            if frame.message_type == MessageType.STATE:
                pan, tilt, pan_velocity, tilt_velocity, flags = unpack_motor_state(frame.payload)
                self._state = MotorState(
                    pan,
                    tilt,
                    pan_velocity,
                    tilt_velocity,
                    time.monotonic_ns(),
                    bool(flags & 0x01),
                    bool(flags & 0x02),
                    "firmware_fault" if flags & 0x04 else None,
                )
            elif frame.message_type == MessageType.FAULT:
                self._state = MotorState(
                    self._state.azimuth_rad,
                    self._state.elevation_rad,
                    0.0,
                    0.0,
                    time.monotonic_ns(),
                    False,
                    self._state.homed,
                    frame.payload.decode("ascii", errors="replace"),
                )
        return tuple(frames)

    def state(self) -> MotorState:
        """Return the most recently received telemetry state."""
        return self._state

    def close(self) -> None:
        """Stop motors before closing the serial transport."""
        try:
            self.stop()
        finally:
            self._transport.close()

    def _send(self, message_type: MessageType, payload: bytes = b"") -> None:
        frame = encode_frame(ProtocolFrame(message_type, self._sequence, payload))
        written = self._transport.write(frame)
        if written != len(frame):
            raise OSError("serial transport accepted a partial protocol frame")
        self._sequence = (self._sequence + 1) & 0xFFFF

    def _require_motion_allowed(self) -> None:
        if self._estop_latched:
            raise RuntimeError("emergency stop is latched")
