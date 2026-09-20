"""Validate software-only interception of configurable high-speed lateral flybys."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from tracker.config import load_config
from tracker.simulation.visualizer import SimulationVisualizer
from tracker.simulation.world import SimulationWorld


def build_parser() -> argparse.ArgumentParser:
    """Build the high-speed validation command line."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("configs/high_speed_200kmh.yaml"))
    parser.add_argument("--speed-kmh", type=float, default=200.0)
    parser.add_argument("--distances", type=float, nargs="+", default=[20.0, 50.0, 100.0])
    parser.add_argument("--output", type=Path, default=Path("validation/high_speed_200kmh.json"))
    parser.add_argument(
        "--video-dir",
        type=Path,
        help="write one animated MP4 per tested range",
    )
    parser.add_argument("--show", action="store_true", help="show each run in an OpenCV window")
    parser.add_argument("--playback-fps", type=float, default=60.0)
    return parser


def run(args: argparse.Namespace) -> int:
    """Run each range and fail if any documented accuracy gate is missed."""
    if args.speed_kmh <= 0.0 or any(distance <= 0.0 for distance in args.distances):
        raise ValueError("speed and distances must be positive")
    speed_mps = args.speed_kmh / 3.6
    results: dict[str, object] = {
        "speed_kmh": args.speed_kmh,
        "speed_mps": speed_mps,
        "accuracy_gates": {
            "tracking_rms_error_m_max": 0.1,
            "post_alignment_prediction_rms_error_m_max": 0.3,
            "solver_success_rate_min": 0.99,
            "ballistic_miss_rms_m_max": 0.05,
            "truth_impact_rms_m_max": 0.3,
            "post_alignment_pan_rms_error_rad_max": math.radians(1.0),
            "alignment_time_fraction_max": 0.75,
            "track_loss_count_max": 0,
            "simulated_hit_rate_min": 0.99,
        },
        "ranges": {},
    }
    overall_passed = True
    ranges = results["ranges"]
    assert isinstance(ranges, dict)
    for distance_m in args.distances:
        config = load_config(args.config)
        crossing_duration_s = 0.9 * distance_m / speed_mps
        config.simulation.duration_s = crossing_duration_s
        target = config.simulation.targets[0]
        config.simulation.targets = [
            target.model_copy(
                update={
                    "trajectory": "constant_velocity",
                    "initial_position_m": (distance_m, -0.45 * distance_m, 2.0),
                    "velocity_mps": (0.0, speed_mps, 0.0),
                    "acceleration_mps2": (0.0, 0.0, 0.0),
                    "speed_mps": speed_mps,
                }
            )
        ]
        visualizer = None
        if args.video_dir is not None or args.show:
            video_path = (
                args.video_dir / f"high-speed-{distance_m:g}m.mp4"
                if args.video_dir is not None
                else None
            )
            visualizer = SimulationVisualizer(
                video_path,
                args.show,
                args.playback_fps,
                f"200 km/h at {distance_m:g} m",
            )
        try:
            result = SimulationWorld(config, visualizer).run()
        finally:
            if visualizer is not None:
                visualizer.close()
        summary = result.summary
        failures: list[str] = []
        _maximum(failures, summary, "tracking_rms_error_m", 0.1)
        _maximum(failures, summary, "post_alignment_prediction_rms_error_m", 0.3)
        _minimum(failures, summary, "solver_success_rate", 0.99)
        _maximum(failures, summary, "ballistic_miss_rms_m", 0.05)
        _maximum(failures, summary, "truth_impact_rms_m", 0.3)
        _maximum(
            failures,
            summary,
            "post_alignment_pan_rms_error_rad",
            math.radians(1.0),
        )
        _maximum(failures, summary, "track_loss_count", 0.0)
        _minimum(failures, summary, "simulated_hit_rate", 0.99)
        if int(summary["simulated_shots"] or 0) < 1:
            failures.append("no simulated shot was authorized")
        alignment_time = summary["alignment_time_s"]
        if alignment_time is None or float(alignment_time) > crossing_duration_s * 0.75:
            failures.append("alignment was not reached within 75% of the visible flyby")
        passed = not failures
        overall_passed &= passed
        ranges[f"{distance_m:g}m"] = {
            "distance_m": distance_m,
            "duration_s": crossing_duration_s,
            "peak_angular_rate_radps": speed_mps / distance_m,
            "peak_angular_rate_degps": math.degrees(speed_mps / distance_m),
            "passed": passed,
            "failures": failures,
            "solution_method": result.solution.method if result.solution else None,
            **summary,
        }
    results["passed"] = overall_passed
    encoded = json.dumps(results, indent=2)
    print(encoded)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(encoded + "\n", encoding="utf-8")
    return 0 if overall_passed else 1


def _maximum(
    failures: list[str], summary: dict[str, float | int | None], key: str, limit: float
) -> None:
    value = float(summary[key] or 0.0)
    if value > limit:
        failures.append(f"{key}={value:.6g} exceeds {limit:.6g}")


def _minimum(
    failures: list[str], summary: dict[str, float | int | None], key: str, limit: float
) -> None:
    value = float(summary[key] or 0.0)
    if value < limit:
        failures.append(f"{key}={value:.6g} is below {limit:.6g}")


def main() -> None:
    """CLI entry point."""
    raise SystemExit(run(build_parser().parse_args()))


if __name__ == "__main__":
    main()
