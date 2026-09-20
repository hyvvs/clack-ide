"""Run the four primary automated simulation scenarios."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from tracker.config import load_config
from tracker.simulation.world import SimulationWorld


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("configs/simulation.yaml"))
    parser.add_argument("--duration", type=float, default=4.0)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    summaries: dict[str, object] = {}
    for name in ("stationary", "constant_velocity", "accelerating", "circular"):
        config = load_config(args.config)
        config.simulation.duration_s = args.duration
        target = config.simulation.targets[0]
        updates: dict[str, object] = {"trajectory": name}
        if name in {"constant_velocity", "accelerating"}:
            updates["velocity_mps"] = (0.0, 0.5, 0.0)
        if name == "circular":
            updates["radius_m"] = 0.75
            updates["speed_mps"] = 0.5
        if name == "accelerating" and not any(target.acceleration_mps2):
            updates["acceleration_mps2"] = (0.0, 0.1, 0.0)
        config.simulation.targets = [target.model_copy(update=updates)]
        result = SimulationWorld(config).run()
        summaries[name] = {
            "solution_method": result.solution.method if result.solution else None,
            **result.summary,
        }
    encoded = json.dumps(summaries, indent=2)
    print(encoded)
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
