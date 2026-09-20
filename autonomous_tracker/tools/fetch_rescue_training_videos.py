"""Fetch six real FURG videos and import publisher flame boxes as unreviewed drafts."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from urllib.request import urlopen

import cv2

from tracker.rescue.annotations import AnnotationSession
from tracker.rescue.furg_import import import_furg_annotations
from tracker.rescue.media import FrameReader

REVISION = "6aff09d7baa27425f31d1df685284c26cbffe7af"
REPOSITORY = "https://github.com/steffensbola/furg-fire-dataset"
BASE = f"https://raw.githubusercontent.com/steffensbola/furg-fire-dataset/{REVISION}"
ASSETS = {
    "LICENSE": (6555, "670154e3538863b2d9891fd5483160fbdfc89164"),
    "README.md": (2884, "c8be23738eea8f4d8d65f74e1502fef72cdd0734"),
    "Car1.mp4": (18200338, "06824f6af39430c871d25bef4d041e6aaac4fd96"),
    "Car1.xml": (70357, "69249a2216e55347b38f774b830dc6ff8f0df13d"),
    "barbecue.mp4": (31823966, "5f8c93079d785b2fcbb9e26a35bd896f23510a7a"),
    "barbecue.xml": (99063, "8f7df3459e3a3f2fb3332d3dccb858560d25c3ae"),
    "hand_held_batteries_night.mp4": (24185419, "47fbecf894adb4b099cb2652abd939c2ef74b329"),
    "hand_held_batteries_night.xml": (66716, "32b9cf7ca85645236172b1a15e050745a2506c1f"),
    "hand_held_camera_wildfire.mp4": (17237464, "402e9fa4b714b919f8615becd3e3653dedf4c656"),
    "hand_held_camera_wildfire.xml": (84375, "bba642bef2095e9937467e71a12ac07b1f0d1ae8"),
    "house2.mp4": (8920519, "4f316379f37cc1a2b8542dc3caebdad8850ffb30"),
    "house2.xml": (96786, "f7498256ec089c8589e454eb903b230b9803f9d0"),
    "non_fire_patrolbot_onboard.mp4": (10668507, "2ee83a60bc8d04bce5c62059b7d78508508fc716"),
    "non_fire_patrolbot_onboard.xml": (27207, "9bd2b9c9f8539eb796ae8d80a8af4e42322f3826"),
}


def fetch_asset(root: Path, name: str) -> dict[str, str | int]:
    size, expected_git_hash = ASSETS[name]
    target = root / name
    partial = root / f"{name}.part"
    git_hash = hashlib.sha1(f"blob {size}\0".encode("ascii"))
    sha256 = hashlib.sha256()
    url = f"{BASE}/{name}"
    if target.exists():
        stream = target.open("rb")
        output = None
    else:
        if partial.exists():
            raise FileExistsError(
                f"incomplete download exists: {partial}; use a new --output folder"
            )
        stream = urlopen(url, timeout=30)
        output = partial.open("xb")
    count = 0
    try:
        with stream:
            while chunk := stream.read(1024 * 1024):
                count += len(chunk)
                if count > size:
                    raise ValueError(f"{name} exceeds its pinned file size")
                git_hash.update(chunk)
                sha256.update(chunk)
                if output is not None:
                    output.write(chunk)
    finally:
        if output is not None:
            output.close()
    if count != size or git_hash.hexdigest() != expected_git_hash:
        raise ValueError(
            f"{name} does not match the pinned repository object; retained for inspection"
        )
    if output is not None:
        partial.rename(target)
    return {
        "path": name,
        "url": url,
        "size_bytes": size,
        "git_blob_sha1": expected_git_hash,
        "sha256": sha256.hexdigest(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("data/rescue-furg-starter"))
    args = parser.parse_args()
    root = args.output.resolve()
    root.mkdir(parents=True, exist_ok=True)
    if (root / "provenance.json").exists():
        parser.error("starter set already exists; use its projects or choose a new --output folder")
    assets, projects = [], []
    try:
        for name in ASSETS:
            print(f"Fetching/verifying {name}", flush=True)
            assets.append(fetch_asset(root, name))
        (root / "projects").mkdir(exist_ok=True)
        for name in ASSETS:
            if not name.endswith(".mp4"):
                continue
            record: dict[str, object] = {"video": name, "xml": f"{Path(name).stem}.xml"}
            projects.append(record)
            reader = None
            try:
                reader = FrameReader(root / name)
                imported = import_furg_annotations(
                    (root / str(record["xml"])).read_bytes(), reader.source
                )
                document = imported.document
                for index in sorted(
                    {0, reader.source.frame_count - 1, reader.source.frame_count // 2}
                ):
                    reader.read(index)
                project = root / "projects" / f"{Path(name).stem}.json"
                if project.exists():
                    raise FileExistsError(f"refusing to overwrite annotation project {project}")
                AnnotationSession(document, project).save()
                record.update(
                    status="imported_draft",
                    project=str(project.relative_to(root).as_posix()),
                    source=reader.source.model_dump(),
                    labeled_frames=len(document.frames),
                    boxes=sum(len(frame.objects) for frame in document.frames),
                    explicit_negative_frames=sum(not frame.objects for frame in document.frames),
                    reviewed_frames=0,
                    import_warnings=imported.warnings,
                )
            except (OSError, ValueError, cv2.error) as exc:
                record.update(status="needs_import_review", error=str(exc))
            finally:
                if reader is not None:
                    reader.close()
        manifest = {
            "schema_version": 1,
            "created_utc": datetime.now(UTC).isoformat(),
            "source_repository": REPOSITORY,
            "source_revision": REVISION,
            "publisher_stated_license": "CC0-1.0; original LICENSE retained",
            "citation": (
                "Steffens, Rodrigues and da Costa Botelho (2015), An Unconstrained Dataset "
                "for Non-Stationary Video Based Fire Detection. Further citations in original "
                "README.md."
            ),
            "purpose": "local rescue flame-detection dataset preparation; not actuation",
            "assets": assets,
            "clips": projects,
            "trained_model": None,
            "limitations": [
                "Imported publisher rectangles are drafts, not independently reviewed "
                "ground truth.",
                "Class scope is visible fire/flame only; no smoke, person or rescue-status labels.",
                "No invented tracking IDs. Frame numbers are used directly, not resampled "
                "from the XML's rounded FPS.",
                "Split and incident tags are unassigned pending related-recording review. "
                "Do not randomly split adjacent frames.",
                "Missing XML frames are unlabeled, not negative. Explicit empty records "
                "remain unreviewed negatives.",
                "Publisher license retained, but third-party media rights and suitability "
                "for a proprietary deployment have not been independently cleared.",
                "No training or inference has run. Keep test incidents out of training and tuning.",
            ],
        }
        with (root / "provenance.json").open("x", encoding="utf-8") as output:
            json.dump(manifest, output, indent=2, allow_nan=False)
            output.write("\n")
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    print(f"Downloaded {len(projects)} real videos to {root}")
    print(f"Imported {sum(p['status'] == 'imported_draft' for p in projects)} draft projects")
    print("No training has run. Review source boxes and assign incident-level splits first.")
    print(f"Provenance: {root / 'provenance.json'}")
    if any(project["status"] != "imported_draft" for project in projects):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
