"""Run camera, motor, latency, or synthetic projectile calibration."""

from __future__ import annotations

import argparse
import json
import time
from contextlib import suppress
from dataclasses import asdict
from pathlib import Path

import cv2
import numpy as np

from tracker.ballistics.models import ProjectileModel
from tracker.calibration.database import CalibrationDatabase
from tracker.calibration.extrinsic import estimate_rigid_transform
from tracker.calibration.intrinsic import CheckerboardCalibrator
from tracker.calibration.latency import LatencyCalibrator
from tracker.calibration.motor import fit_motor_calibration, safe_sweep_points
from tracker.calibration.simulated_projectile import (
    estimate_simulated_parameters,
    generate_synthetic_observations,
)
from tracker.vision.camera import OpenCVCamera


def build_parser() -> argparse.ArgumentParser:
    """Build calibration subcommands."""
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="calibration", required=True)
    camera = subparsers.add_parser("camera")
    camera.add_argument("--device", default="0")
    camera.add_argument("--checkerboard", default="9x6")
    camera.add_argument("--square-size", type=float, default=0.024)
    camera.add_argument("--frames", type=int, default=20)
    camera.add_argument("--output", type=Path, default=Path("calibrations/camera.json"))
    camera.add_argument(
        "--show",
        action="store_true",
        help="show the camera and capture each checkerboard view with Space",
    )
    motor = subparsers.add_parser("motors")
    motor.add_argument("samples", type=Path, nargs="?")
    motor.add_argument("--minimum", type=float, default=-1.0)
    motor.add_argument("--maximum", type=float, default=1.0)
    motor.add_argument("--database", type=Path, default=Path("calibrations/database.json"))
    latency = subparsers.add_parser("latency")
    latency.add_argument("--samples", type=int, default=50)
    latency.add_argument("--database", type=Path, default=Path("calibrations/database.json"))
    extrinsic = subparsers.add_parser("extrinsic")
    extrinsic.add_argument("points", type=Path)
    extrinsic.add_argument("--database", type=Path, default=Path("calibrations/database.json"))
    projectile = subparsers.add_parser("simulated-projectile")
    projectile.add_argument("--database", type=Path, default=Path("calibrations/database.json"))
    return parser


def run(args: argparse.Namespace) -> int:
    """Dispatch one safe calibration workflow."""
    if args.calibration == "camera":
        return _run_camera(args)
    if args.calibration == "motors":
        return _run_motors(args)
    if args.calibration == "latency":
        return _run_latency(args)
    if args.calibration == "extrinsic":
        return _run_extrinsic(args)
    return _run_projectile(args)


def _run_camera(args: argparse.Namespace) -> int:
    columns, rows = (int(value) for value in args.checkerboard.lower().split("x", 1))
    calibrator = CheckerboardCalibrator((columns, rows), args.square_size)
    device: int | str = int(args.device) if str(args.device).isdigit() else args.device
    camera = OpenCVCamera(device, 1280, 720, 30.0)
    attempts = 0
    show = bool(args.show)
    window_name = "Camera Calibration"
    last_accepted_ns = 0
    maximum_attempts = args.frames * (600 if show else 80)
    try:
        while calibrator.observation_count < args.frames and attempts < maximum_attempts:
            frame = camera.read()
            attempts += 1
            if frame is None:
                continue
            capture = True
            if show:
                preview = frame.image.copy()
                cv2.putText(
                    preview,
                    (
                        f"Views {calibrator.observation_count}/{args.frames} | "
                        "SPACE capture | Q quit"
                    ),
                    (18, 34),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.7,
                    (50, 230, 255),
                    2,
                    cv2.LINE_AA,
                )
                cv2.imshow(window_name, preview)
                key = cv2.waitKey(1) & 0xFF
                if key in {27, ord("q")}:
                    break
                capture = key == ord(" ")
            elif frame.capture_timestamp_ns - last_accepted_ns < 250_000_000:
                capture = False
            if not capture:
                continue
            accepted, diagnostic = calibrator.add_image(frame.image)
            if show:
                cv2.imshow(window_name, diagnostic)
            if accepted:
                last_accepted_ns = frame.capture_timestamp_ns
                print(f"accepted checkerboard {calibrator.observation_count}/{args.frames}")
    finally:
        camera.close()
        if show:
            with suppress(cv2.error):
                cv2.destroyWindow(window_name)
    if calibrator.observation_count < args.frames:
        raise ValueError(
            f"camera calibration needs {args.frames} accepted checkerboard views; "
            f"captured {calibrator.observation_count}"
        )
    result = calibrator.calibrate()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    result.save(args.output)
    print(f"saved {args.output} with RMS {result.rms_error:.4f}")
    return 0


