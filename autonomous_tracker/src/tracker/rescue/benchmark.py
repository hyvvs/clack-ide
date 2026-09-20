from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from pydantic import Field, model_validator

from tracker.rescue.annotations import AnnotationDocument
from tracker.rescue.benchmark_report import render_benchmark_report
from tracker.rescue.config import ReviewModel
from tracker.rescue.dataset_audit import audit_projects, normalize_incident
from tracker.rescue.evaluation import Counts
from tracker.rescue.scoring import save_evaluation, score_saved_run


class BenchmarkEntry(ReviewModel):
    name: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,79}$")
    project: Path
    run: Path


class BenchmarkManifest(ReviewModel):
    schema_version: int = Field(default=1, ge=1, le=1)
    name: str = Field(min_length=1, max_length=120)
    split: Literal["validation", "test"]
    iou_threshold: float = Field(default=0.5, gt=0, le=1)
    entries: list[BenchmarkEntry] = Field(min_length=1)
    audit_projects: list[Path] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_entries(self) -> BenchmarkManifest:
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("benchmark name cannot be blank")
        names = [entry.name for entry in self.entries]
        if len(set(names)) != len(names):
            raise ValueError("benchmark entry names must be unique")
        return self

    def resolved(self, directory: Path) -> BenchmarkManifest:
        payload = self.model_dump()
        payload["entries"] = [
            {
                "name": entry.name,
                "project": (directory / entry.project).resolve(),
                "run": (directory / entry.run).resolve(),
            }
            for entry in self.entries
        ]
        payload["audit_projects"] = [(directory / path).resolve() for path in self.audit_projects]
        resolved = BenchmarkManifest.model_validate(payload)
        for field in ("project", "run"):
            paths = [getattr(entry, field) for entry in resolved.entries]
            if len(set(paths)) != len(paths):
                raise ValueError(f"benchmark entries must use distinct {field} paths")
        return resolved


def _write_json(path: Path, payload: Any) -> None:
    with path.open("x", encoding="utf-8") as stream:
        json.dump(payload, stream, indent=2, allow_nan=False)
        stream.write("\n")


def _preflight(manifest: BenchmarkManifest, audit: dict[str, Any]) -> list[dict[str, Any]]:
    errors = [issue.copy() for issue in audit["issues"] if issue["severity"] == "error"]
    for issue in audit["issues"]:
        if issue["code"] in {"missing_incident", "unassigned_split"}:
            errors.append({**issue, "severity": "error"})
    records = {record["path"]: record for record in audit["projects"]}
    scored = [
        records[str(entry.project)] for entry in manifest.entries if str(entry.project) in records
    ]

    def error(code: str, message: str, projects: list[str]) -> None:
        errors.append({"code": code, "severity": "error", "message": message, "projects": projects})

    for record in scored:
        if record["split"] != manifest.split:
            error(
                "wrong_split", f"Scored projects must use split {manifest.split}.", [record["path"]]
            )
        if not record["reviewed_frames"]:
            error("no_reviewed_frames", "Scored projects need reviewed frames.", [record["path"]])
    if len({tuple(record["classes"]) for record in scored}) > 1:
        error(
            "scored_scopes_differ",
            "Scored projects must share one class scope.",
            [r["path"] for r in scored],
        )
    if len({record["video_sha256"] for record in scored}) != len(scored):
        error(
            "duplicate_scored_video",
            "A video can only contribute once to a benchmark.",
            [r["path"] for r in scored],
        )
    return errors


