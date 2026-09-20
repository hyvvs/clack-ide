"""Download a pinned experimental fire/smoke model with a verified publisher hash."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from fetch_rescue_sample import fetch

COMMIT = "13017fe8af477c25f5298d168e2dfede4b000753"
MODEL_SHA256 = "b91633799ceb052c814b4f8b77a37efc9a40f002d528df97d74463585fa4f28f"
BASE = f"https://huggingface.co/rabahdev/fire-smoke-yolov8n/resolve/{COMMIT}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("models/rescue-fire-smoke"))
    args = parser.parse_args()
    directory = args.output
    directory.mkdir(parents=True, exist_ok=False)
    actual_hash = fetch(f"{BASE}/best.pt", directory / "best.pt", 15_000_000)
    if actual_hash != MODEL_SHA256:
        raise ValueError("downloaded model hash does not match the pinned publisher artifact")
    fetch(f"{BASE}/README.md", directory / "MODEL-CARD.md", 100_000)
    manifest = {
        "source": "https://huggingface.co/rabahdev/fire-smoke-yolov8n",
        "revision": COMMIT,
        "sha256": actual_hash,
        "publisher_license": "AGPL-3.0",
        "publisher_claimed_training_data": "D-Fire",
        "status": "experimental_external_model_not_independently_validated",
        "note": (
            "Publisher metrics are not project measurements. Source dataset image rights and "
            "Ultralytics licensing still apply; not cleared for proprietary deployment."
        ),
    }
    (directory / "provenance.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Downloaded {(directory / 'best.pt').resolve()}")
    print(f"SHA256 {actual_hash}")
    print("Experimental AGPL-3.0 model. Independent rescue validation remains outstanding.")


if __name__ == "__main__":
    main()
