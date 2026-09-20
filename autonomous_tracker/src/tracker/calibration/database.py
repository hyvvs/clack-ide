"""Atomic versioned JSON calibration record storage."""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class CalibrationRecord:
    """One versioned calibration measurement and its provenance."""

    kind: str
    version: int
    timestamp: str
    method: str
    values: dict[str, Any]
    uncertainty: dict[str, float]
    notes: str = ""


class CalibrationDatabase:
    """Store append-only calibration history and query the latest record."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def add(
        self,
        kind: str,
        method: str,
        values: dict[str, Any],
        uncertainty: dict[str, float],
        notes: str = "",
    ) -> CalibrationRecord:
        """Append a record with an automatically incremented kind version."""
        if not kind.strip() or not method.strip():
            raise ValueError("calibration kind and method are required")
        records = self.all()
        version = 1 + max((record.version for record in records if record.kind == kind), default=0)
        record = CalibrationRecord(
            kind,
            version,
            datetime.now(UTC).isoformat(),
            method,
            values,
            uncertainty,
            notes,
        )
        self._write([*records, record])
        return record

    def all(self, kind: str | None = None) -> list[CalibrationRecord]:
        """Return all records, optionally filtered by kind."""
        if not self.path.exists():
            return []
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            records = [CalibrationRecord(**item) for item in payload.get("records", [])]
        except (OSError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise ValueError(f"invalid calibration database: {self.path}") from exc
        return records if kind is None else [record for record in records if record.kind == kind]

    def latest(self, kind: str) -> CalibrationRecord | None:
        """Return the highest-version record of one calibration kind."""
        records = self.all(kind)
        return max(records, key=lambda record: record.version, default=None)

    def _write(self, records: list[CalibrationRecord]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        payload = {"schema_version": 1, "records": [asdict(record) for record in records]}
        temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        os.replace(temporary, self.path)
