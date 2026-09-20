"""Deterministic JSONL session reader with sequence and time validation."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class ReplayEvent:
    """Validated recorded event used as an input to replay processors."""

    sequence: int
    event_type: str
    monotonic_timestamp_ns: int
    payload: dict[str, Any] | list[Any] | str | int | float | bool | None


def read_events(path: str | Path) -> Iterator[ReplayEvent]:
    """Yield valid events while enforcing sequence and monotonic ordering."""
    expected_sequence = 0
    previous_timestamp = -1
    with Path(path).open(encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
                sequence = int(record["sequence"])
                timestamp = int(record["monotonic_timestamp_ns"])
                event_type = str(record["event_type"])
                payload = record["payload"]
            except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
                raise ValueError(f"invalid replay record on line {line_number}") from exc
            if sequence != expected_sequence:
                raise ValueError(f"non-contiguous replay sequence on line {line_number}")
            if timestamp < previous_timestamp:
                raise ValueError(f"non-monotonic replay time on line {line_number}")
            yield ReplayEvent(sequence, event_type, timestamp, payload)
            expected_sequence += 1
            previous_timestamp = timestamp


def replay_session(path: str | Path, processor: Callable[[ReplayEvent], object]) -> list[object]:
    """Replay every event through a deterministic caller-supplied processor."""
    return [processor(event) for event in read_events(path)]