def _pooled(results: list[dict[str, Any]], scope: list[str]) -> dict[str, Any]:
    per_class: dict[str, Counts] = {label: Counts() for label in sorted(scope)}
    for result in results:
        for label, values in result["evaluation"]["per_class"].items():
            counts = per_class[label]
            counts.tp += values["true_positives"]
            counts.fp += values["false_positives"]
            counts.fn += values["false_negatives"]
    overall = Counts(
        sum(counts.tp for counts in per_class.values()),
        sum(counts.fp for counts in per_class.values()),
        sum(counts.fn for counts in per_class.values()),
    )
    tracked_matches = sum(result["evaluation"]["tracked_matches"] for result in results)
    return {
        "clips": len(results),
        "scored_frames": sum(result["coverage"]["scored_frames"] for result in results),
        "reviewed_negative_frames": sum(
            result["false_positives"]["reviewed_negative_frames"] for result in results
        ),
        "negative_frames_with_false_positives": sum(
            result["false_positives"]["negative_frames_with_false_positives"] for result in results
        ),
        "overall": overall.summary(),
        "per_class": {label: counts.summary() for label, counts in per_class.items()},
        "tracked_matches": tracked_matches,
        "identity_switches_within_clips": (
            sum(result["evaluation"]["identity_switches"] or 0 for result in results)
            if tracked_matches
            else None
        ),
    }


def _aggregate_results(results: list[dict[str, Any]], scope: list[str]) -> dict[str, Any]:
    if not results or any(
        not result["coverage"]["complete_for_reviewed_frames"] for result in results
    ):
        raise ValueError("aggregation requires complete predictions for every reviewed frame")
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for result in results:
        groups[normalize_incident(result["incident_id"])].append(result)
    incidents = [
        {"incident_id": incident, "entries": [r["name"] for r in group], **_pooled(group, scope)}
        for incident, group in sorted(groups.items())
    ]
    macro: dict[str, Any] = {"incidents": len(incidents)}
    for metric in ("precision", "recall"):
        values = [row["overall"][metric] for row in incidents if row["overall"][metric] is not None]
        macro[metric] = sum(values) / len(values) if values else None
        macro[f"{metric}_defined_incidents"] = len(values)
    return {
        "pooled": _pooled(results, scope),
        "per_incident": incidents,
        "macro_incident": macro,
        "note": (
            "Pooled ratios use summed box counts. Macro averages give equal weight to each "
            "incident with a defined ratio; undefined ratios are excluded and counted. "
            "IDs are never compared across clips."
        ),
    }


