"""CRC-framed pan and tilt protocol with no projectile actuation messages."""

from __future__ import annotations

import struct
from dataclasses import dataclass
from enum import IntEnum

MAGIC = b"PT"
VERSION = 1
HEADER = struct.Struct("<2sBBHH")
CRC = struct.Struct("<H")
MAX_PAYLOAD = 128


class MessageType(IntEnum):
    """Motor, safety, heartbeat, and telemetry message identifiers."""

    SET_ANGLES = 1
    SET_VELOCITY = 2
    STOP = 3
    HOME = 4
    PING = 5
    EMERGENCY_STOP = 6
    RESET_EMERGENCY_STOP = 7
    STATE = 64
    LIMITS = 65
    FAULT = 66
    PONG = 67


@dataclass(frozen=True, slots=True)
class ProtocolFrame:
    """One validated protocol message."""

    message_type: MessageType
    sequence: int
    payload: bytes = b""


class ProtocolError(ValueError):
    """Raised when a serial frame is malformed or fails CRC."""


def crc16_ccitt(data: bytes, initial: int = 0xFFFF) -> int:
    """Compute CRC-16-CCITT-FALSE."""
    crc = initial
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def encode_frame(frame: ProtocolFrame) -> bytes:
    """Encode a bounded frame with version and CRC."""
    if not 0 <= frame.sequence <= 0xFFFF:
        raise ValueError("sequence must fit uint16")
    if len(frame.payload) > MAX_PAYLOAD:
        raise ValueError("protocol payload exceeds configured maximum")
    header = HEADER.pack(
        MAGIC,
        VERSION,
        int(frame.message_type),
        frame.sequence,
        len(frame.payload),
    )
    body = header + frame.payload
    return body + CRC.pack(crc16_ccitt(body))


def decode_frame(data: bytes) -> ProtocolFrame:
    """Decode exactly one complete validated frame."""
    if len(data) < HEADER.size + CRC.size:
        raise ProtocolError("frame is truncated")
    magic, version, raw_type, sequence, payload_length = HEADER.unpack_from(data)
    if magic != MAGIC or version != VERSION:
        raise ProtocolError("bad protocol magic or version")
    if payload_length > MAX_PAYLOAD:
        raise ProtocolError("payload length exceeds maximum")
    expected_length = HEADER.size + payload_length + CRC.size
    if len(data) != expected_length:
        raise ProtocolError("frame length does not match header")
    received_crc = CRC.unpack_from(data, expected_length - CRC.size)[0]
    if crc16_ccitt(data[: -CRC.size]) != received_crc:
        raise ProtocolError("frame CRC mismatch")
    try:
        message_type = MessageType(raw_type)
    except ValueError as exc:
        raise ProtocolError("unknown message type") from exc
    payload = data[HEADER.size : HEADER.size + payload_length]
    return ProtocolFrame(message_type, sequence, payload)


class FrameParser:
    """Incrementally recover complete frames from a noisy byte stream."""

    def __init__(self) -> None:
        self._buffer = bytearray()

    def feed(self, data: bytes) -> list[ProtocolFrame]:
        """Consume bytes, resynchronize on magic, and return valid frames."""
        self._buffer.extend(data)
        frames: list[ProtocolFrame] = []
        while True:
            magic_index = self._buffer.find(MAGIC)
            if magic_index < 0:
                self._buffer[:] = self._buffer[-1:] if self._buffer.endswith(MAGIC[:1]) else b""
                break
            if magic_index > 0:
                del self._buffer[:magic_index]
            if len(self._buffer) < HEADER.size:
                break
            _, version, _, _, payload_length = HEADER.unpack_from(self._buffer)
            if version != VERSION or payload_length > MAX_PAYLOAD:
                del self._buffer[0]
                continue
            length = HEADER.size + payload_length + CRC.size
            if len(self._buffer) < length:
                break
            candidate = bytes(self._buffer[:length])
            try:
                frames.append(decode_frame(candidate))
                del self._buffer[:length]
            except ProtocolError:
                del self._buffer[0]
        return frames


def pack_two_floats(first: float, second: float) -> bytes:
    """Pack two little-endian float32 control values."""
    return struct.pack("<ff", first, second)


def unpack_motor_state(payload: bytes) -> tuple[float, float, float, float, int]:
    """Decode pan, tilt, velocities, and status flags."""
    if len(payload) != struct.calcsize("<ffffB"):
        raise ProtocolError("STATE payload has invalid length")
    pan, tilt, pan_velocity, tilt_velocity, flags = struct.unpack("<ffffB", payload)
    return pan, tilt, pan_velocity, tilt_velocity, flags
