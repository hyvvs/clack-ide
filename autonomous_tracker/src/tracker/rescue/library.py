from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from tracker.rescue.annotations import AnnotationDocument
from tracker.rescue.config import load_rescue_config
from tracker.rescue.media import file_sha256
from tracker.rescue.studio_state import position_path

VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v", ".mpeg", ".mpg"}


def is_live_project(path: Path) -> bool:
    """Generated revisions and truth exports are not editable library entries."""
    return not path.name.startswith(".") and not re.search(
        r"\.(?:backup|truth)-[0-9a-f]{8}\.json$", path.name, re.IGNORECASE
    )


@dataclass(frozen=True)
class ProjectInfo:
    path: Path
    classes: tuple[str, ...]
    reviewed: int
    drafts: int
    total: int
    sha256: str
    last_session_ns: int = 0


@dataclass(frozen=True)
class RunInfo:
    path: Path
    frames: int
    completed: bool


@dataclass
class LibraryItem:
    video: Path
    sha256: str
    collection: str
    projects: list[ProjectInfo] = field(default_factory=list)
    runs: list[RunInfo] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def title(self) -> str:
        return str(self.metadata.get("title", self.video.stem.replace("_", " ")))


@dataclass
class Library:
    items: list[LibraryItem]
    warnings: list[str]


def read_json(path: Path) -> Any:
    if path.stat().st_size > 32 * 1024 * 1024:
        raise ValueError(f"JSON file exceeds 32 MiB: {path.name}")
    return json.loads(path.read_text(encoding="utf-8"))


def discover_library(workspace: Path) -> Library:
    workspace = workspace.resolve()
    warnings: list[str] = []
    videos = {
        path.resolve()
        for path in (workspace / "data").rglob("*")
        if path.is_file()
        and path.suffix.lower() in VIDEO_EXTENSIONS
        and "projects" not in path.relative_to(workspace / "data").parts
    }
    candidates = set((workspace / "annotations").glob("*.json"))
    candidates.update((workspace / "annotations/corrections").glob("*/labels.json"))
    candidates.update((workspace / "data").glob("**/projects/*.json"))
    for root in (workspace / "annotations", workspace / "data"):
        candidates.update(root.glob("**/clips/clip-*/clip.json"))
    projects: dict[str, list[ProjectInfo]] = {}
    for path in sorted(candidates):
        if not is_live_project(path):
            continue
        try:
            document = AnnotationDocument.model_validate(read_json(path))
            source = Path(document.source.path)
            if not source.is_absolute():
                source = workspace / source
            if source.is_file():
                videos.add(source.resolve())
            else:
                warnings.append(f"Missing original video for {path.name}: {source}")
            projects.setdefault(document.source.sha256, []).append(
                ProjectInfo(
                    path.resolve(),
                    tuple(document.classes),
                    sum(f.reviewed for f in document.frames),
                    sum(not f.reviewed for f in document.frames),
                    document.source.frame_count,
                    document.source.sha256,
                    position_path(path).stat().st_mtime_ns if position_path(path).is_file() else 0,
                )
            )
        except (OSError, ValueError, TypeError) as exc:
            warnings.append(f"Cannot read project {path.name}: {exc}")
    runs: dict[str, list[RunInfo]] = {}
    run_paths = list((workspace / "diagnostics" / "rescue").glob("review-*/summary.json"))
    run_paths.extend((workspace / "diagnostics/rescue-corrections").glob("*/review-*/summary.json"))
    run_paths.extend(
        (workspace / "diagnostics" / "rescue-batches").glob(
            "batch-*/items/*/attempt-*/review-*/summary.json"
        )
    )
    for path in run_paths:
        try:
            summary = read_json(path)
            if summary.get("status") not in {
                "completed",
                "frame_limit_reached",
                "operator_stopped",
            }:
                continue
            digest, count = summary.get("source_video_sha256"), summary.get("frames_reviewed")
            if not isinstance(digest, str) or not isinstance(count, int) or count <= 0:
                continue
            if not (path.parent / "frames.jsonl").is_file():
                continue
            runs.setdefault(digest, []).append(
                RunInfo(path.parent.resolve(), count, summary["status"] == "completed")
            )
        except (OSError, ValueError, TypeError, AttributeError) as exc:
            warnings.append(f"Cannot read run {path.parent.name}: {exc}")
    items = []
    for video in sorted(videos):
        try:
            digest = file_sha256(video)
            metadata_path = video.with_suffix(video.suffix + ".source.json")
            metadata = read_json(metadata_path) if metadata_path.is_file() else {}
            if not isinstance(metadata, dict):
                raise ValueError("invalid source metadata")
            if metadata and metadata.get("sha256") != digest:
                warnings.append(f"Source record no longer matches {video.name}; attribution hidden")
                metadata = {}
            if metadata.get("annotation_copy"):
                continue
            collection = video.parent.name.removeprefix("rescue-").replace("-", " ")
            matching = sorted(
                projects.get(digest, []),
                key=lambda p: (-p.last_session_ns, -p.reviewed, str(p.path)),
            )
            matching_runs = sorted(
                runs.get(digest, []),
                key=lambda r: (r.completed, r.frames, r.path.name),
                reverse=True,
            )
            items.append(LibraryItem(video, digest, collection, matching, matching_runs, metadata))
        except (OSError, ValueError, TypeError) as exc:
            warnings.append(f"Cannot load {video.name}: {exc}")
    return Library(items, warnings)


def local_review_config(path: Path, workspace: Path) -> list[str]:
    config = load_rescue_config(path)
    for model in config.models:
        weights = Path(model.weights)
        if not weights.is_absolute():
            weights = workspace / weights
        if weights.suffix.lower() != ".pt" or not weights.is_file():
            raise ValueError(
                f"Local trusted .pt weights missing: {weights}. No download was started."
            )
    return sorted({name for model in config.models for name in model.classes})
