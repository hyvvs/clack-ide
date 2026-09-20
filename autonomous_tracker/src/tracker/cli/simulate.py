"""Run deterministic simulation scenarios and print metrics."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from tracker.config import TargetSimulationConfig, load_config
from tracker.simulation.visualizer import SimulationVisualizer
from tracker.simulation.world import SimulationWorld
from tracker.telemetry.logger import JSONLLogger


def build_parser() -> argparse.ArgumentParser:
    """Build the simulation CLI parser."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("configs/simulation.yaml"))
    parser.add_argument(
        "--scenario",
        choices=[
            "stationary",
            "constant_velocity",
            "accelerating",
            "circular",
            "sinusoidal",
            "random_waypoint",
        ],
    )
    parser.add_argument("--duration", type=float)
    parser.add_argument("--metrics-json", type=Path)
    parser.add_argument("--video", type=Path, help="write the animated simulation to MP4")
    parser.add_argument("--show", action="store_true", help="show an animated OpenCV window")
    parser.add_argument(
        "--playback-fps",
        type=float,
        default=60.0,
        help="window and output video frame rate",
    )
    return parser


def run(args: argparse.Namespace) -> int:
    """Load configuration, run the world, and emit one metrics summary."""
    config = load_config(args.config)
    if config.system.mode != "simulation":
        raise ValueError("simulation CLI requires system.mode=simulation")
    if args.duration is not None:
        if args.duration <= 0.0:
            raise ValueError("duration must be positive")
        config.simulation.duration_s = args.duration
    if args.scenario is not None:
        original = (
            config.simulation.targets[0] if config.simulation.targets else TargetSimulationConfig()
        )
        config.simulation.targets = [original.model_copy(update={"trajectory": args.scenario})]
    video_path = getattr(args, "video", None)
    show = bool(getattr(args, "show", False))
    playback_fps = float(getattr(args, "playback_fps", 60.0))
    visualizer = (
        SimulationVisualizer(video_path, show, playback_fps)
        if video_path is not None or show
        else None
    )
    try:
        result = SimulationWorld(config, visualizer).run()
    finally:
        if visualizer is not None:
            visualizer.close()
    payload = {
        "final_state": result.final_state.value,
        "selected_track_id": result.selected_track_id,
        "solution_method": result.solution.method if result.solution else None,
        **result.summary,
    }
    encoded = json.dumps(payload, indent=2)
    print(encoded)
    if args.metrics_json is not None:
        args.metrics_json.parent.mkdir(parents=True, exist_ok=True)
        args.metrics_json.write_text(encoded + "\n", encoding="utf-8")
    if config.logging.enabled:
        logger = JSONLLogger(config.logging.path, "simulation")
        logger.log("simulation_summary", payload)
    return 0


def main() -> None:
    """CLI entry point."""
    raise SystemExit(run(build_parser().parse_args()))


if __name__ == "__main__":
    main()
