from __future__ import annotations

import json
from pathlib import Path
from threading import Event

import numpy as np
import pytest
from test_rescue_training import make_project

from tracker.rescue.annotations import AnnotationDocument, AnnotationSession, BoxLink, LabelFrame
from tracker.rescue.clip_export import export_clip
from tracker.rescue.dataset_audit import audit_projects
from tracker.rescue.library import discover_library
from tracker.rescue.media import FrameReader, file_sha256
from tracker.rescue.project_tools import box_occurrences, bulk_review, frame_range, timestamp
from tracker.rescue.training_data import read_projects


def document(tmp_path: Path) -> AnnotationDocument:
    path = make_project(tmp_path, "train", "training")
    return AnnotationDocument.model_validate_json(path.read_bytes())


def test_bulk_review_is_explicit_preserves_boxes_and_undo(tmp_path: Path) -> None:
    doc = document(tmp_path)
    doc.frames = [doc.frames[0], LabelFrame(frame_index=3, objects=[])]
    doc.frames[0].reviewed = False
    obj = doc.frames[0].objects[0]
    doc.frames[0].box_links[0] = BoxLink(track_key="a" * 32, generated=obj, origin="copied")
    original = doc.model_dump_json()
    updated, changes = bulk_review(doc, 0, 3, reviewed=True)
    assert changes.changed == 1 and changes.empty_excluded == 3
    assert updated.frames[0].objects == doc.frames[0].objects
    assert updated.frames[0].box_links[0].generated is None
    assert doc.model_dump_json() == original
    assert len(updated.to_truth().frames) == 1
    session = AnnotationSession(doc, tmp_path / "draft.json")
    session.replace_document(updated)
    assert session.undo() and session.document == doc
    negatives, counts = bulk_review(doc, 0, 3, reviewed=True, include_empty=True)
    assert counts.changed == 4 and counts.negatives == 3
    assert len(negatives.to_truth().frames) == 4
    drafts, counts = bulk_review(negatives, 1, 2, reviewed=False)
    assert counts.changed == 2
    assert [frame.frame_index for frame in drafts.frames if frame.reviewed] == [0, 3]


def test_bulk_review_never_approves_unresolved_tracks(tmp_path: Path) -> None:
    doc = document(tmp_path)
    doc.frames[0].reviewed = False
    doc.frames[0].box_links[0] = BoxLink(track_key="b" * 32, needs_attention="Lost object")
    updated, changes = bulk_review(doc, 0, 3, reviewed=True, include_empty=True)
    assert changes.attention_blocked == 1
    assert not updated.frames[0].reviewed
    assert updated.frames[0].box_links[0].needs_attention == "Lost object"


@pytest.mark.parametrize("start,end", [(-1, 2), (3, 2), (0, 4)])
def test_range_validation(tmp_path: Path, start: int, end: int) -> None:
    doc = document(tmp_path)
    with pytest.raises(ValueError, match="inclusive"):
        bulk_review(doc, start, end, reviewed=True)
    with pytest.raises(ValueError):
        export_clip(doc, tmp_path / "clips", start, end)
    assert not (tmp_path / "clips").exists()


def test_box_list_covers_all_frames_and_searches_identity(tmp_path: Path) -> None:
    doc = document(tmp_path)
    doc.frames[0].objects[0].object_id = "engine 27"
    rows = box_occurrences(doc)
    assert len(rows) == sum(len(frame.objects) for frame in doc.frames)
    found = box_occurrences(doc, "fire engine 27", "Reviewed")
    assert len(found) == 1 and found[0].frame_index == 0
    assert not box_occurrences(doc, "engine 27", "Draft")
    assert timestamp(25, 25) == "00:00:01.000"
    assert list(frame_range(doc, 2, 2)) == [2]


def test_clip_is_pixel_exact_rebases_labels_and_retains_ancestry(tmp_path: Path) -> None:
    doc = document(tmp_path)
    doc.frames[1].objects = [doc.frames[0].objects[0].model_copy(deep=True)]
    doc.frames[1].objects[0].object_id = "car 4"
    doc.frames[1].box_links[0] = BoxLink(track_key="a" * 32, edited=True)
    doc.frames[1].blocked_tracks = ["f" * 32]
    original = doc.model_dump_json()
    original_hash = file_sha256(Path(doc.source.path))
    project = export_clip(doc, tmp_path / "clips", 1, 3)
    clipped = AnnotationDocument.model_validate_json(project.read_bytes())
    assert clipped.source.frame_count == 3
    assert clipped.source_ancestors == [doc.source.sha256]
    assert clipped.incident_id == doc.incident_id and clipped.split == doc.split
    assert [frame.frame_index for frame in clipped.frames] == [0, 1, 2]
    expected = doc.frames[1].model_copy(update={"frame_index": 0})
    assert clipped.frames[0] == expected
    assert clipped.frames[0].objects[0].object_id == "car 4"
    source, output = FrameReader(Path(doc.source.path)), FrameReader(Path(clipped.source.path))
    try:
        for index in range(3):
            np.testing.assert_array_equal(output.read(index), source.read(index + 1))
    finally:
        source.close()
        output.close()
    receipt = json.loads((project.parent / "clip-origin.json").read_text())
    assert receipt["pixel_exact_verified"] and not receipt["audio_included"]
    assert doc.model_dump_json() == original
    assert file_sha256(Path(doc.source.path)) == original_hash
    nested_path = export_clip(clipped, tmp_path / "clips", 0, 0)
    nested = AnnotationDocument.model_validate_json(nested_path.read_bytes())
    assert nested.source.frame_count == 1
    assert set(nested.source_ancestors) == {doc.source.sha256, clipped.source.sha256}
    assert len(nested.frames) == 1


