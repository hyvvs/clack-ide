import pytest

from tracker.hardware.protocol import (
    FrameParser,
    MessageType,
    ProtocolError,
    ProtocolFrame,
    decode_frame,
    encode_frame,
    pack_two_floats,
)


def test_protocol_roundtrip_and_stream_resync() -> None:
    encoded = encode_frame(ProtocolFrame(MessageType.SET_ANGLES, 42, pack_two_floats(0.1, -0.2)))
    assert decode_frame(encoded).sequence == 42
    parser = FrameParser()
    assert parser.feed(b"noise" + encoded[:4]) == []
    frames = parser.feed(encoded[4:])
    assert frames[0].message_type == MessageType.SET_ANGLES


def test_protocol_rejects_crc_corruption() -> None:
    encoded = bytearray(encode_frame(ProtocolFrame(MessageType.STOP, 1)))
    encoded[-1] ^= 0xFF
    with pytest.raises(ProtocolError):
        decode_frame(bytes(encoded))


def test_protocol_has_no_projectile_command() -> None:
    names = {message.name for message in MessageType}
    assert "FIRE" not in names
    assert "TRIGGER" not in names
    assert "LAUNCH" not in names
