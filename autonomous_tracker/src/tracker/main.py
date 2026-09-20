"""Select simulation or hardware runtime from one configuration."""

from __future__ import annotations

import argparse
from pathlib import Path

from tracker.cli import run_hardware, simulate
from tracker.config import load_config


def main() -> None:
    """Load mode and dispatch the corresponding command-line runtime."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    config = load_config(args.config)
    delegated = argparse.Namespace(config=args.config, max_frames=0, debug_video=None)
    if config.system.mode == "hardware":
        raise SystemExit(run_hardware.run(delegated))
    delegated = argparse.Namespace(
        config=args.config,
        scenario=None,
        duration=None,
        metrics_json=None,
        video=None,
        show=False,
        playback_fps=60.0,
    )
    raise SystemExit(simulate.run(delegated))


if __name__ == "__main__":
    main()
