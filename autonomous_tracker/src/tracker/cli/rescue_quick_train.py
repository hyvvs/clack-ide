"""Prepare and train a practice model from a single saved labeling project."""

from __future__ import annotations

import argparse
from pathlib import Path

from tracker.cli.rescue_train import TrainingCancelled, TrainingSettings, train
from tracker.rescue.media import file_sha256
from tracker.rescue.training_data import export_dataset, write_json


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, required=True)
    parser.add_argument("--project-sha256", required=True)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--weights-sha256")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--result-file", type=Path, required=True)
    parser.add_argument("--stop-file", type=Path)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--image-size", type=int, default=640)
    parser.add_argument("--batch", type=int, default=4)
    parser.add_argument("--device", choices=["cpu", "0"], default="cpu")
    args = parser.parse_args()

    def progress(message: str) -> None:
        if args.stop_file is not None and args.stop_file.exists():
            raise TrainingCancelled("Stopped. Original labels and approvals are unchanged.")
        print("STUDIO_STATUS " + message, flush=True)

    try:
        if args.result_file.exists():
            raise ValueError("result receipt already exists")
        settings = TrainingSettings(
            epochs=args.epochs, image_size=args.image_size, batch=args.batch, device=args.device
        )
        if args.weights_sha256 and file_sha256(args.weights) != args.weights_sha256:
            raise ValueError("Saved starting model changed. Choose the intended model again.")
        progress("Preparing your approved labels automatically...")
        data = export_dataset(
            [args.project],
            args.output / "data",
            progress,
            practice=True,
            expected_project_hash=args.project_sha256,
        )
        progress("Training a new practice model. NOT INDEPENDENTLY TESTED.")
        best = train(data, args.weights, args.output, settings, args.stop_file)
        write_json(args.result_file, {"training_result": str(best.parents[2] / "result.json")})
    except (OSError, ValueError, RuntimeError, ImportError, TrainingCancelled) as exc:
        parser.exit(1, f"Training did not complete: {exc}\n")


if __name__ == "__main__":
    main()
