from __future__ import annotations

import hashlib
import json
import shutil
from collections import Counter
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import cv2
import yaml

from tracker.rescue.annotations import AnnotationDocument
from tracker.rescue.dataset_audit import normalize_incident
from tracker.rescue.library import is_live_project
from tracker.rescue.media import FrameReader, file_sha256
from tracker.rescue.practice_training import practice_plan


def read_projects(paths: list[Path]) -> list[tuple[Path, AnnotationDocument]]:
    projects = [
        (path.resolve(), AnnotationDocument.model_validate_json(path.read_bytes()))
        for path in paths
    ]
    if not projects:
        raise ValueError("add annotation projects first")
    scope = set(projects[0][1].classes)
    sources: set[str] = set()
    groups: dict[str, str] = {}
    lineage: dict[str, str] = {}
    counts: Counter[str] = Counter()
    positives: Counter[str] = Counter()
    for path, doc in projects:
        if set(doc.classes) != scope:
            raise ValueError(f"{path.name}: all projects must use the same exhaustive class scope")
        if doc.source.sha256 in sources:
            raise ValueError("the same video appears twice; remove duplicate projects or revisions")
        sources.add(doc.source.sha256)
        incident = normalize_incident(doc.incident_id)
        if not incident or doc.split == "unassigned":
            raise ValueError(
                f"{path.name}: assign an incident and training / validation / test split"
            )
        if incident in groups and groups[incident] != doc.split:
            raise ValueError("one incident crosses dataset splits; keep its recordings together")
        groups[incident] = doc.split
        for digest in {doc.source.sha256, *doc.source_ancestors}:
            if digest in lineage and lineage[digest] != doc.split:
                raise ValueError("related clips cross dataset splits; keep their source together")
            lineage[digest] = doc.split
        reviewed = [frame for frame in doc.frames if frame.reviewed]
        if not reviewed:
            raise ValueError(f"{path.name}: no reviewed frames; review labels before exporting")
        counts[doc.split] += len(reviewed)
        if doc.split == "training":
            positives.update(obj.label for frame in reviewed for obj in frame.objects)
    if not counts["training"] or not counts["validation"]:
        raise ValueError("need reviewed training and validation projects from separate incidents")
    missing = scope - positives.keys()
    if missing:
        raise ValueError("no reviewed training examples for classes: " + ", ".join(sorted(missing)))
    return projects


def write_json(path: Path, payload: Any) -> None:
    with path.open("x", encoding="utf-8") as stream:
        json.dump(payload, stream, indent=2, allow_nan=False)
        stream.write("\n")