def run_benchmark(manifest_path: Path, output_root: Path) -> tuple[Path, dict[str, Any]]:
    manifest_path = manifest_path.resolve()
    encoded_manifest = manifest_path.read_bytes()
    manifest = BenchmarkManifest.model_validate_json(encoded_manifest).resolved(
        manifest_path.parent
    )
    audit = audit_projects([entry.project for entry in manifest.entries] + manifest.audit_projects)
    errors = _preflight(manifest, audit)
    snapshots: dict[Path, bytes] = {}
    documents: dict[Path, AnnotationDocument] = {}
    for record in audit["projects"]:
        path = Path(record["path"])
        try:
            encoded = path.read_bytes()
            if hashlib.sha256(encoded).hexdigest() != record["project_sha256"]:
                raise ValueError("Project changed during preflight; rerun after saving.")
            documents[path] = AnnotationDocument.model_validate_json(encoded)
            snapshots[path] = encoded
        except (OSError, ValueError) as exc:
            errors.append(
                {
                    "code": "project_changed",
                    "severity": "error",
                    "message": str(exc),
                    "projects": [str(path)],
                }
            )
    warnings = [issue.copy() for issue in audit["issues"] if issue["severity"] == "warning"]
    if not any(record["split"] == "training" for record in audit["projects"]):
        warnings.append(
            {
                "code": "training_projects_not_audited",
                "severity": "warning",
                "message": "No training projects were supplied. Training overlap was not checked.",
                "projects": [],
            }
        )

    directory = (
        output_root.resolve() / f"benchmark-{datetime.now(UTC):%Y%m%d-%H%M%S}-{uuid4().hex[:8]}"
    )
    directory.mkdir(parents=True, exist_ok=False)
    with (directory / "manifest.json").open("xb") as stream:
        stream.write(encoded_manifest)
    _write_json(directory / "protocol.json", manifest.model_dump(mode="json"))
    _write_json(directory / "dataset-audit.json", audit)
    snapshot_index = []
    (directory / "projects").mkdir()
    for index, (path, encoded) in enumerate(snapshots.items(), start=1):
        relative = f"projects/{index:04d}.json"
        with (directory / relative).open("xb") as stream:
            stream.write(encoded)
        snapshot_index.append(
            {
                "source_path": str(path),
                "snapshot": relative,
                "sha256": hashlib.sha256(encoded).hexdigest(),
            }
        )

    entries: list[dict[str, Any]] = []
    settings_fingerprints: set[str] = set()
    for index, entry in enumerate(manifest.entries, start=1):
        row: dict[str, Any] = {
            "name": entry.name,
            "project": str(entry.project),
            "run": str(entry.run),
            "status": "not_scored",
        }
        entries.append(row)
        if errors:
            continue
        document = documents[entry.project]
        try:
            result = score_saved_run(entry.run, document, manifest.iou_threshold)
            settings_json = json.dumps(result["model_settings"], sort_keys=True, allow_nan=False)
            if not result["model_settings"]:
                raise ValueError("Run has empty model settings; its candidate cannot be compared.")
            settings_hash = hashlib.sha256(settings_json.encode("utf-8")).hexdigest()
        except (OSError, ValueError) as exc:
            row.update(status="failed", error=str(exc))
            continue
        settings_fingerprints.add(settings_hash)
        evidence = save_evaluation(directory / "clips" / f"{index:04d}", document, result)
        row.update(
            {
                key: value
                for key, value in result.items()
                if key not in {"per_frame", "unscored_reviewed_frames"}
            }
        )
        row.update(
            status="complete" if result["coverage"]["complete_for_reviewed_frames"] else "partial",
            evidence=str((evidence / "summary.json").relative_to(directory).as_posix()),
            model_settings_sha256=settings_hash,
        )

    all_complete = all(row["status"] == "complete" for row in entries)
    compatible = len(settings_fingerprints) == 1
    status = (
        "blocked"
        if errors
        else "incomplete"
        if not all_complete
        else "incompatible_runs"
        if not compatible
        else "completed"
    )
    if len(settings_fingerprints) > 1:
        errors.append(
            {
                "code": "model_settings_differ",
                "severity": "error",
                "message": "Run model settings differ. Do not pool different candidates.",
                "projects": [],
            }
        )
    scope = sorted(documents[manifest.entries[0].project].classes) if not errors else []
    summary: dict[str, Any] = {
        "schema_version": 1,
        "created_utc": datetime.now(UTC).isoformat(),
        "name": manifest.name,
        "status": status,
        "manifest_path": str(manifest_path),
        "manifest_sha256": hashlib.sha256(encoded_manifest).hexdigest(),
        "split": manifest.split,
        "iou_threshold": manifest.iou_threshold,
        "class_scope": scope,
        "entries": entries,
        "project_snapshots": snapshot_index,
        "errors": errors,
        "warnings": warnings,
        "aggregate": _aggregate_results(entries, scope) if status == "completed" else None,
        "limitations": [
            "Completed means scoring finished, not acceptable accuracy or operational readiness.",
            "Only explicitly reviewed frames and the declared classes are scored. Drafts and "
            "other classes are excluded; reviewed labels must be exhaustive.",
            "Overlap checks cover only supplied project hashes and incident tags. Transcodes "
            "and incorrect tags can evade them; pretrained model training provenance is not "
            "established.",
            "Matching model settings are recorded metadata, not proof that identical weight "
            "files, libraries or hardware were used.",
            "Box precision/recall at one IoU is not mAP, incident detection rate, independent "
            "alarm rate or tracking certification.",
            "Timing percentiles remain per clip. They are not averaged into a global "
            "percentile and are not a real-time guarantee.",
            "Use validation incidents for tuning. Repeated tuning against final test results "
            "invalidates their holdout role.",
        ],
    }
    with (directory / "report.md").open("x", encoding="utf-8") as stream:
        stream.write(render_benchmark_report(summary))
    _write_json(directory / "summary.json", summary)
    return directory, summary
