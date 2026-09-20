"""Thread-safe JSONL event logging with monotonic and wall-clock timestamps."""

from __future__ import annotations

import dataclasses
import json
import threading
import time
from datetime import UTC, datetime
from enum import Enum
from pathlib import Path
from typing import Any

import numpy as np


class JSONLLogger:
    """Append bounded structured records suitable for deterministic replay."""

    def __init__(self, path: str | Path, session_id: str = "default") -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.session_id = session_id
        self._lock = threading.Lock()
        self._sequence = _next_sequence(self.path)

    def log(self, event_type: str, payload: object, timestamp_ns: int | None = None) -> None:
        """Append one JSON record and flush it to disk."""
        if not event_type.strip():
            raise ValueError("event type is required")
        monotonic_timestamp_ns = timestamp_ns or time.monotonic_ns()
        with self._lock:
            record = {
                "schema_version": 1,
                "session_id": self.session_id,
                "sequence": self._sequence,
                "event_type": event_type,
                "monotonic_timestamp_ns": monotonic_timestamp_ns,
                "wall_timestamp": datetime.now(UTC).isoformat(),
                "payload": to_jsonable(payload),
            }
            encoded = json.dumps(record, separators=(",", ":"), allow_nan=False)
            with self.path.open("a", encoding="utf-8", newline="\n") as stream:
                stream.write(encoded + "\n")
                stream.flush()
            self._sequence += 1


def to_jsonable(value: object) -> Any:
    """Convert dataclasses, NumPy values, enums, and paths to JSON-safe data."""
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return {
            field.name: to_jsonable(getattr(value, field.name))
            for field in dataclasses.fields(value)
        }
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(item) for item in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise TypeError(f"unsupported log value: {type(value).__name__}")


def _next_sequence(path: Path) -> int:
    if not path.exists():
        return 0
    expected = 0
    try:
        with path.open(encoding="utf-8") as stream:
            for line in stream:
                if not line.strip():
                    continue
                record = json.loads(line)
                if int(record["sequence"]) != expected:
                    raise ValueError("existing log has a non-contiguous sequence")
                expected += 1
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError(f"cannot append to invalid JSONL log: {path}") from exc
    return expected