def export_dataset(
    paths: list[Path],
    output_root: Path,
    progress: Callable[[str], None] = lambda _: None,
    *,
    practice: bool = False,
    expected_project_hash: str | None = None,
) -> Path:
    if practice:
        if len(paths) != 1 or not is_live_project(paths[0]):
            raise ValueError("Quick training uses one live labeling project.")
        encoded_project = paths[0].read_bytes()
        if (
            expected_project_hash
            and hashlib.sha256(encoded_project).hexdigest() != expected_project_hash
        ):
            raise ValueError(
                "Your saved labels changed before preparation started. Click Train again."
            )
        projects = [(paths[0].resolve(), AnnotationDocument.model_validate_json(encoded_project))]
        plan = practice_plan(projects[0][1])
        names = list(plan.classes)
    else:
        projects = read_projects(paths)
        names = sorted(projects[0][1].classes)
    classes = {name: index for index, name in enumerate(names)}
    directory = (
        output_root.resolve()
        / f"rescue-dataset-{datetime.now(UTC):%Y%m%d-%H%M%S}-{uuid4().hex[:8]}"
    )
    directory.mkdir(parents=True, exist_ok=False)
    files: dict[str, str] = {}
    records: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()
    positives: dict[str, Counter[str]] = {split: Counter() for split in ("train", "val", "test")}
    split_names = {"training": "train", "validation": "val", "test": "test"}
    try:
        for number, (path, doc) in enumerate(projects):
            reader = FrameReader(Path(doc.source.path))
            try:
                if (
                    reader.source.sha256,
                    reader.source.width,
                    reader.source.height,
                    reader.source.frame_count,
                ) != (
                    doc.source.sha256,
                    doc.source.width,
                    doc.source.height,
                    doc.source.frame_count,
                ):
                    raise ValueError(f"source video no longer matches {path.name}")
                split = "train" if practice else split_names[doc.split]
                image_dir, label_dir = directory / "images" / split, directory / "labels" / split
                image_dir.mkdir(parents=True, exist_ok=True)
                label_dir.mkdir(parents=True, exist_ok=True)
                reviewed = sorted(
                    (frame for frame in doc.frames if frame.reviewed),
                    key=lambda frame: frame.frame_index,
                )
                for index, frame in enumerate(reviewed):
                    image = reader.read(frame.frame_index)
                    stem = f"{doc.source.sha256[:16]}_{frame.frame_index:08d}"
                    image_path, label_path = image_dir / f"{stem}.png", label_dir / f"{stem}.txt"
                    ok, encoded = cv2.imencode(".png", image)
                    if not ok:
                        raise ValueError("could not encode a reviewed frame")
                    with image_path.open("xb") as stream:
                        stream.write(encoded.tobytes())
                    lines = []
                    for obj in frame.objects:
                        x1, y1, x2, y2 = obj.bbox_xyxy
                        values = (
                            (x1 + x2) / (2 * doc.source.width),
                            (y1 + y2) / (2 * doc.source.height),
                            (x2 - x1) / doc.source.width,
                            (y2 - y1) / doc.source.height,
                        )
                        lines.append(
                            f"{classes[obj.label]} "
                            + " ".join(format(value, ".17g") for value in values)
                        )
                        positives[split][obj.label] += 1
                    with label_path.open("x", encoding="utf-8") as stream:
                        stream.write("\n".join(lines) + ("\n" if lines else ""))
                    for item in (image_path, label_path):
                        files[item.relative_to(directory).as_posix()] = file_sha256(item)
                    counts[split] += 1
                    if index % 20 == 0:
                        progress(
                            f"Exporting project {number + 1}/{len(projects)}: "
                            f"{index + 1}/{len(reviewed)} reviewed frames"
                        )
                snapshot = directory / f"project-{number:03d}.json"
                write_json(snapshot, doc.model_dump(mode="json"))
                files[snapshot.name] = file_sha256(snapshot)
                records.append(
                    {
                        "project": str(path),
                        "snapshot": snapshot.name,
                        "incident_id": doc.incident_id,
                        "video_sha256": doc.source.sha256,
                        "source_ancestors": doc.source_ancestors,
                        "split": split,
                        "reviewed_frames": len(reviewed),
                    }
                )
            finally:
                reader.close()
        config: dict[str, Any] = {
            "path": directory.as_posix(),
            "train": "images/train",
            "val": None if practice else "images/val",
            "names": names,
        }
        if counts["test"]:
            config["test"] = "images/test"
        with (directory / "data.yaml").open("x", encoding="utf-8") as stream:
            yaml.safe_dump(config, stream, sort_keys=False, allow_unicode=True)
        files["data.yaml"] = file_sha256(directory / "data.yaml")
        write_json(
            directory / "manifest.json",
            {
                "schema_version": 1,
                "status": "complete",
                "training_mode": "practice" if practice else "independent_validation",
                "independently_tested": False,
                "unused_tags_excluded": list(plan.unused) if practice else [],
                "classes": names,
                "frames": dict(counts),
                "objects": {split: dict(values) for split, values in positives.items()},
                "projects": records,
                "files": files,
                "warnings": [
                    "NOT INDEPENDENTLY TESTED. Practice data has no validation partition."
                    if practice
                    else "Validation footage is kept separate from teaching footage.",
                    "Human review and incident tags are operator assertions, "
                    "not independently verified.",
                    "No automatic rights clearance. Training success is not rescue readiness.",
                    "Keep test incidents untouched during model selection. "
                    "No actuation integration.",
                ],
            },
        )
    except Exception as exc:
        write_json(directory / "FAILED.json", {"error": str(exc), "status": "incomplete"})
        raise
    return directory / "data.yaml"


