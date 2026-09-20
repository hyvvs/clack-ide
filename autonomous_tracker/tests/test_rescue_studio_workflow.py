from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml
from test_rescue_training import make_project, make_run, read_doc

from tracker.rescue.annotations import AnnotationSession
from tracker.rescue.library import discover_library
from tracker.rescue.media import file_sha256
from tracker.rescue.studio_state import load_position, position_path, save_position
from tracker.rescue.training_data import export_dataset, verify_dataset


def test_resume_position_is_separate_from_training_labels(tmp_path: Path) -> None:
    path = make_project(tmp_path, "train", "training")
    doc = read_doc(path)
    original_hash = file_sha256(path)
    save_position(path, doc.source, 2, "fire")
    restored = load_position(path, doc.source)
    assert (restored.frame_index, restored.label) == (2, "fire")
    assert original_hash == file_sha256(path)
    with pytest.raises(ValueError):
        save_position(path, doc.source, 4, "fire")
    assert load_position(path, doc.source).frame_index == 2


@pytest.mark.parametrize(
    "payload",
    [
        "broken json",
        "{}",
        "[]",
        json.dumps({"video_sha256": "0" * 64, "frame_index": 2}),
    ],
)
def test_invalid_or_wrong_video_position_falls_back_safely(tmp_path: Path, payload: str) -> None:
    path = make_project(tmp_path, "train", "training")
    doc = read_doc(path)
    sidecar = position_path(path)
    sidecar.parent.mkdir()
    sidecar.write_text(payload)
    assert load_position(path, doc.source).frame_index == 0


def test_existing_tag_only_changes_selected_box_and_one_review_status(tmp_path: Path) -> None:
    path = make_project(tmp_path, "train", "training")
    doc = read_doc(path)
    doc.classes.append("smoke")
    doc.frames[0].suggestion_source = "source-provenance"
    session = AnnotationSession(doc, path)
    original = doc.model_copy(deep=True)
    session.apply_tag(0, " Smoke ", 0)
    assert session.frame(0).objects[0].label == "smoke"
    assert session.frame(0).objects[0].bbox_xyxy == original.frames[0].objects[0].bbox_xyxy
    assert session.frame(0).suggestion_source == "source-provenance"
    assert not session.frame(0).reviewed
    assert session.frame(2).reviewed
    assert session.undo()
    assert session.document == original


def test_create_and_apply_tag_is_one_undoable_change(tmp_path: Path) -> None:
    path = make_project(tmp_path, "train", "training")
    doc = read_doc(path)
    session = AnnotationSession(doc, path)
    original = doc.model_copy(deep=True)
    session.apply_tag(0, "  Dense Smoke  ", 0)
    assert session.document.classes == ["fire", "dense smoke"]
    assert session.frame(0).objects[0].label == "dense smoke"
    assert not any(frame.reviewed for frame in session.document.frames)
    assert session.undo() and session.document == original
    assert not session.undo()


@pytest.mark.parametrize("name,index", [("", 0), ("bad\ntag", 0), ("x" * 65, 0), ("smoke", 9)])
def test_invalid_tag_edit_cannot_mutate_project(tmp_path: Path, name: str, index: int) -> None:
    path = make_project(tmp_path, "train", "training")
    session = AnnotationSession(read_doc(path), path)
    original = session.document.model_copy(deep=True)
    with pytest.raises(ValueError):
        session.apply_tag(0, name, index)
    assert session.document == original
    assert not session.dirty


def test_custom_tag_exports_as_real_yolo_class_after_review(tmp_path: Path) -> None:
    paths = [
        make_project(tmp_path, "train", "training"),
        make_project(tmp_path, "val", "validation", 50),
    ]
    for path in paths:
        session = AnnotationSession(read_doc(path), path)
        session.apply_tag(0, "dense smoke", 0)
        for index in (0, 1, 2):
            session.replace_frame(index, session.frame(index).objects, reviewed=True)
        session.save()
    data = export_dataset(paths, tmp_path / "exports")
    config = yaml.safe_load(data.read_text())
    assert config["names"] == ["dense smoke", "fire"]
    assert verify_dataset(data)["frames"] == {"train": 3, "val": 3}
    labels = [p.read_text().split() for p in (data.parent / "labels/train").glob("*.txt")]
    assert {line[0] for line in labels if line} == {"0", "1"}
    assert sum(not line for line in labels) == 1


def test_library_pairs_original_projects_and_prefers_complete_runs(tmp_path: Path) -> None:
    videos = tmp_path / "data" / "clips"
    videos.mkdir(parents=True)
    original_project = make_project(videos, "train", "training")
    doc = read_doc(original_project)
    annotations = videos / "projects"
    annotations.mkdir()
    project = annotations / "train.json"
    project.write_bytes(original_project.read_bytes())
    save_position(project, doc.source, 2, "fire")
    runs = tmp_path / "diagnostics/rescue"
    runs.mkdir(parents=True)
    complete = make_run(runs / "review-old-complete", doc)
    partial = make_run(runs / "review-new-partial", doc)
    summary = json.loads((partial / "summary.json").read_text())
    summary.update(status="operator_stopped", frames_reviewed=2)
    (partial / "summary.json").write_text(json.dumps(summary))
    library = discover_library(tmp_path)
    assert not library.warnings and len(library.items) == 1
    assert library.items[0].projects[0].path == project
    assert library.items[0].runs[0].path == complete
    assert len(library.items[0].projects) == 1


def test_library_prefers_last_saved_session_even_with_fewer_reviewed_frames(tmp_path: Path) -> None:
    annotations = tmp_path / "annotations"
    annotations.mkdir()
    original = make_project(annotations, "train", "training")
    doc = read_doc(original)
    for frame in doc.frames:
        frame.reviewed = False
    active = annotations / "current-corrections.json"
    active.write_text(doc.model_dump_json())
    save_position(active, doc.source, 2, "fire")
    library = discover_library(tmp_path)
    assert library.items[0].projects[0].path == active
    assert library.items[0].projects[0].reviewed == 0
