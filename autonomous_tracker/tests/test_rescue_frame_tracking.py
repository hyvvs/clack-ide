from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest
from test_rescue_assisted import moving_project
from test_rescue_training import read_doc

from tracker.rescue.annotations import AnnotationDocument, AnnotationSession, BoxLink, LabelFrame
from tracker.rescue.evaluation import TruthObject
from tracker.rescue.frame_tracking import machine_box, merge_tracking, track_frames, tracking_seeds
from tracker.rescue.media import FrameReader
from tracker.rescue.state_store import WorkCancelled


def multi_project(directory: Path, count: int = 85) -> Path:
    video = directory / "multi.avi"
    writer = cv2.VideoWriter(str(video), cv2.VideoWriter.fourcc(*"MJPG"), 10, (260, 200))
    assert writer.isOpened()
    rng = np.random.default_rng(42)
    patches = [rng.integers(20, 240, (32, 32, 3), dtype=np.uint8) for _ in range(3)]
    for i in range(count):
        frame = np.zeros((200, 260, 3), dtype=np.uint8)
        frame[20:52, 20 + i : 52 + i] = patches[0]
        frame[80:112, 200 - i : 232 - i] = patches[1]
        frame[150:182, 50:82] = patches[2]
        writer.write(frame)
    writer.release()
    reader = FrameReader(video)
    try:
        doc = AnnotationDocument(
            source=reader.source,
            classes=["car", "debris"],
            frames=[
                LabelFrame(
                    frame_index=0,
                    reviewed=True,
                    objects=[
                        TruthObject(label="car", bbox_xyxy=(20, 20, 52, 52), object_id="one"),
                        TruthObject(label="car", bbox_xyxy=(200, 80, 232, 112), object_id="two"),
                        TruthObject(label="debris", bbox_xyxy=(50, 150, 82, 182)),
                    ],
                )
            ],
        )
        path = directory / "multi.json"
        AnnotationSession(doc, path).save()
        return path
    finally:
        reader.close()


def session_with_drafts(directory: Path) -> AnnotationSession:
    path = multi_project(directory, count=12)
    session = AnnotationSession(read_doc(path), path)
    updated, _ = merge_tracking(
        session.document, track_frames(session.document, 0, 11, method="fixed")
    )
    session.replace_document(updated)
    return session


def correct(session: AnnotationSession, frame: int, index: int = 0, shift: int = 3) -> None:
    objects = session.frame(frame).objects
    box = objects[index]
    x1, y1, x2, y2 = box.bbox_xyxy
    objects[index] = box.model_copy(update={"bbox_xyxy": (x1 + shift, y1, x2 + shift, y2)})
    session.replace_frame(frame, objects, edited_index=index)


def test_copy_all_preserves_ids_drafts_save_resume_truth_and_one_undo(tmp_path: Path) -> None:
    path = multi_project(tmp_path, count=12)
    original = read_doc(path)
    updated, changes = merge_tracking(original, track_frames(original, 0, 1, method="fixed"))
    assert changes.added == 3 and changes.frames == [1]
    assert updated.frames[1].objects == original.frames[0].objects
    assert not updated.frames[1].reviewed and updated.frames[0].reviewed
    assert updated.to_truth() == original.to_truth()
    assert "box_links" not in updated.to_truth(False).model_dump_json()
    assert "blocked_tracks" not in updated.to_truth(False).model_dump_json()
    assert updated.frames[1].objects[-1].object_id is None
    repeat, no_change = merge_tracking(updated, track_frames(updated, 0, 1, method="fixed"))
    assert not no_change.count and repeat == updated
    session = AnnotationSession(original, path)
    session.replace_document(updated)
    session.save()
    reopened = AnnotationSession.open(path, original.source)
    assert reopened.document == updated
    assert session.undo() and session.document == original