def test_clip_cancel_cleans_partial_export_only(tmp_path: Path) -> None:
    doc = document(tmp_path)
    output = tmp_path / "clips"
    output.mkdir()
    sentinel = output / "existing.txt"
    sentinel.write_text("keep")
    cancelled = Event()
    with pytest.raises(ValueError, match="cancelled"):
        export_clip(doc, output, 0, 3, cancel=cancelled, progress=lambda _: cancelled.set())
    assert list(output.iterdir()) == [sentinel]
    assert sentinel.read_text() == "keep"
    assert Path(doc.source.path).is_file()


def test_clip_rejects_changed_video_and_odd_dimensions(tmp_path: Path) -> None:
    doc = document(tmp_path)
    changed = doc.model_copy(deep=True)
    changed.source.sha256 = "c" * 64
    with pytest.raises(ValueError, match="no longer matches"):
        export_clip(changed, tmp_path / "clips", 0, 1)
    changed.source.width = 95
    with pytest.raises(ValueError, match="even video"):
        export_clip(changed, tmp_path / "clips", 0, 1)
    assert not (tmp_path / "clips").exists()


def test_clip_ancestry_blocks_split_leakage_even_when_incident_renamed(tmp_path: Path) -> None:
    doc = document(tmp_path)
    source_path = tmp_path / "train.json"
    clip_path = export_clip(doc, tmp_path / "clips", 0, 1)
    clipped = AnnotationDocument.model_validate_json(clip_path.read_bytes())
    clipped.incident_id = "different name"
    clipped.split = "validation"
    clip_path.write_text(clipped.model_dump_json())
    with pytest.raises(ValueError, match="related clips cross"):
        read_projects([source_path, clip_path])
    result = audit_projects([clip_path, source_path])
    assert any(issue["code"] == "clip_crosses_splits" for issue in result["issues"])
    clipped.split = "training"
    clip_path.write_text(clipped.model_dump_json())
    result = audit_projects([clip_path, source_path])
    assert any(issue["code"] == "related_clips" for issue in result["issues"])


def test_bulk_range_limit_and_missing_draft_frames(tmp_path: Path) -> None:
    doc = document(tmp_path)
    doc.source.frame_count = 10001
    with pytest.raises(ValueError, match="10,000"):
        bulk_review(doc, 0, 10000, reviewed=True)
    doc.frames = []
    updated, changes = bulk_review(doc, 0, 2, reviewed=False)
    assert not updated.frames and changes.already == 3


def test_clip_preserves_unresolved_drafts(tmp_path: Path) -> None:
    doc = document(tmp_path)
    obj = doc.frames[0].objects[0]
    doc.frames = [
        LabelFrame(
            frame_index=1,
            objects=[obj],
            box_links={0: BoxLink(track_key="a" * 32, needs_attention="Check position")},
        )
    ]
    path = export_clip(doc, tmp_path / "clips", 1, 1)
    clipped = AnnotationDocument.model_validate_json(path.read_bytes())
    assert not clipped.frames[0].reviewed
    assert clipped.frames[0].box_links[0].needs_attention == "Check position"


def test_exported_clip_is_discoverable_from_home(tmp_path: Path) -> None:
    doc = document(tmp_path)
    project = export_clip(doc, tmp_path / "annotations" / "clips", 0, 2)
    library = discover_library(tmp_path)
    assert not library.warnings
    assert len(library.items) == 1
    assert library.items[0].projects[0].path == project


def test_repeated_frame_reads_are_independent_and_still_validate_file(tmp_path: Path) -> None:
    doc = document(tmp_path)
    path = Path(doc.source.path)
    reader = FrameReader(path)
    try:
        original = reader.read(0)
        changed = reader.read(0)
        changed[:] = 0
        np.testing.assert_array_equal(reader.read(0), original)
        with path.open("ab") as stream:
            stream.write(b"changed")
        with pytest.raises(ValueError, match="video changed"):
            reader.read(0)
    finally:
        reader.close()


def test_clip_never_removes_a_directory_it_failed_to_create(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    doc = document(tmp_path)
    output = tmp_path / "clips"
    output.mkdir()
    collided = []
    original_mkdir = Path.mkdir

    def simulate_collision(path, *args, **kwargs):
        if path.parent == output:
            original_mkdir(path)
            collided.append(path)
            raise FileExistsError("Another process created this directory")
        return original_mkdir(path, *args, **kwargs)

    monkeypatch.setattr(Path, "mkdir", simulate_collision)
    with pytest.raises(FileExistsError):
        export_clip(doc, output, 0, 1)
    assert len(collided) == 1 and collided[0].is_dir()
