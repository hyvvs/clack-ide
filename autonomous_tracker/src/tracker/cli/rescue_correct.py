"""Analyze an entire recorded video and prepare its editable correction handoff."""

from __future__ import annotations

import argparse
from pathlib import Path

from tracker.cli.rescue_review import build_parser, run
from tracker.rescue.correction_workflow import complete_video_run, prepare_correction_project
from tracker.rescue.model_library import ModelLibrary
from tracker.rescue.training_data import write_json


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--project", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--result-file", type=Path, required=True)
    parser.add_argument("--stop-file", type=Path)
    args = parser.parse_args()
    try:
        if args.result_file.exists():
            raise ValueError("The analysis receipt already exists.")
        config = ModelLibrary(args.workspace).config_path(args.model_id)
        options = [
            "--video",
            str(args.video),
            "--config",
            str(config),
            "--output",
            str(args.output),
            "--max-frames",
            "0",
        ]
        if args.stop_file:
            options.extend(["--stop-file", str(args.stop_file)])
        print("STUDIO_STATUS Analyzing every frame. Existing labels remain unchanged.", flush=True)
        if run(build_parser().parse_args(options)):
            raise ValueError("Video analysis did not finish successfully.")
        if args.stop_file is not None and args.stop_file.exists():
            raise ValueError("Analysis stopped. No correction handoff was applied.")
        directory = complete_video_run(args.output)
        project = args.project or prepare_correction_project(
            args.workspace,
            args.video,
            directory,
            args.model_id,
            stopped=lambda: args.stop_file is not None and args.stop_file.exists(),
        )
        write_json(
            args.result_file,
            {"project": str(project.resolve()), "run": str(directory), "model_id": args.model_id},
        )
    except (OSError, ValueError, RuntimeError) as exc:
        parser.exit(1, f"Could not prepare corrections: {exc}\n")


if __name__ == "__main__":
    main()
