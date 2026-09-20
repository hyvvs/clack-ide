"""Print and validate a recorded deterministic JSONL session."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from tracker.telemetry.replay import read_events


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("session", type=Path)
    args = parser.parse_args()
    counts: dict[str, int] = {}
    last_timestamp = 0
    for event in read_events(args.session):
        counts[event.event_type] = counts.get(event.event_type, 0) + 1
        last_timestamp = event.monotonic_timestamp_ns
    print(json.dumps({"event_counts": counts, "last_timestamp_ns": last_timestamp}, indent=2))


if __name__ == "__main__":
    main()
