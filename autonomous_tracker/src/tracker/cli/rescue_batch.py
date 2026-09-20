"""Run or resume a saved observation-only video batch."""

from __future__ import annotations

import argparse
from pathlib import Path

from tracker.rescue.batch import run_batch


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch", type=Path, required=True)
    parser.add_argument("--stop-file", type=Path, required=True)
    parser.add_argument("--retry", action="store_true")
    args = parser.parse_args()
    try:
        run_batch(args.batch, args.stop_file, retry=args.retry)
    except (OSError, ValueError, RuntimeError) as exc:
        parser.exit(1, f"Batch did not complete: {exc}\n")


if __name__ == "__main__":
    main()
