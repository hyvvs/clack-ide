from __future__ import annotations

import hashlib
import json
import unicodedata
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from tracker.rescue.annotations import AnnotationDocument


def normalize_incident(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def audit_projects(paths: list[Path]) -> dict[str, Any]:
    if not paths:
        raise ValueError("select at least one annotation project")
    records: list[dict[str, Any]] = []
    issues: list[dict[str, Any]] = []
    unique: set[Path] = set()

    def issue(code: str, severity: str, message: str, projects: list[str]) -> None:
        issues.append(
            {"code": code, "severity": severity, "message": message, "projects": projects}
        )

    for path in paths:
        path = path.resolve()
        if path in unique:
            continue
        unique.add(path)
        try:
            encoded = path.read_bytes()
            document = AnnotationDocument.model_validate_json(encoded)
        except (OSError, ValueError) as exc:
            issue("invalid_project", "error", str(exc), [str(path)])
            continue
        reviewed = [frame for frame in document.frames if frame.reviewed]
        record: dict[str, Any] = {
            "path": str(path),
            "project_sha256": hashlib.sha256(encoded).hexdigest(),
            "video_sha256": document.source.sha256,
            "source_ancestors": document.source_ancestors,
            "incident_id": document.incident_id,
            "normalized_incident_id": normalize_incident(document.incident_id),
            "split": document.split,
            "classes": sorted(document.classes),
            "source_frames": document.source.frame_count,
            "reviewed_frames": len(reviewed),
            "reviewed_negatives": sum(not frame.objects for frame in reviewed),
            "objects_per_class": dict(
                Counter(obj.label for frame in reviewed for obj in frame.objects)
            ),
        }
        records.append(record)
        if not record["normalized_incident_id"]:
            issue("missing_incident", "warning", "Assign an incident/recording group.", [str(path)])
        if document.split == "unassigned":
            issue("unassigned_split", "warning", "Assign a dataset split.", [str(path)])
        if not reviewed:
            issue("no_reviewed_frames", "warning", "No reviewed frames are available.", [str(path)])
        if reviewed and not record["reviewed_negatives"]:
            issue(
                "no_reviewed_negatives",
                "warning",
                "No explicit negative frames in this project.",
                [str(path)],
            )
    for key, code in (
        ("video_sha256", "source_crosses_splits"),
        ("normalized_incident_id", "incident_crosses_splits"),
    ):
        groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for record in records:
            if record[key]:
                groups[record[key]].append(record)
        for value, group in groups.items():
            splits = {record["split"] for record in group} - {"unassigned"}
            projects = [record["path"] for record in group]
            if len(splits) > 1:
                issue(
                    code,
                    "error",
                    f"{value} appears in splits: {', '.join(sorted(splits))}.",
                    projects,
                )
            elif key == "video_sha256" and len(group) > 1:
                issue(
                    "duplicate_source",
                    "warning",
                    "The same video appears in multiple project files; "
                    "avoid double-counting revisions or backups.",
                    projects,
                )
    lineage: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        for digest in {record["video_sha256"], *record["source_ancestors"]}:
            lineage[digest].append(record)
    for digest, group in lineage.items():
        if len(group) < 2 or not any(digest in row["source_ancestors"] for row in group):
            continue
        crosses = len({row["split"] for row in group} - {"unassigned"}) > 1
        issue(
            "clip_crosses_splits" if crosses else "related_clips",
            "error" if crosses else "warning",
            "Clips from one source must stay in one split; "
            "overlapping clips can double-count frames.",
            [row["path"] for row in group],
        )
    scopes = {tuple(record["classes"]) for record in records}
    if len(scopes) > 1:
        issue(
            "different_class_scopes",
            "warning",
            "Projects have different class scopes; do not "
            "pool their totals without a scoped evaluation protocol.",
            [record["path"] for record in records],
        )
    status = (
        "conflicts_found"
        if any(issue["severity"] == "error" for issue in issues)
        else "needs_review"
        if issues
        else "no_known_overlap"
    )
    return {
        "schema_version": 1,
        "created_utc": datetime.now(UTC).isoformat(),
        "status": status,
        "projects_checked": len(records),
        "unique_video_hashes": len({r["video_sha256"] for r in records}),
        "projects": records,
        "issues": issues,
        "limitations": [
            "Checks exact source hashes, recorded clip ancestry and normalized incident tags.",
            "Transcodes, cropped copies and mislabeled incident IDs can evade this check.",
            "Source hashes are recorded metadata; this audit does not reopen the videos.",
            "No-known-overlap is not proof of independence, dataset rights or readiness.",
        ],
    }


def save_audit(output_root: Path, result: dict[str, Any]) -> Path:
    output_root.mkdir(parents=True, exist_ok=True)
    path = output_root / f"dataset-audit-{datetime.now(UTC):%Y%m%d-%H%M%S}-{uuid4().hex[:8]}.json"
    with path.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, indent=2, allow_nan=False)
        stream.write("\n")
    return path
