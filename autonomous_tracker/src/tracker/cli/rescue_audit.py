"""Check annotation projects for exact-video or incident overlap across dataset splits."""

from __future__ import annotations

import argparse
from pathlib import Path

from tracker.rescue.dataset_audit import audit_projects, save_audit


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--projects", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, default=Path("diagnostics/rescue-audits"))
    args = parser.parse_args()
    try:
        result = audit_projects(args.projects)
        path = save_audit(args.output, result)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    print(f"Dataset check: {result['status']} ({result['projects_checked']} valid projects)")
    for issue in result["issues"]:
        print(f"{issue['severity']}: {issue['code']}: {issue['message']}")
    print(f"Report: {path.resolve()}")
    raise SystemExit(
        {"no_known_overlap": 0, "needs_review": 1, "conflicts_found": 2}[result["status"]]
    )


if __name__ == "__main__":
    main()
