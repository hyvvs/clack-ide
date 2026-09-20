"""Check observation weights on validation footage, with optional baseline comparison."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from tracker.cli import rescue_review
from tracker.rescue.annotations import AnnotationDocument
from tracker.rescue.dataset_audit import normalize_incident
from tracker.rescue.library import local_review_config
from tracker.rescue.media import FrameReader, file_sha256
from tracker.rescue.scoring import save_evaluation, score_saved_run
from tracker.rescue.training_data import write_json
from tracker.rescue.training_workflow import completed_training


def validation_document(project: Path, result_path: Path) -> AnnotationDocument:
    doc = AnnotationDocument.model_validate_json(project.read_bytes())
    if doc.split != "validation" or not normalize_incident(doc.incident_id):
        raise ValueError(
            "Choose an assigned VALIDATION project. "
            "Keep final test incidents untouched during model selection."
        )
    if not doc.to_truth().frames:
        raise ValueError("Review validation frames before testing the model.")
    request = json.loads((result_path.parent / "request.json").read_bytes())
    manifest_path = Path(request["data"]).parent / "manifest.json"
    if file_sha256(manifest_path) != request["manifest_sha256"]:
        raise ValueError("Training dataset provenance changed; comparison is blocked.")
    manifest = json.loads(manifest_path.read_bytes())
    if set(doc.classes) != set(manifest["classes"]):
        raise ValueError(
            "Validation tags differ from the model's training scope. "
            "Use a matching reviewed project."
        )
    for record in manifest["projects"]:
        if record["split"] not in {"train", "test"}:
            continue
        ancestry = set(record.get("source_ancestors", []))
        snapshot = (manifest_path.parent / record["snapshot"]).resolve()
        if not snapshot.is_relative_to(manifest_path.parent.resolve()):
            raise ValueError("Training snapshot escapes its dataset directory.")
        if file_sha256(snapshot) != manifest["files"].get(record["snapshot"]):
            raise ValueError("Training snapshot changed. Comparison is blocked.")
        ancestry.update(
            AnnotationDocument.model_validate_json(snapshot.read_bytes()).source_ancestors
        )
        if {doc.source.sha256, *doc.source_ancestors} & {
            record["video_sha256"],
            *ancestry,
        } or normalize_incident(doc.incident_id) == normalize_incident(record["incident_id"]):
            raise ValueError(
                "This video or incident belongs to training or final test data, "
                "not model-selection validation."
            )
    return doc


def check_model(
    result_path: Path,
    project: Path,
    output: Path,
    *,
    compare: bool = False,
    stop_file: Path | None = None,
) -> Path:
    result = completed_training(result_path)
    doc = validation_document(project, result_path)
    configs = [("Trained model", Path(result["review_config"]))]
    if compare:
        baseline = result.get("baseline_review_config")
        if not baseline:
            raise ValueError(
                "The starting model supports none of these tags. "
                "Test the trained model alone; no comparable baseline is available."
            )
        configs.append(("Starting model", Path(baseline)))
    for _, config in configs:
        local_review_config(config, Path.cwd())
    reader = FrameReader(Path(doc.source.path))
    try:
        if (
            reader.source.sha256,
            reader.source.width,
            reader.source.height,
            reader.source.frame_count,
        ) != (doc.source.sha256, doc.source.width, doc.source.height, doc.source.frame_count):
            raise ValueError("Validation video no longer matches its annotations.")
    finally:
        reader.close()
    directory = (
        output.resolve() / f"model-check-{datetime.now(UTC):%Y%m%d-%H%M%S}-{uuid4().hex[:8]}"
    )
    directory.mkdir(parents=True, exist_ok=False)
    write_json(directory / "project-snapshot.json", doc.model_dump(mode="json"))
    evaluations = []
    try:
        for number, (name, config) in enumerate(configs):
            if stop_file is not None and stop_file.exists():
                raise ValueError("Model check stopped by operator.")
            arguments = [
                "--video",
                doc.source.path,
                "--config",
                str(config),
                "--output",
                str(directory / f"model-{number}"),
            ]
            if stop_file is not None:
                arguments.extend(["--stop-file", str(stop_file)])
            print(f"Running {name} on validation footage. No annotations are changed.", flush=True)
            rescue_review.run(rescue_review.build_parser().parse_args(arguments))
            runs = list((directory / f"model-{number}").glob("review-*/summary.json"))
            if len(runs) != 1:
                raise ValueError("Expected one complete inference result.")
            metadata = json.loads(runs[0].read_bytes())
            if metadata["status"] != "completed" or (stop_file is not None and stop_file.exists()):
                raise ValueError(
                    "Model check stopped or incomplete. Partial runs are retained, "
                    "not reported as a completed comparison."
                )
            if file_sha256(Path(doc.source.path)) != doc.source.sha256:
                raise ValueError("Validation video changed during inference.")
            measured = score_saved_run(runs[0].parent, doc)
            if not measured["coverage"]["complete_for_reviewed_frames"]:
                raise ValueError("Predictions do not cover every reviewed validation frame.")
            saved = save_evaluation(directory / "evaluations", doc, measured)
            evaluations.append(
                {
                    "name": name,
                    "evaluation_directory": str(saved),
                    "run_directory": str(runs[0].parent),
                    "overall": measured["evaluation"]["overall"],
                    "coverage": measured["coverage"],
                    "processing_ms": measured["processing_ms"],
                    "unsupported_classes": metadata["unsupported_review_classes"],
                }
            )
        summary: dict[str, Any] = {
            "status": "completed",
            "project": str(project.resolve()),
            "training_result": str(result_path.resolve()),
            "source_video_sha256": doc.source.sha256,
            "evaluations": evaluations,
            "note": "Same frozen reviewed labels for all models. "
            "Fixed-IoU box metrics, not mAP or rescue readiness. "
            "Unsupported baseline tags count as misses, so differing label support "
            "is not a like-for-like quality comparison.",
        }
        path = directory / "result.json"
        write_json(path, summary)
        print(f"Validation results: {path}", flush=True)
        return path
    except BaseException as exc:
        write_json(directory / "FAILED.json", {"status": "incomplete", "error": str(exc)})
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--training-result", type=Path, required=True)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--result-file", type=Path, required=True)
    parser.add_argument("--compare", action="store_true")
    parser.add_argument("--stop-file", type=Path)
    args = parser.parse_args()
    try:
        if args.result_file.exists():
            raise ValueError("Result receipt already exists.")
        path = check_model(
            args.training_result,
            args.project,
            args.output,
            compare=args.compare,
            stop_file=args.stop_file,
        )
        write_json(args.result_file, {"check_result": str(path)})
    except (ValueError, OSError, RuntimeError, ImportError) as exc:
        parser.exit(1, f"Model check did not complete: {exc}\n")


if __name__ == "__main__":
    main()
