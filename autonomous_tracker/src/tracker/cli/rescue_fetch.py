"""Download a bounded public-domain disaster observation starter pack."""

from __future__ import annotations

import argparse
from pathlib import Path

from tracker.rescue.footage import SOURCES, fetch_source


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("data/rescue-disaster-starter"))
    parser.add_argument("--stop-file", type=Path)
    args = parser.parse_args()
    failures = 0
    for source in SOURCES:
        if args.stop_file is not None and args.stop_file.exists():
            break
        print(f"Fetching {source.title}", flush=True)
        try:
            fetch_source(args.output.resolve(), source, args.stop_file)
        except Exception as exc:
            failures += 1
            print(f"Unavailable: {source.filename}: {exc}", flush=True)
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