def test_three_objects_move_independently_beyond_60_frames_with_one_decode_per_frame(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    doc = read_doc(multi_project(tmp_path))
    read = FrameReader.read
    calls: list[int] = []

    def counted(self: FrameReader, index: int):
        calls.append(index)
        return read(self, index)

    monkeypatch.setattr(FrameReader, "read", counted)
    result = track_frames(doc, 0, 84)
    assert len(result.proposals) == 84 * 3, result.stops
    assert calls == [0, *range(85)]
    last = [p.box.bbox_xyxy for p in result.proposals if p.frame_index == 84]
    np.testing.assert_allclose(
        last, [(104, 20, 136, 52), (116, 80, 148, 112), (50, 150, 82, 182)], atol=4
    )
    updated, changes = merge_tracking(doc, result)
    assert changes.added == 252 and len(updated.frames) == 85
    assert all(not f.reviewed for f in updated.frames[1:])


def test_selected_correction_updates_only_its_later_drafts(tmp_path: Path) -> None:
    session = session_with_drafts(tmp_path)
    earlier = session.frame(2)
    correct(session, 3)
    key = session.frame(3).box_links[0].track_key
    assert not machine_box(session.frame(3), 0, key)
    before = session.document.model_copy(deep=True)
    updated, changes = merge_tracking(before, track_frames(before, 3, 11, [0], method="fixed"))
    assert changes.replaced == 8 and not changes.added and not changes.removed
    assert updated.frames[2] == earlier
    for frame in updated.frames[4:]:
        assert frame.objects[0] == session.frame(3).objects[0]
        assert frame.objects[1:] == session.frame(frame.frame_index).objects[1:]
    session.replace_document(updated)
    assert session.undo() and session.document == before


@pytest.mark.parametrize("protection", ["edit", "review", "delete"])
def test_stop_before_later_protected_keyframe(tmp_path: Path, protection: str) -> None:
    session = session_with_drafts(tmp_path)
    if protection == "edit":
        correct(session, 7, shift=5)
    elif protection == "review":
        session.replace_frame(7, session.frame(7).objects, reviewed=True)
    else:
        session.replace_frame(7, session.frame(7).objects[1:])
    correct(session, 3)
    before = session.document.model_copy(deep=True)
    result = track_frames(before, 3, 11, [0], method="fixed")
    assert result.seeds[0].until_frame == 6
    assert "keyframe 7" in result.stops[0].reason
    updated, changes = merge_tracking(before, result)
    assert changes.replaced == 3
    assert {f.frame_index: f for f in updated.frames if f.frame_index >= 7} == {
        f.frame_index: f for f in before.frames if f.frame_index >= 7
    }


def test_lost_track_cleans_own_stale_drafts_but_keeps_manual_and_other_tracks(
    tmp_path: Path,
) -> None:
    session = session_with_drafts(tmp_path)
    correct(session, 8, shift=5)
    objects = session.frame(3).objects
    objects[0].bbox_xyxy = (5, 120, 30, 145)
    session.replace_frame(3, objects, edited_index=0)
    before = session.document.model_copy(deep=True)
    result = track_frames(before, 3, 11, [0])
    assert not result.proposals and "texture" in result.stops[0].reason
    updated, changes = merge_tracking(before, result)
    assert changes.removed == 4
    for frame in updated.frames[4:8]:
        assert frame.objects == session.frame(frame.frame_index).objects[1:]
        assert len(frame.box_links) == 2
    assert {f.frame_index: f for f in updated.frames if f.frame_index >= 8} == {
        f.frame_index: f for f in before.frames if f.frame_index >= 8
    }
    untouched, ignored = merge_tracking(before, result, update_generated=False)
    assert untouched == before and not ignored.count


def test_deleted_box_can_remove_its_future_drafts_after_reopen(tmp_path: Path) -> None:
    session = session_with_drafts(tmp_path)
    key = session.frame(3).box_links[0].track_key
    session.replace_frame(3, session.frame(3).objects[1:])
    assert session.frame(3).blocked_tracks == [key]
    assert session.frame(3).box_links[0].track_key == session.frame(2).box_links[1].track_key
    session.save()
    reopened = AnnotationSession.open(session.path, session.document.source)
    result = track_frames(reopened.document, 3, 11, method="fixed")
    updated, changes = merge_tracking(reopened.document, result)
    assert changes.removed == 8
    assert all(len(f.objects) == 2 for f in updated.frames[3:])
    assert updated.frames[:3] == reopened.document.frames[:3]


def test_manual_overlap_and_object_id_conflicts_are_preserved(tmp_path: Path) -> None:
    doc = read_doc(multi_project(tmp_path, 12))
    doc.frames.append(
        LabelFrame(
            frame_index=1,
            objects=[
                TruthObject(label="car", bbox_xyxy=(21, 20, 52, 52)),
                TruthObject(label="car", bbox_xyxy=(140, 120, 160, 140), object_id="two"),
            ],
        )
    )
    before = doc.frames[1].model_copy(deep=True)
    updated, changes = merge_tracking(doc, track_frames(doc, 0, 1, method="fixed"))
    assert changes.protected == 2 and changes.added == 1
    assert updated.frames[1].objects[:2] == before.objects


def test_replacement_conflict_preserves_manual_box(tmp_path: Path) -> None:
    session = session_with_drafts(tmp_path)
    objects = session.frame(4).objects
    extra = TruthObject(label="debris", bbox_xyxy=(56, 20, 90, 52))
    session.replace_frame(4, [*objects, extra])
    correct(session, 3, shift=12)
    updated, changes = merge_tracking(
        session.document, track_frames(session.document, 3, 5, [0], method="fixed")
    )
    assert changes.protected == 1 and changes.replaced == 1
    assert updated.frames[4] == session.frame(4)


def test_retag_keeps_tracking_identity_and_propagates_new_tag(tmp_path: Path) -> None:
    session = session_with_drafts(tmp_path)
    key = session.frame(3).box_links[0].track_key
    session.apply_tag(3, "debris", 0)
    assert session.frame(3).box_links[0] == BoxLink(track_key=key, origin="copied", edited=True)
    updated, changes = merge_tracking(
        session.document, track_frames(session.document, 3, 5, [0], method="fixed")
    )
    assert changes.replaced == 2
    assert all(f.objects[0].label == "debris" for f in updated.frames[3:6])


def test_stale_preview_and_source_change_are_rejected(tmp_path: Path) -> None:
    doc = read_doc(moving_project(tmp_path))
    result = track_frames(doc, 0, 2)
    doc.frames[0].objects[0].bbox_xyxy = (22, 35, 56, 71)
    with pytest.raises(ValueError, match="Labels changed"):
        merge_tracking(doc, result)
    doc.source.sha256 = "a" * 64
    with pytest.raises(ValueError, match="source differs"):
        track_frames(doc, 0, 2)


def test_cancellation_mid_range_is_nonmutating_and_reader_is_closed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    doc = read_doc(moving_project(tmp_path))
    before = doc.model_dump_json()
    close = FrameReader.close
    closed = []
    calls = 0

    def stop() -> None:
        nonlocal calls
        calls += 1
        if calls == 6:
            raise WorkCancelled("Stopped")

    def counted(self: FrameReader) -> None:
        closed.append(True)
        close(self)

    monkeypatch.setattr(FrameReader, "close", counted)
    with pytest.raises(WorkCancelled):
        track_frames(doc, 0, 11, check_stop=stop)
    assert doc.model_dump_json() == before and closed == [True]


def test_limits_selection_and_old_documents(tmp_path: Path) -> None:
    doc = read_doc(moving_project(tmp_path))
    legacy = doc.model_dump()
    for frame in legacy["frames"]:
        frame.pop("box_links")
        frame.pop("blocked_tracks")
    assert AnnotationDocument.model_validate(legacy) == doc
    with pytest.raises(ValueError, match="end frame"):
        track_frames(doc, 11, 12, method="fixed")
    with pytest.raises(ValueError, match="no longer exists"):
        track_frames(doc, 0, 3, [50])
    doc.source.frame_count = 100_000
    with pytest.raises(ValueError, match=r"5,?000"):
        track_frames(doc, 0, 5001, method="fixed")
    doc.frames[0].objects *= 21
    with pytest.raises(ValueError, match="100,000"):
        tracking_seeds(doc, 0, 5000, None)


def test_links_one_to_one_and_review_protection_survives_class_scope_changes(
    tmp_path: Path,
) -> None:
    session = session_with_drafts(tmp_path)
    objects = session.frame(1).objects
    objects[0] = objects[0].model_copy(update={"object_id": None})
    session.replace_frame(1, objects, edited_index=0)
    session.replace_frame(1, [*objects, objects[0].model_copy(deep=True)])
    frame = session.frame(1)
    assert len(frame.box_links) == 3
    session.replace_frame(1, frame.objects, reviewed=True)
    assert all(link.generated is None for link in session.frame(1).box_links.values())
    session.change_class("new category")
    result = track_frames(session.document, 0, 4, method="fixed")
    assert all(seed.until_frame == 0 for seed in result.seeds)


def test_invalid_links_fail_validation() -> None:
    obj = TruthObject(label="car", bbox_xyxy=(1, 1, 5, 5))
    link = BoxLink(track_key="a" * 32)
    with pytest.raises(ValueError, match="missing box"):
        LabelFrame(frame_index=0, objects=[obj], box_links={1: link})
    with pytest.raises(ValueError, match="twice"):
        LabelFrame(frame_index=0, objects=[obj, obj], box_links={0: link, 1: link})
    with pytest.raises(ValueError, match="both present and deleted"):
        LabelFrame(
            frame_index=0, objects=[obj], box_links={0: link}, blocked_tracks=[link.track_key]
        )
