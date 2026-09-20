from __future__ import annotations

import json
from pathlib import Path

import pytest

from tracker.rescue.annotations import AnnotationDocument, LabelFrame
from tracker.rescue.dataset_audit import audit_projects, normalize_incident, save_audit
from tracker.rescue.evaluation import TruthObject
from tracker.rescue.media import VideoIdentity


def write_project(
    path: Path, *, split: str = "test", incident: str = "incident-a", video_hash: str = "a" * 64
) -> Path:
    document = AnnotationDocument.model_validate(
        {
            "source": VideoIdentity(
                path="recording.avi",
                sha256=video_hash,
                width=100,
                height=100,
                frame_count=2,
                nominal_fps=10,
            ).model_dump(),
            "classes": ["person"],
            "incident_id": incident,
            "split": split,
            "frames": [
                LabelFrame(
                    frame_index=0,
                    objects=[TruthObject(label="person", bbox_xyxy=(10, 10, 20, 40))],
                    reviewed=True,
                ).model_dump(),
                LabelFrame(frame_index=1, objects=[], reviewed=True).model_dump(),
            ],
        }
    )
    path.write_text(document.model_dump_json(indent=2), encoding="utf-8")
    return path


def test_exact_source_in_different_splits_is_blocking(tmp_path: Path) -> None:
    train = write_project(tmp_path / "train.json", split="training")
    test = write_project(tmp_path / "test.json", split="test", incident="different-tag")
    result = audit_projects([train, test])
    assert result["status"] == "conflicts_found"
    assert any(issue["code"] == "source_crosses_splits" for issue in result["issues"])
    assert result["unique_video_hashes"] == 1


def test_normalized_incident_detects_transcode_tag_overlap(tmp_path: Path) -> None:
    train = write_project(tmp_path / "train.json", split="training", incident="Fire A")
    test = write_project(
        tmp_path / "test.json", split="validation", incident="  FIRE   a ", video_hash="b" * 64
    )
    result = audit_projects([train, test])
    assert result["status"] == "conflicts_found"
    assert [issue["code"] for issue in result["issues"]] == ["incident_crosses_splits"]
    assert normalize_incident("\uff26\uff49\uff52\uff45 A") == "fire a"


def test_unique_tagged_incidents_pass_known_checks_and_save_provenance(tmp_path: Path) -> None:
    train = write_project(tmp_path / "train.json", split="training")
    test = write_project(
        tmp_path / "test.json", split="test", incident="incident-b", video_hash="b" * 64
    )
    result = audit_projects([train, test, test])
    assert result["status"] == "no_known_overlap"
    assert result["projects_checked"] == 2
    assert result["projects"][0]["reviewed_negatives"] == 1
    assert len(result["projects"][0]["project_sha256"]) == 64
    path = save_audit(tmp_path / "results", result)
    assert json.loads(path.read_text()) == result
    assert save_audit(tmp_path / "results", result) != path


def test_duplicate_project_copies_are_not_silently_counted_as_independent(tmp_path: Path) -> None:
    first = write_project(tmp_path / "first.json")
    backup = write_project(tmp_path / "backup.json")
    result = audit_projects([first, backup])
    assert result["status"] == "needs_review"
    assert any(issue["code"] == "duplicate_source" for issue in result["issues"])


def test_missing_metadata_and_unreviewed_projects_cannot_pass(tmp_path: Path) -> None:
    path = write_project(tmp_path / "labels.json", split="unassigned", incident=" ")
    document = AnnotationDocument.model_validate_json(path.read_text())
    document.frames = []
    path.write_text(document.model_dump_json())
    result = audit_projects([path])
    assert result["status"] == "needs_review"
    assert {issue["code"] for issue in result["issues"]} == {
        "unassigned_split",
        "missing_incident",
        "no_reviewed_frames",
    }


def test_invalid_files_remain_visible_as_errors(tmp_path: Path) -> None:
    valid = write_project(tmp_path / "project.json")
    invalid = tmp_path / "invalid.json"
    invalid.write_text("not json")
    result = audit_projects([valid, invalid, tmp_path / "missing.json"])
    assert result["status"] == "conflicts_found"
    assert result["projects_checked"] == 1
    assert [issue["code"] for issue in result["issues"]] == ["invalid_project", "invalid_project"]
    with pytest.raises(ValueError, match="at least one"):
        audit_projects([])
