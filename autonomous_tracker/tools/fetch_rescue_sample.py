"""Fetch a pinned public wildfire demonstration video and preserve its provenance."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

COMMIT = "9d99b0e71fd4cc930da053a41b79de1c58aabdf2"
BASE = f"https://raw.githubusercontent.com/pedbrgs/Fire-Detection/{COMMIT}"


def fetch(url: str, target: Path, maximum_bytes: int) -> str:
    if target.exists():
        raise FileExistsError(f"refusing to overwrite {target}")
    digest = hashlib.sha256()
    with urlopen(url, timeout=30) as response, target.open("xb") as stream:
        total = 0
        while chunk := response.read(1024 * 1024):
            total += len(chunk)
            if total > maximum_bytes:
                raise ValueError(f"download exceeds {maximum_bytes} bytes")
            stream.write(chunk)
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("data/rescue-sample"))
    args = parser.parse_args()
    directory = args.output
    directory.mkdir(parents=True, exist_ok=False)
    url = f"{BASE}/examples/wildfire.mp4"
    video_hash = fetch(url, directory / "wildfire.mp4", 20_000_000)
    license_hash = fetch(f"{BASE}/LICENSE", directory / "SOURCE-LICENSE.txt", 100_000)
    manifest = {
        "source_repository": "https://github.com/pedbrgs/Fire-Detection",
        "source_commit": COMMIT,
        "source_url": url,
        "video_sha256": video_hash,
        "repository_license_sha256": license_hash,
        "repository_license": "MIT",
        "media_rights_note": (
            "Repository license preserved. Separate original media rights are not established "
            "by this manifest; do not treat this demo as cleared commercial training data."
        ),
        "annotations": "none; accuracy cannot be measured from this demo alone",
        "purpose": "rescue observation viewer smoke test",
    }
    (directory / "provenance.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Downloaded {(directory / 'wildfire.mp4').resolve()}")
    print(f"SHA256 {video_hash}")


if __name__ == "__main__":
    main()
