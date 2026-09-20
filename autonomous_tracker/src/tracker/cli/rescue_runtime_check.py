"""Verify the packaged observation runtime without changing an existing workspace."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import sys
import time
import tkinter as tk
from pathlib import Path

import cv2
import torch
from ultralytics import YOLO  # type: ignore[attr-defined]

from tracker.cli.rescue_desktop import prepare_workspace
from tracker.rescue.studio_home import StudioHome


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--weights", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    errors: list[str] = []
    root = tk.Tk()
    root.withdraw()
    root.report_callback_exception = lambda kind, value, trace: errors.append(str(value))
    workspace = prepare_workspace(args.output / "workspace")
    try:
        app = StudioHome(root, workspace)
        deadline = time.monotonic() + 10
        while app.scanning and time.monotonic() < deadline:
            root.update()
            time.sleep(0.02)
        if app.scanning or errors:
            raise RuntimeError(f"Desktop startup failed: {errors}")
        model_task = None
        if args.weights:
            if not args.weights.is_file():
                raise ValueError("Runtime check requires local weights; no downloads.")
            model_task = YOLO(str(args.weights.resolve())).task
        payload = {
            "status": "passed",
            "python": sys.executable,
            "prefix": sys.prefix,
            "sys_path": sys.path,
            "isolated": sys.flags.isolated,
            "opencv_ui": cv2.currentUIFramework(),
            "tk": root.tk.call("info", "patchlevel"),
            "cuda_available": torch.cuda.is_available(),
            "model_task": model_task,
            "versions": {
                name: importlib.metadata.version(name)
                for name in ("numpy", "opencv-python", "torch", "ultralytics", "pydantic", "lap")
            },
            "errors": errors,
        }
        with (args.output / "runtime-check.json").open("x", encoding="utf-8") as stream:
            json.dump(payload, stream, indent=2)
        print(json.dumps(payload, indent=2))
    finally:
        for callback in root.tk.call("after", "info"):
            root.tk.call("after", "cancel", callback)
        root.destroy()


if __name__ == "__main__":
    main()