def verify_dataset(data: Path) -> dict[str, Any]:
    data = data.resolve()
    root = data.parent
    manifest: dict[str, Any] = json.loads((root / "manifest.json").read_bytes())
    if (
        data.name != "data.yaml"
        or manifest.get("schema_version") != 1
        or manifest.get("status") != "complete"
    ):
        raise ValueError("select a completed studio dataset export")
    files = manifest.get("files")
    mode = manifest.get("training_mode", "independent_validation")
    if mode not in {"practice", "independent_validation"}:
        raise ValueError("unsupported dataset training mode")
    practice = mode == "practice"
    if not isinstance(files, dict) or "data.yaml" not in files:
        raise ValueError("dataset manifest has no file checksums")
    for name, digest in files.items():
        target = (root / name).resolve()
        if not target.is_relative_to(root) or not target.is_file() or file_sha256(target) != digest:
            raise ValueError(f"dataset file changed or is missing: {name}")
    config = yaml.safe_load(data.read_text(encoding="utf-8"))
    expected: dict[str, Any] = {
        "path": root.as_posix(),
        "train": "images/train",
        "val": None if practice else "images/val",
        "names": manifest["classes"],
    }
    if manifest["frames"].get("test"):
        expected["test"] = "images/test"
    if config != expected:
        raise ValueError("dataset YAML differs from the bounded studio layout; re-export it")
    for kind, extension in (("images", ".png"), ("labels", ".txt")):
        actual = {
            path.relative_to(root).as_posix() for path in (root / kind).rglob("*") if path.is_file()
        }
        expected_files = {name for name in files if name.startswith(kind + "/")}
        if actual != expected_files or any(not name.endswith(extension) for name in actual):
            raise ValueError("dataset contains missing or unexpected images / labels; re-export it")
    if practice:
        records = manifest.get("projects", [])
        if len(records) != 1 or records[0].get("split") != "train":
            raise ValueError("practice data must contain a single teaching project")
        snapshot = root / records[0]["snapshot"]
        if records[0]["snapshot"] not in files:
            raise ValueError("practice project snapshot has no checksum")
        doc = AnnotationDocument.model_validate_json(snapshot.read_bytes())
        plan = practice_plan(doc)
        if (
            manifest["classes"] != list(plan.classes)
            or manifest["frames"] != {"train": plan.reviewed_frames}
            or manifest.get("unused_tags_excluded") != list(plan.unused)
            or any(
                name.startswith(("images/val/", "labels/val/", "images/test/", "labels/test/"))
                for name in files
            )
        ):
            raise ValueError("practice export does not match its saved labels")
    return manifest


def stage_training_data(
    data: Path,
    directory: Path,
    manifest: dict[str, Any],
    check_stop: Callable[[], None] = lambda: None,
) -> Path:
    directory.mkdir(parents=True, exist_ok=False)
    for name, digest in manifest["files"].items():
        check_stop()
        if not any(
            name.startswith(prefix)
            for prefix in ("images/train/", "images/val/", "labels/train/", "labels/val/")
        ):
            continue
        source, target = (data.parent / name).resolve(), (directory / name).resolve()
        if not source.is_relative_to(data.parent.resolve()) or not target.is_relative_to(
            directory.resolve()
        ):
            raise ValueError("dataset entry escapes the staged data directory")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        if file_sha256(target) != digest:
            raise ValueError("dataset changed while creating the isolated training copy")
    config = {
        "path": directory.resolve().as_posix(),
        "train": "images/train",
        "val": "images/train" if manifest.get("training_mode") == "practice" else "images/val",
        "names": manifest["classes"],
    }
    path = directory / "data.yaml"
    with path.open("x", encoding="utf-8") as stream:
        yaml.safe_dump(config, stream, sort_keys=False, allow_unicode=True)
    return path
