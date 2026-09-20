"""Data-integrity and saved-state helpers for the observation training workflow."""

from __future__ import annotations

import hashlib
import json
import os
from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

from pydantic import Field

from tracker.rescue.annotations import (
    AnnotationDocument,
    AnnotationSession,
    normalize_class_name,
)
from tracker.rescue.config import ReviewModel
from tracker.rescue.library import is_live_project
from tracker.rescue.media import file_sha256


def export_digest(document: AnnotationDocument) -> str:
    """Fingerprint only fields that affect the exported training examples and splits."""
    truth = document.to_truth().model_dump(mode="json")
    truth["label_scope"] = sorted(document.classes)
    payload = {
        "truth": truth,
        "incident_id": document.incident_id,
        "split": document.split,
        "frame_count": document.source.frame_count,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def export_issues(data: Path, paths: list[Path]) -> list[str]:
    """Cheap freshness check; full file integrity is verified separately by the worker."""
    manifest = json.loads((data.parent / "manifest.json").read_bytes())
    if data.name != "data.yaml" or manifest.get("status") != "complete":
        raise ValueError("Choose data.yaml from a completed Studio export.")
    records = manifest["projects"]
    if not isinstance(records, list) or not records:
        raise ValueError("Export has no project snapshots; re-export it.")
    selected = {path.resolve() for path in paths}
    exported = {Path(record["project"]).resolve() for record in records}
    issues = [] if selected == exported else ["Selected projects differ from this export."]
    for record in records:
        live = Path(record["project"])
        snapshot = (data.parent / record["snapshot"]).resolve()
        if not snapshot.is_relative_to(data.parent.resolve()):
            raise ValueError("Export snapshot escapes the dataset folder.")
        if manifest["files"].get(record["snapshot"]) != file_sha256(snapshot):
            raise ValueError("Export snapshot changed; re-export it.")
        try:
            current = AnnotationDocument.model_validate_json(live.read_bytes())
        except (ValueError, OSError):
            issues.append(f"{live.name}: original project is missing or invalid.")
            continue
        previous = AnnotationDocument.model_validate_json(snapshot.read_bytes())
        if export_digest(current) != export_digest(previous):
            issues.append(f"{live.name}: reviewed labels, tags or split changed after export.")
    return issues


def require_fresh_export(data: Path, paths: list[Path]) -> None:
    issues = export_issues(data, paths)
    if issues:
        raise ValueError(
            "STALE EXPORT. Check and export again before training.\n" + "\n".join(issues)
        )


@dataclass
class ScopeChange:
    session: AnnotationSession
    updated: AnnotationDocument


def plan_shared_tags(
    paths: list[Path], tags: list[str], current: AnnotationSession
) -> list[ScopeChange]:
    names = sorted({normalize_class_name(name) for name in tags})
    if not names:
        raise ValueError("Keep at least one dataset tag.")
    changes = []
    seen: set[str] = set()
    for path in dict.fromkeys(path.resolve() for path in paths):
        if not is_live_project(path):
            raise ValueError("Choose live projects, not backups or truth exports.")
        doc = AnnotationDocument.model_validate_json(path.read_bytes())
        if doc.source.sha256 in seen:
            raise ValueError("The same video appears twice. Remove its alternate project first.")
        seen.add(doc.source.sha256)
        session = (
            current if path == current.path.resolve() else AnnotationSession.open(path, doc.source)
        )
        used = {obj.label for frame in session.document.frames for obj in frame.objects}
        if used - set(names):
            raise ValueError(
                f"{path.name}: cannot remove tags with boxes: "
                + ", ".join(sorted(used - set(names)))
            )
        if set(session.document.classes) == set(names):
            continue
        updated = session.document.model_copy(deep=True)
        updated.classes = names.copy()
        if set(names) - set(session.document.classes):
            for frame in updated.frames:
                frame.reviewed = False
        changes.append(
            ScopeChange(session, AnnotationDocument.model_validate(updated.model_dump()))
        )
    return changes


def apply_shared_tags(changes: list[ScopeChange]) -> None:
    """Preflight every writer before changing anything, then save with per-file backups."""
    saved: list[str] = []
    with ExitStack() as stack:
        for change in sorted(changes, key=lambda item: str(item.session.path.resolve())):
            session = change.session
            lock = session.path.with_name(f".{session.path.name}.lock")
            try:
                stream = lock.open("x", encoding="utf-8")
            except FileExistsError as exc:
                raise ValueError(f"Project is being saved elsewhere: {session.path.name}") from exc
            stack.callback(lock.unlink, missing_ok=True)
            stack.enter_context(stream)
            if file_sha256(session.path) != session.disk_hash:
                raise ValueError(
                    f"{session.path.name} changed on disk. Reopen it before syncing tags."
                )
        try:
            for change in changes:
                change.session.replace_document(change.updated)
                change.session._save_locked()
                saved.append(str(change.session.path))
        except (ValueError, OSError) as exc:
            raise ValueError(
                f"Tag sync did not finish: {exc}. Already saved: {', '.join(saved) or 'none'}. "
                "Originals are retained as .backup JSON files; refresh before retrying."
            ) from exc


class TrainingState(ReviewModel):
    schema_version: int = Field(default=1, ge=1, le=1)
    projects: list[str] = Field(default_factory=list)
    dataset: str = ""
    weights: str = ""
    epochs: str = "30"
    image_size: str = "640"
    batch: str = "4"
    device: str = "cpu"
    training_result: str = ""
    validation_project: str = ""
    checks: list[str] = Field(default_factory=list)
    quick_result: str = ""
    quick_preview: str = ""
    quick_model_id: str = ""
    quick_preview_model_id: str = ""
    correction_model_id: str = ""
    correction_run: str = ""


def training_state_path(project: Path) -> Path:
    return project.parent / ".studio" / f"{project.name}.training.json"


def load_training_state(project: Path) -> TrainingState:
    path = training_state_path(project)
    if not path.exists():
        return TrainingState()
    if path.stat().st_size > 1024 * 1024:
        raise ValueError("Saved training workspace exceeds 1 MiB.")
    return TrainingState.model_validate_json(path.read_bytes())


def save_training_state(project: Path, state: TrainingState) -> None:
    path = training_state_path(project)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        with temporary.open("x", encoding="utf-8") as stream:
            stream.write(state.model_dump_json(indent=2) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def completed_training(path: Path) -> dict[str, Any]:
    payload: dict[str, Any] = json.loads(path.read_bytes())
    if payload.get("status") != "completed":
        raise ValueError("Choose result.json from a completed training run.")
    for key in ("best_weights", "review_config"):
        if not Path(payload[key]).is_file():
            raise ValueError(f"Training output is missing: {key}")
    return payload
