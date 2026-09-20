from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
import pytest
from test_rescue_studio_ui import desktop_root as desktop_root
from test_rescue_studio_ui import studio as studio
from test_rescue_training import make_project, make_run, read_doc

from tracker.rescue.annotation_ui import AnnotationApp
from tracker.rescue.annotations import AnnotationDocument, AnnotationSession, LabelFrame
from tracker.rescue.assisted_review import (
    build_queue,
    candidate_status,
    load_queue,
    next_candidate,
    queue_path,
    skip_candidate,
)
from tracker.rescue.evaluation import TruthObject
from tracker.rescue.media import FrameReader
from tracker.rescue.propagation import merge_propagation, propagate_box
from tracker.rescue.state_store import StateStore, WorkCancelled, file_lease


def moving_project(directory: Path) -> Path:
    video = directory / "moving.avi"
    writer = cv2.VideoWriter(str(video), cv2.VideoWriter.fourcc(*"MJPG"), 10, (180, 140))
    assert writer.isOpened()
    texture = np.random.default_rng(4).integers(20, 240, (36, 36, 3), dtype=np.uint8)
    for index in range(12):
        image = np.zeros((140, 180, 3), dtype=np.uint8)
        image[35 + 2 * index : 71 + 2 * index, 20 + 3 * index : 56 + 3 * index] = texture
        writer.write(image)
    writer.release()
    reader = FrameReader(video)
    try:
        doc = AnnotationDocument(
            source=reader.source,
            classes=["debris"],
            frames=[
                LabelFrame(
                    frame_index=0,
                    reviewed=True,
                    objects=[TruthObject(label="debris", bbox_xyxy=(20, 35, 56, 71))],
                )
            ],
        )
        path = directory / "moving.json"
        AnnotationSession(doc, path).save()
        return path
    finally:
        reader.close()


def test_real_optical_flow_proposals_are_drafts_and_one_undo(tmp_path: Path) -> None:
    path = moving_project(tmp_path)
    original = read_doc(path)
    result = propagate_box(original, 0, 0, steps=5)
    assert len(result.proposals) == 5, result.stop_reason
    np.testing.assert_allclose(result.proposals[-1].box.bbox_xyxy, (35, 45, 71, 81), atol=3)
    updated, added, protected = merge_propagation(original, result)
    assert added == [1, 2, 3, 4, 5] and not protected
    assert updated.frames[0].reviewed
    assert not any(frame.reviewed for frame in updated.frames[1:])
    session = AnnotationSession.open(path, original.source)
    session.replace_document(updated)
    assert session.undo() and session.document == original


def test_propagation_preserves_reviewed_existing_and_overlap(tmp_path: Path) -> None:
    path = moving_project(tmp_path)
    doc = read_doc(path)
    doc.frames.extend(
        [
            LabelFrame(frame_index=1, reviewed=True, objects=[]),
            LabelFrame(frame_index=2, objects=[]),
            LabelFrame(
                frame_index=3, objects=[TruthObject(label="debris", bbox_xyxy=(25, 38, 68, 83))]
            ),
        ]
    )
    result = propagate_box(doc, 0, 0, steps=4)
    default, added, protected = merge_propagation(doc, result)
    assert added == [4] and protected == [1, 2, 3]
    appended, added, protected = merge_propagation(doc, result, append_drafts=True)
    assert added == [2, 4] and protected == [1, 3]
    assert appended.frames[1] == doc.frames[1]
    assert default.frames[:4] == doc.frames


def test_propagation_stale_cancel_and_textureless_stop(tmp_path: Path) -> None:
    path = moving_project(tmp_path)
    doc = read_doc(path)
    result = propagate_box(doc, 0, 0, steps=2)
    doc.frames[0].objects[0].label = "other"
    with pytest.raises(ValueError, match="Labels changed"):
        merge_propagation(doc, result)
    doc = read_doc(path)

    def stop() -> None:
        raise WorkCancelled("stop")

    with pytest.raises(WorkCancelled):
        propagate_box(doc, 0, 0, check_stop=stop)
    doc.frames[0].objects[0].bbox_xyxy = (110, 10, 140, 30)
    result = propagate_box(doc, 0, 0)
    assert not result.proposals and "texture" in result.stop_reason
    with pytest.raises(ValueError, match="1-60"):
        propagate_box(doc, 0, 0, steps=61)


