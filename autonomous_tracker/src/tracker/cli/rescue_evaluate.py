"""Re-score saved rescue observations against a reviewed annotation project."""

from __future__ import annotations

import argparse
from pathlib import Path

from tracker.rescue.annotations import AnnotationDocument
from tracker.rescue.scoring import save_evaluation, score_saved_run


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True, type=Path)
    parser.add_argument("--project", required=True, type=Path)
    parser.add_argument("--iou", type=float, default=0.5)
    parser.add_argument("--output", type=Path, default=Path("diagnostics/rescue-evaluations"))
    args = parser.parse_args()
    try:
        document = AnnotationDocument.model_validate_json(args.project.read_text(encoding="utf-8"))
        result = score_saved_run(args.run, document, args.iou)
        directory = save_evaluation(args.output, document, result)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    print(f"Evaluation: {(directory / 'summary.json').resolve()}")
    print(
        f"Coverage: {result['coverage']['scored_frames']}/{result['coverage']['reviewed_frames']}"
    )
    print(f"Metrics: {result['evaluation']['overall']}")


if __name__ == "__main__":
    main()
