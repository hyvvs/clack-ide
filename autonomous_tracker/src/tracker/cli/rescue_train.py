"""Train a separate observation model from a reviewed Rescue Label Studio export."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path
from typing import Any
from unittest.mock import patch
from uuid import uuid4

import yaml
from pydantic import Field

from tracker.rescue.config import ReviewModel
from tracker.rescue.media import file_sha256
from tracker.rescue.training_data import stage_training_data, verify_dataset, write_json
from tracker.rescue.training_workflow import require_fresh_export


class TrainingSettings(ReviewModel):
    epochs: int = Field(default=30, ge=1, le=1000)
    image_size: int = Field(default=640, ge=32, le=2048, multiple_of=32)
    batch: int = Field(default=4, ge=1, le=64)
    device: str = Field(default="cpu", pattern=r"^(cpu|0)$")


class TrainingCancelled(Exception):
    pass


def train(
    data: Path,
    weights: Path,
    output: Path,
    settings: TrainingSettings,
    stop_file: Path | None = None,
) -> Path:
    manifest = verify_dataset(data)
    practice = manifest.get("training_mode") == "practice"
    if not weights.is_file() or weights.suffix.lower() != ".pt":
        raise ValueError(
            "choose a trusted local .pt detection model; no automatic weights downloads"
        )
    baseline_hash = file_sha256(weights)
    from ultralytics import YOLO  # type: ignore[attr-defined]

    model = YOLO(str(weights.resolve()))
    if model.task != "detect":
        raise ValueError(
            "this workflow requires detection weights, not segmentation/classification"
        )
    baseline_classes = sorted(
        set(manifest["classes"]) & {name.casefold() for name in model.names.values()}
    )
    directory = (
        output.resolve() / f"rescue-train-{datetime.now(UTC):%Y%m%d-%H%M%S}-{uuid4().hex[:8]}"
    )
    directory.mkdir(parents=True, exist_ok=False)
    write_json(
        directory / "request.json",
        {
            "data": str(data.resolve()),
            "manifest_sha256": file_sha256(data.parent / "manifest.json"),
            "baseline": str(weights.resolve()),
            "baseline_sha256": baseline_hash,
            "settings": settings.model_dump(),
            "ultralytics_version": version("ultralytics"),
            "torch_version": version("torch"),
            "training_mode": "practice" if practice else "independent_validation",
        },
    )

    def check_stop(_: Any) -> None:
        if stop_file is not None and stop_file.exists():
            raise TrainingCancelled(
                "Training stopped by operator; any existing checkpoints are retained."
            )

    for event in ("on_train_start", "on_train_batch_end", "on_val_batch_end"):
        model.add_callback(event, check_stop)

    def practice_metrics(trainer: Any) -> None:
        if practice:
            trainer.metrics = {}

    model.add_callback("on_train_start", practice_metrics)

    def epoch_progress(trainer: Any) -> None:
        print(f"STUDIO_PROGRESS {trainer.epoch + 1}/{settings.epochs}", flush=True)

    model.add_callback("on_fit_epoch_end", epoch_progress)
    try:
        check_stop(None)
        print(
            "Practice training: NOT INDEPENDENTLY TESTED. No validation scores will be produced."
            if practice
            else "Preparing isolated training/validation copy. Test footage is excluded.",
            flush=True,
        )
        staged = stage_training_data(
            data.resolve(), directory / "dataset", manifest, lambda: check_stop(None)
        )
        check_stop(None)
        # Training runs in its own process; disable optional account/analytics integrations.
        trainer_options: dict[str, Any] = {}
        if practice:
            from tracker.rescue.practice_trainer import PracticeTrainer

            trainer_options["trainer"] = PracticeTrainer
        with patch("ultralytics.utils.callbacks.add_integration_callbacks", lambda _: None):
            model.train(
                **trainer_options,
                data=str(staged.resolve()),
                epochs=settings.epochs,
                imgsz=settings.image_size,
                batch=settings.batch,
                device=settings.device,
                workers=0,
                cache=False,
                amp=False,
                project=str(directory),
                name="fit",
                exist_ok=False,
                plots=False,
                seed=0,
                save=True,
                val=not practice,
                resume=False,
            )
        best = directory / "fit" / "weights" / ("last.pt" if practice else "best.pt")
        if not best.is_file():
            raise ValueError("training returned without its expected checkpoint")
        if file_sha256(weights) != baseline_hash:
            raise ValueError("baseline weights changed during training")

        def review_config(model_path: Path, labels: list[str], name: str) -> dict[str, Any]:
            return {
                "models": [
                    {
                        "name": name,
                        "weights": str(model_path.resolve()),
                        "weights_sha256": file_sha256(model_path),
                        "classes": labels,
                        "device": settings.device,
                        "image_size": settings.image_size,
                    }
                ],
                "review_classes": manifest["classes"],
            }

        config = {
            "models": [
                {
                    "name": "trained_rescue",
                    "weights": str(best),
                    "weights_sha256": file_sha256(best),
                    "classes": manifest["classes"],
                    "device": settings.device,
                    "image_size": settings.image_size,
                }
            ],
            "review_classes": manifest["classes"],
        }
        with (directory / "review.yaml").open("x", encoding="utf-8") as stream:
            yaml.safe_dump(config, stream, sort_keys=False, allow_unicode=True)
        baseline_config = directory / "baseline-review.yaml"
        if baseline_classes:
            with baseline_config.open("x", encoding="utf-8") as stream:
                yaml.safe_dump(
                    review_config(weights, baseline_classes, "starting_model"),
                    stream,
                    sort_keys=False,
                )
        write_json(
            directory / "result.json",
            {
                "status": "completed",
                "training_mode": "practice" if practice else "independent_validation",
                "independently_tested": False,
                "checkpoint_selection": "last_epoch" if practice else "validation_fitness",
                "best_weights": str(best),
                "review_config": str(directory / "review.yaml"),
                "baseline_review_config": str(baseline_config) if baseline_classes else None,
                "baseline_unsupported_classes": sorted(
                    set(manifest["classes"]) - set(baseline_classes)
                ),
                "note": "NOT INDEPENDENTLY TESTED. Practice model; no validation scores."
                if practice
                else "Training completion does not establish accuracy. "
                "Evaluate on held-out incidents.",
            },
        )
        print(f"New weights: {best}\nObservation config: {directory / 'review.yaml'}", flush=True)
        return best
    except BaseException as exc:
        write_json(
            directory / "result.json",
            {
                "status": "stopped"
                if isinstance(exc, (TrainingCancelled, KeyboardInterrupt))
                else "failed",
                "error": str(exc),
            },
        )
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("diagnostics/rescue-training"))
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--image-size", type=int, default=640)
    parser.add_argument("--batch", type=int, default=4)
    parser.add_argument("--device", choices=["cpu", "0"], default="cpu")
    parser.add_argument("--stop-file", type=Path)
    parser.add_argument("--result-file", type=Path, help="new receipt file for the desktop job")
    parser.add_argument("--require-current-project", type=Path, action="append", default=[])
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    try:
        settings = TrainingSettings(
            epochs=args.epochs, image_size=args.image_size, batch=args.batch, device=args.device
        )
        if args.check_only:
            manifest = verify_dataset(args.data)
            print(
                json.dumps({"classes": manifest["classes"], "frames": manifest["frames"]}, indent=2)
            )
            return
        if args.result_file is not None and args.result_file.exists():
            raise ValueError("result receipt already exists; use a new path")
        if args.require_current_project:
            require_fresh_export(args.data, args.require_current_project)
        best = train(args.data, args.weights, args.output, settings, args.stop_file)
        if args.result_file is not None:
            write_json(args.result_file, {"training_result": str(best.parents[2] / "result.json")})
    except (OSError, ValueError, RuntimeError, ImportError, TrainingCancelled) as exc:
        parser.exit(1, f"Training did not complete: {exc}\n")


if __name__ == "__main__":
    main()
