"""Plot scalar values from simulation summary JSONL events."""

from __future__ import annotations

import argparse
import importlib
from pathlib import Path

from tracker.telemetry.replay import read_events


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("session", type=Path)
    args = parser.parse_args()
    try:
        pyplot = importlib.import_module("matplotlib.pyplot")
    except ImportError as exc:
        raise SystemExit("install the diagnostics extra to plot logs") from exc
    events = list(read_events(args.session))
    times = [event.monotonic_timestamp_ns * 1e-9 for event in events]
    pyplot.plot(times, range(len(events)), marker=".")
    pyplot.xlabel("monotonic time, s")
    pyplot.ylabel("event sequence")
    pyplot.title("Tracker session event cadence")
    pyplot.show()


if __name__ == "__main__":
    main()