def _run_motors(args: argparse.Namespace) -> int:
    if args.samples is None:
        points = safe_sweep_points(args.minimum, args.maximum, 9)
        print("supervised safe sweep points, radians:")
        print(" ".join(f"{point:.4f}" for point in points))
        print("record timestamp_s,commanded_rad,measured_rad as CSV and rerun with its path")
        return 0
    data = np.loadtxt(args.samples, delimiter=",", skiprows=1)
    result = fit_motor_calibration(data[:, 1], data[:, 2], data[:, 0], (args.minimum, args.maximum))
    database = CalibrationDatabase(args.database)
    record = database.add(
        "motor_axis",
        "supervised_position_samples",
        asdict(result),
        {"fit_residual_rad": result.deadband_rad},
    )
    print(json.dumps(record.values, indent=2))
    return 0


def _run_latency(args: argparse.Namespace) -> int:
    calibrator = LatencyCalibrator()
    for _ in range(args.samples):
        start = time.monotonic_ns()
        end = time.monotonic_ns()
        calibrator.record("host_timer_floor", start, end)
    summaries = calibrator.summarize()
    values = {name: asdict(summary) for name, summary in summaries.items()}
    CalibrationDatabase(args.database).add(
        "latency", "monotonic_host_probe", values, {"timer_floor_s": calibrator.end_to_end_s()}
    )
    print(json.dumps(values, indent=2))
    return 0


def _run_extrinsic(args: argparse.Namespace) -> int:
    data = np.loadtxt(args.points, delimiter=",", skiprows=1)
    if data.ndim != 2 or data.shape[1] != 6:
        raise ValueError("extrinsic CSV must contain source_x,y,z,destination_x,y,z")
    transform, rms = estimate_rigid_transform(data[:, :3], data[:, 3:])
    values = {"camera_to_platform": transform.matrix.tolist()}
    CalibrationDatabase(args.database).add(
        "camera_platform_extrinsic",
        "matched_3d_points_kabsch",
        values,
        {"rms_residual_m": rms},
    )
    print(json.dumps(values | {"rms_residual_m": rms}, indent=2))
    return 0


def _run_projectile(args: argparse.Namespace) -> int:
    model = ProjectileModel(
        0.002,
        np.pi * (0.013 * 0.5) ** 2,
        0.45,
        1.225,
        np.array([0.0, 0.0, -9.80665]),
        np.array([0.5, -0.2, 0.0]),
        True,
    )
    direction = np.array([0.95, 0.1, 0.3])
    direction /= np.linalg.norm(direction)
    times, observations = generate_synthetic_observations(
        model, direction * 18.0, 0.8, 0.02, 0.002, 9
    )
    result = estimate_simulated_parameters(
        times,
        observations,
        direction,
        model.mass_kg,
        model.reference_area_m2,
        model.air_density_kgpm3,
        model.gravity_mps2,
    )
    values = {
        "muzzle_velocity_mps": result.muzzle_velocity_mps,
        "drag_coefficient": result.drag_coefficient,
        "wind_mps": result.wind_mps,
    }
    CalibrationDatabase(args.database).add(
        "simulated_projectile",
        "noisy_synthetic_trajectory_optimization",
        values,
        {"rms_residual_m": result.rms_residual_m},
    )
    print(json.dumps(values | {"rms_residual_m": result.rms_residual_m}, indent=2))
    return 0


def main() -> None:
    """CLI entry point."""
    raise SystemExit(run(build_parser().parse_args()))


if __name__ == "__main__":
    main()
