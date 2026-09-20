"""Exercise bundled real YOLO training and batch inference using only synthetic fixtures."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

from tracker.rescue.batch import create_batch, read_batch
from tracker.rescue.media import file_sha256
from tracker.rescue.training_data import export_dataset, write_json


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    args = parser.parse_args()
    workspace = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(workspace / "tests"))
    from test_rescue_training import make_project, read_doc

    directory = workspace / "diagnostics" / f"packaged-workflow-qa-{uuid4().hex[:8]}"
    directory.mkdir(parents=True, exist_ok=False)
    projects = [
        make_project(directory, "synthetic-train", "training"),
        make_project(directory, "synthetic-validation", "validation", 50),
    ]
    data = export_dataset(projects, directory / "exports")
    weights = workspace / "models/rescue-fire-smoke/best.pt"
    digest = file_sha256(weights)
    runtime = args.runtime.resolve()
    environment = {
        key: value
        for key, value in os.environ.items()
        if key not in {"PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV"}
    }
    environment.update(
        PYTHONDONTWRITEBYTECODE="1",
        PYTHONIOENCODING="utf-8",
        TCL_LIBRARY=str(runtime / "tcl/tcl8.6"),
        TK_LIBRARY=str(runtime / "tcl/tk8.6"),
    )

    def run(module: str, arguments: list[str]) -> None:
        print(f"Bundled workflow: {module}", flush=True)
        with (directory / f"{module.rsplit('.', 1)[-1]}.log").open("xb") as log:
            result = subprocess.run(
                [str(runtime / "python.exe"), "-B", "-u", "-m", module, *arguments],
                cwd=directory,
                env=environment,
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=180,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
        if result.returncode:
            raise RuntimeError(f"{module} failed. See logs in {directory}.")

    run(
        "tracker.cli.rescue_train",
        [
            "--data",
            str(data),
            "--weights",
            str(weights),
            "--output",
            str(directory / "runs"),
            "--epochs",
            "1",
            "--image-size",
            "64",
            "--batch",
            "2",
        ],
    )
    training = next((directory / "runs").glob("rescue-train-*/result.json"))
    result = json.loads(training.read_bytes())
    if result["status"] != "completed":
        raise ValueError("Packaged training did not complete.")
    batch = create_batch(
        [Path(read_doc(path).source.path) for path in projects],
        Path(result["review_config"]),
        directory,
    )
    run(
        "tracker.cli.rescue_batch",
        ["--batch", str(batch), "--stop-file", str(directory / "batch.stop"), "--retry"],
    )
    plan = read_batch(batch)
    if plan.status != "completed" or any(item.frames_done != 4 for item in plan.items):
        raise ValueError("Packaged batch inference did not process both synthetic videos.")
    run(
        "tracker.cli.rescue_model_check",
        [
            "--training-result",
            str(training),
            "--project",
            str(projects[1]),
            "--output",
            str(directory / "checks"),
            "--result-file",
            str(directory / "check.json"),
            "--compare",
        ],
    )
    if file_sha256(weights) != digest:
        raise ValueError("Baseline weights changed.")
    report = directory / "verification.json"
    write_json(
        report,
        {
            "status": "passed",
            "runtime": str(runtime),
            "training_result": str(training),
            "batch": str(batch),
            "validation_receipt": str(directory / "check.json"),
            "baseline_sha256": digest,
            "note": "Synthetic fixtures only. Real inference/training, "
            "not real-world accuracy evidence.",
        },
    )
    print(f"Packaged workflow verified: {report}", flush=True)


if __name__ == "__main__":
    main()
