"""Fetch a small labeled FloodNet challenge subset, not its full 12.8 GB archive."""

from __future__ import annotations

import argparse
import hashlib
import json
import zlib
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from urllib.request import urlopen
from zipfile import BadZipFile, ZipFile

import cv2
import numpy as np

from tracker.rescue.floodnet_samples import select_floodnet_pairs
from tracker.rescue.range_archive import RangeArchive

REVISION = "b5ea0cb042b551ba85393b58dc1538c566e04ed5"
BASE = f"https://huggingface.co/datasets/torchgeo/floodnet/resolve/{REVISION}"
ARCHIVE_BYTES = 12_835_218_313


def extract_selected(archive: ZipFile, name: str, target: Path) -> dict[str, str | int]:
    info = archive.getinfo(name)
    if info.is_dir() or not 0 < info.file_size <= 20_000_000:
        raise ValueError("selected image/mask is empty or exceeds 20 MB")
    digest = hashlib.sha256()
    count = 0
    if target.exists():
        crc = 0
        with target.open("rb") as existing:
            while chunk := existing.read(1024 * 1024):
                count += len(chunk)
                if count > info.file_size:
                    raise ValueError("existing sample exceeds its expected file size")
                digest.update(chunk)
                crc = zlib.crc32(chunk, crc)
        if count != info.file_size or crc != info.CRC:
            raise ValueError(f"existing sample differs from archive; not overwritten: {target}")
        return {
            "archive_entry": name,
            "sha256": digest.hexdigest(),
            "size_bytes": count,
            "zip_crc32": f"{info.CRC:08x}",
        }
    with archive.open(info) as source, target.open("xb") as destination:
        while chunk := source.read(1024 * 1024):
            count += len(chunk)
            if count > info.file_size:
                raise ValueError("ZIP entry exceeds its declared size")
            digest.update(chunk)
            destination.write(chunk)
    if count != info.file_size:
        raise ValueError("ZIP entry is truncated")
    return {
        "archive_entry": name,
        "sha256": digest.hexdigest(),
        "size_bytes": count,
        "zip_crc32": f"{info.CRC:08x}",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("data/rescue-floodnet-starter"))
    parser.add_argument("--per-group", type=int, choices=range(1, 21), default=6)
    args = parser.parse_args()
    root = args.output.resolve()
    try:
        root.mkdir(parents=True, exist_ok=True)
        if (root / "provenance.json").exists():
            raise FileExistsError("subset already exists; choose another --output folder")
        with urlopen(f"{BASE}/README.md", timeout=30) as response:
            card = response.read(65_537)
        if len(card) > 65_536:
            raise ValueError("dataset card exceeds 64 KB")
        card_path = root / "SOURCE-README.md"
        if card_path.exists():
            if card_path.read_bytes() != card:
                raise ValueError("existing source card differs; not overwritten")
        else:
            with card_path.open("xb") as output:
                output.write(card)
        samples = []
        with (
            RangeArchive(f"{BASE}/floodnet.zip", ARCHIVE_BYTES) as remote,
            ZipFile(remote) as archive,
        ):
            pairs = select_floodnet_pairs(archive.namelist(), args.per_group)
            total = sum(
                archive.getinfo(path).file_size
                for _, image, mask in pairs
                for path in (image, mask)
            )
            if total > 180_000_000:
                raise ValueError("selected samples exceed 180 MB; reduce --per-group")
            for index, (group, image_entry, mask_entry) in enumerate(pairs, start=1):
                image_id = PurePosixPath(image_entry).stem
                folder = root / group
                folder.mkdir(exist_ok=True)
                image_path, mask_path = folder / f"{image_id}.jpg", folder / f"{image_id}_lab.png"
                print(f"Fetching pair {index}/{len(pairs)}: {group}/{image_id}", flush=True)
                image_asset = extract_selected(archive, image_entry, image_path)
                mask_asset = extract_selected(archive, mask_entry, mask_path)
                image = cv2.imread(
                    str(image_path), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION
                )
                mask = cv2.imread(str(mask_path), cv2.IMREAD_UNCHANGED)
                issues = []
                if image is None or mask is None or image.shape[:2] != mask.shape[:2]:
                    issues.append(
                        "Image/mask cannot be decoded or dimensions differ; no resizing applied."
                    )
                if (
                    mask is None
                    or mask.ndim != 2
                    or not set(np.unique(mask)).issubset(set(range(10)))
                ):
                    issues.append("Mask format needs review before interpreting class IDs.")
                samples.append(
                    {
                        "source_group": group,
                        "source_split": "Train/Labeled",
                        "incident_group": "Hurricane Harvey / related scene groups not verified",
                        "image": str(image_path.relative_to(root).as_posix()),
                        "mask": str(mask_path.relative_to(root).as_posix()),
                        "image_asset": image_asset,
                        "mask_asset": mask_asset,
                        "image_shape": list(image.shape) if image is not None else None,
                        "mask_shape": list(mask.shape) if mask is not None else None,
                        "mask_class_ids": (
                            [int(value) for value in np.unique(mask)]
                            if mask is not None and mask.ndim == 2
                            else None
                        ),
                        "status": (
                            "needs_alignment_review" if issues else "publisher_mask_unreviewed"
                        ),
                        "issues": issues,
                    }
                )
            fetched = remote.downloaded_bytes
        provenance = {
            "schema_version": 1,
            "created_utc": datetime.now(UTC).isoformat(),
            "publisher": "BinaLab FloodNet Challenge EARTHVISION2021, Track 1",
            "publisher_url": "https://github.com/BinaLab/FloodNet-Challenge-EARTHVISION2021",
            "download_mirror": "https://huggingface.co/datasets/torchgeo/floodnet",
            "mirror_revision": REVISION,
            "archive_url": f"{BASE}/floodnet.zip",
            "archive_size_bytes": ARCHIVE_BYTES,
            "archive_bytes_fetched": fetched,
            "archive_full_hash_verified": False,
            "mirror_card_sha256": hashlib.sha256(card).hexdigest(),
            "stated_license": "CDLA-Permissive-1.0",
            "license_url": "https://cdla.dev/permissive-1-0/",
            "citation": (
                "Rahnemoonfar et al. (2021), FloodNet: A High Resolution Aerial Imagery Dataset "
                "for Post Flood Scene Understanding, DOI 10.1109/ACCESS.2021.3090981."
            ),
            "samples": samples,
            "training_run": None,
            "limitations": [
                "These are still images with semantic masks, not videos or YOLO object boxes.",
                "Sampled labeled training groups only. This is the older challenge release, "
                "not the complete supervised v1.0 corpus.",
                "Individual extracted entries passed ZIP CRC checks and have SHA256 "
                "fingerprints. The complete remote archive was not downloaded or hash-verified.",
                "Publisher labels and incident groupings still need review. Do not treat "
                "adjacent views of one event as independent test incidents.",
                "No mask-to-YOLO conversion, model training, inference, hardware control "
                "or actuation has run.",
            ],
        }
        with (root / "provenance.json").open("x", encoding="utf-8") as output:
            json.dump(provenance, output, indent=2, allow_nan=False)
            output.write("\n")
    except (OSError, ValueError, BadZipFile, cv2.error) as exc:
        parser.error(str(exc))
    print(f"Saved {len(samples)} real aerial image/mask pairs to {root}")
    print(f"Fetched {fetched / 1_000_000:.1f} MB from the archive; no training has run.")
    problems = sum(bool(sample["issues"]) for sample in samples)
    if problems:
        print(f"{problems} pairs need alignment/format review; see provenance.json.")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
