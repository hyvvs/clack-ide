"""Benchmark saved rescue observation runs across independently labeled incidents."""

from __future__ import annotations

import argparse
from pathlib import Path

from tracker.rescue.benchmark import run_benchmark


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=Path("diagnostics/rescue-benchmarks"))
    return parser


def run(args: argparse.Namespace) -> int:
    directory, result = run_benchmark(args.manifest, args.output)
    print(f"Benchmark: {result['status']}")
    print(f"Report: {directory / 'report.md'}")
    print(f"Evidence: {directory / 'summary.json'}")
    for row in result["entries"]:
        print(f"  {row['name']}: {row['status']}")
    if result["aggregate"] is not None:
        print(f"Pooled box metrics: {result['aggregate']['pooled']['overall']}")
    else:
        print("Aggregate withheld; inspect report for input failures.")
    if result["status"] != "completed":
        return 2
    return 1 if result["warnings"] else 0


def main() -> None:
    parser = build_parser()
    try:
        code = run(parser.parse_args())
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    raise SystemExit(code)


if __name__ == "__main__":
    main()