def test_queue_uses_prediction_signals_without_mutating_labels(tmp_path: Path) -> None:
    path = make_project(tmp_path, "clip", "training")
    doc = read_doc(path)
    doc.frames = []
    run = make_run(tmp_path / "run", doc)
    records = [json.loads(line) for line in (run / "frames.jsonl").read_text().splitlines()]
    records[1]["observations"] = []
    records[2]["observations"][0]["confidence"] = 0.2
    records[2]["observations"][0]["bbox_xyxy"] = [55, 55, 90, 90]
    (run / "frames.jsonl").write_text("\n".join(map(json.dumps, records)) + "\n")
    before = doc.model_dump_json()
    result = build_queue(doc, run, limit=4)
    assert result.run_sha256
    assert any("Low-confidence detection" in item.reasons for item in result.candidates)
    assert any(
        any("Coverage sample" in reason for reason in item.reasons) for item in result.candidates
    )
    assert len({item.frame_index for item in result.candidates}) == len(result.candidates)
    assert doc.model_dump_json() == before


def test_queue_resume_skip_edit_and_concurrent_save(tmp_path: Path) -> None:
    path = moving_project(tmp_path)
    doc = read_doc(path)
    review = build_queue(doc, limit=10)
    assert all(item.frame_index != 0 for item in review.candidates)
    first = next_candidate(review, doc)
    assert first is not None
    review.bookmark.cursor = first
    store = StateStore(queue_path(path))
    store.save(review)
    reopened_store = StateStore(queue_path(path))
    reopened = load_queue(reopened_store, doc)
    assert reopened is not None and reopened.bookmark.cursor == first
    skipped = skip_candidate(reopened, doc, first)
    assert candidate_status(skipped, doc, first) == "Skipped"
    assert skipped.undo[-1].cursor == first
    reopened_store.save(skipped)
    with pytest.raises(ValueError, match="another window"):
        store.save(review)
    doc.frames.append(LabelFrame(frame_index=first, objects=[]))
    assert candidate_status(skipped, doc, first) == "Pending"
    doc.frames[-1].reviewed = True
    assert candidate_status(skipped, doc, first) == "Reviewed"


def test_state_lock_release_and_queue_scope_guard(tmp_path: Path) -> None:
    path = moving_project(tmp_path)
    doc = read_doc(path)
    review = build_queue(doc)
    store = StateStore(queue_path(path))
    with (
        file_lease(store.path.with_name(f".{store.path.name}.lock")),
        pytest.raises(ValueError, match="Another worker"),
    ):
        store.save(review)
    store.save(review)
    doc.classes.append("smoke")
    with pytest.raises(ValueError, match="Tags changed"):
        load_queue(store, doc)


def test_assisted_controls_use_queue_and_do_not_review_on_skip(studio: AnnotationApp) -> None:
    panel = studio.assisted_panel
    studio.session.document.frames = []
    review = build_queue(studio.session.document)
    panel.commit_queue(review)
    assert panel.open_next()
    selected = studio.index
    before = studio.session.document.model_dump_json()
    panel.skip()
    assert studio.session.document.model_dump_json() == before
    assert panel.review_queue is not None
    assert candidate_status(panel.review_queue, studio.session.document, selected) == "Skipped"
    panel.undo_skip()
    assert candidate_status(panel.review_queue, studio.session.document, selected) == "Pending"
    assert panel.open_next()
    studio.review_next()
    assert studio.session.frame(selected).reviewed
    panel.reload()
    assert panel.review_queue is not None
