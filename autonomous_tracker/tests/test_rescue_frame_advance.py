from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import pytest
from test_rescue_assisted import moving_project
from test_rescue_studio_ui import desktop_root as desktop_root
from test_rescue_studio_ui import studio as studio
from test_rescue_training import read_doc

from tracker.rescue.annotation_ui import AnnotationApp
from tracker.rescue.annotations import AnnotationSession, LabelFrame
from tracker.rescue.frame_tracking import hold_failed_step, merge_tracking, track_frames
from tracker.rescue.media import FrameReader
from tracker.rescue.studio_state import load_position, save_position
from tracker.rescue.tracking_labels import attention_count, box_caption, box_identity, box_state


def pump(app: AnnotationApp) -> None:
    end = time.monotonic() + 5
    while app.carry.busy and time.monotonic() < end:
        app.root.update()
        time.sleep(0.01)
    assert not app.carry.busy


def prepare(app: AnnotationApp) -> None:
    app.session.document.frames = [app.session.frame(0)]
    app.carry.mode.set("Keep positions")


def test_adjacent_pair_uses_real_motion_without_reopening_or_rehashing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    doc = read_doc(moving_project(tmp_path))
    reader = FrameReader(Path(doc.source.path))
    pair = (reader.read(0), reader.read(1))
    reader.close()

    def forbidden(*args, **kwargs):
        raise AssertionError("Do not reopen or rehash the video for a prepared pair")

    monkeypatch.setattr(FrameReader, "__init__", forbidden)
    result = track_frames(doc, 0, 1, frame_pair=pair)
    assert len(result.proposals) == 1
    np.testing.assert_allclose(result.proposals[0].box.bbox_xyxy, (23, 37, 59, 73), atol=2)
    updated, _ = merge_tracking(doc, hold_failed_step(result))
    assert box_state(updated.frames[1], 0) == "Tracked"
    assert box_identity(updated.frames[0], 0) == box_identity(updated.frames[1], 0)
    assert updated.frames[1].objects[0].object_id is None
    with pytest.raises(ValueError, match="adjacent pair"):
        track_frames(doc, 0, 2, frame_pair=pair)


def test_failed_step_holds_last_known_box_but_cannot_review_or_continue_until_fixed(
    tmp_path: Path,
) -> None:
    path = moving_project(tmp_path)
    doc = read_doc(path)
    blank = np.zeros((140, 180, 3), dtype=np.uint8)
    result = track_frames(doc, 0, 1, frame_pair=(blank, blank))
    assert not result.proposals
    updated, changes = merge_tracking(doc, hold_failed_step(result))
    assert changes.added == 1
    frame = updated.frames[1]
    assert frame.objects == doc.frames[0].objects
    assert box_state(frame, 0) == "Needs attention"
    assert "NOT a successful match" in frame.box_links[0].needs_attention
    assert updated.to_truth() == doc.to_truth()
    session = AnnotationSession(updated, tmp_path / "held.json")
    before = session.document.model_copy(deep=True)
    with pytest.raises(ValueError, match="Needs attention"):
        session.replace_frame(1, frame.objects, reviewed=True)
    with pytest.raises(ValueError, match="Needs attention"):
        track_frames(updated, 1, 2, method="fixed")
    session.save()
    reopened = AnnotationSession.open(session.path, doc.source)
    assert attention_count(reopened.frame(1)) == 1
    session.replace_frame(1, frame.objects, edited_index=0)
    assert box_state(session.frame(1), 0) == "Corrected"
    assert box_identity(session.frame(1), 0) == box_identity(frame, 0)
    session.replace_frame(1, session.frame(1).objects, reviewed=True)
    assert box_state(session.frame(1), 0) == "Reviewed"
    session.undo()
    session.undo()
    assert session.document == before
    session.replace_frame(1, [])
    assert not attention_count(session.frame(1))
    assert session.frame(1).blocked_tracks == [frame.box_links[0].track_key]


def test_retagging_lost_box_does_not_confirm_its_position(tmp_path: Path) -> None:
    doc = read_doc(moving_project(tmp_path))
    blank = np.zeros((140, 180, 3), dtype=np.uint8)
    updated, _ = merge_tracking(
        doc, hold_failed_step(track_frames(doc, 0, 1, frame_pair=(blank, blank)))
    )
    session = AnnotationSession(updated, tmp_path / "retag.json")
    session.apply_tag(1, "car", 0)
    assert box_state(session.frame(1), 0) == "Needs attention"
    assert attention_count(session.frame(1)) == 1


def test_hold_does_not_cross_a_reviewed_boundary(tmp_path: Path) -> None:
    doc = read_doc(moving_project(tmp_path))
    doc.frames.append(LabelFrame(frame_index=1, reviewed=True, objects=[]))
    result = hold_failed_step(track_frames(doc, 0, 1))
    assert not result.proposals
    updated, changes = merge_tracking(doc, result)
    assert not changes.count and updated == doc
    with pytest.raises(ValueError, match="single adjacent"):
        hold_failed_step(track_frames(doc, 0, 2, method="fixed"))


def test_track_next_button_copies_without_dialog_and_keeps_visible_id(
    studio: AnnotationApp, monkeypatch: pytest.MonkeyPatch
) -> None:
    prepare(studio)
    original = studio.session.document.model_copy(deep=True)

    def unexpected(*args, **kwargs):
        raise AssertionError("Track & next should not require a confirmation dialog")

    monkeypatch.setattr("tracker.rescue.annotation_ui.messagebox.askyesno", unexpected)
    studio.carry.track_button.invoke()
    pump(studio)
    assert studio.index == 1 and box_state(studio.session.frame(1), 0) == "Copied"
    identity = box_identity(studio.session.frame(1), 0)
    captions = [
        studio.canvas.itemcget(item, "text")
        for item in studio.canvas.find_all()
        if studio.canvas.type(item) == "text"
    ]
    assert any(identity in text and "Copied" in text for text in captions)
    assert identity in studio.objects.get(0)
    studio.carry.track_button.invoke()
    pump(studio)
    assert studio.index == 2 and box_identity(studio.session.frame(2), 0) == identity
    studio.undo()
    studio.undo()
    assert studio.session.document == original


def test_auto_next_is_opt_in_persists_and_jumps_do_not_generate(studio: AnnotationApp) -> None:
    prepare(studio)
    original = studio.session.document.model_copy(deep=True)
    studio.step(1)
    assert studio.index == 1 and studio.session.document == original
    studio.go(0)
    studio.carry.enabled.set(True)
    studio.carry.toggle()
    assert studio.next_button.cget("text") == "Next (auto-track)"
    assert "Auto ON" in studio.carry.summary.get()
    studio.next_button.invoke()
    pump(studio)
    assert studio.index == 1 and len(studio.session.frame(1).objects) == 1
    assert studio.save()
    state = load_position(studio.session.path, studio.reader.source)
    assert state.auto_track and state.carry_mode == "fixed"
    before = studio.session.document.model_copy(deep=True)
    studio.step(10)
    assert studio.index == 3 and studio.session.document == before
    studio.carry.start()
    assert not studio.carry.busy and "End of video" in studio.status.get()


def test_review_and_next_with_auto_reviews_only_source(studio: AnnotationApp) -> None:
    prepare(studio)
    studio.carry.enabled.set(True)
    studio.carry.toggle()
    studio.review_next()
    pump(studio)
    assert studio.index == 1
    assert studio.session.frame(0).reviewed and not studio.session.frame(1).reviewed


def test_tracking_failure_is_visible_and_confirm_preserves_id(
    studio: AnnotationApp, monkeypatch: pytest.MonkeyPatch
) -> None:
    prepare(studio)
    studio.carry.mode.set("Follow motion")
    studio.image = np.zeros_like(studio.image)
    read = studio.reader.read
    monkeypatch.setattr(studio.reader, "read", lambda index: np.zeros_like(read(index)))
    studio.carry.start()
    pump(studio)
    assert studio.index == 1 and attention_count(studio.session.frame(1)) == 1
    assert "needs attention" in studio.carry.summary.get()
    assert not studio.mark_reviewed()
    studio.carry.start()
    assert not studio.carry.busy and studio.index == 1
    studio.objects.selection_set(0)
    studio.select_object()
    identity = box_identity(studio.session.frame(1), 0)
    assert "NOT a successful match" in studio.track_info.get()
    studio.update_object()
    assert not attention_count(studio.session.frame(1))
    assert box_identity(studio.session.frame(1), 0) == identity
    assert "Corrected" in box_caption(studio.session.frame(1), 0)
    assert studio.mark_reviewed()


@pytest.mark.parametrize("action", ["cancel", "navigate", "disable", "mode", "edit"])
def test_late_step_never_overwrites_newer_work(studio: AnnotationApp, action: str) -> None:
    prepare(studio)
    studio.carry.enabled.set(True)
    studio.carry.toggle()
    studio.carry.start()
    if action == "cancel":
        studio.carry.cancel.set()
    elif action == "navigate":
        studio.go(2)
    elif action == "disable":
        studio.carry.enabled.set(False)
        studio.carry.toggle()
    elif action == "mode":
        studio.carry.mode.set("Follow motion")
    else:
        studio.session.replace_frame(1, [], reviewed=True)
    expected = studio.session.document.model_copy(deep=True)
    pump(studio)
    assert studio.session.document == expected


def test_next_preserves_reviewed_destination_and_empty_source(studio: AnnotationApp) -> None:
    before = studio.session.document.model_copy(deep=True)
    studio.carry.start()
    assert studio.index == 1 and studio.session.document == before
    studio.session.document.frames = []
    studio.carry.start()
    assert studio.index == 2 and not studio.session.document.frames


def test_changed_source_blocks_adjacent_commit(
    studio: AnnotationApp, monkeypatch: pytest.MonkeyPatch
) -> None:
    prepare(studio)
    before = studio.session.document.model_copy(deep=True)
    studio.carry.start()

    def changed(index: int):
        raise ValueError("video changed")

    monkeypatch.setattr(studio.reader, "read", changed)
    pump(studio)
    assert studio.session.document == before and "not applied" in studio.status.get()


def test_old_position_defaults_and_new_preferences_round_trip(tmp_path: Path) -> None:
    doc = read_doc(moving_project(tmp_path))
    project = tmp_path / "position.json"
    assert not load_position(project, doc.source).auto_track
    save_position(project, doc.source, 2, "debris", auto_track=True, carry_mode="fixed")
    saved = load_position(project, doc.source)
    assert saved.frame_index == 2 and saved.auto_track and saved.carry_mode == "fixed"


def test_hidden_controls_fit_minimum_width_and_box_labels_stay_on_canvas(
    studio: AnnotationApp,
) -> None:
    prepare(studio)
    studio.root.update_idletasks()
    assert studio.carry.winfo_reqwidth() <= 1000
    assert studio.root.state() == "withdrawn"
    studio.draw()
    for item in studio.canvas.find_all():
        if studio.canvas.type(item) == "text":
            left, top, right, bottom = studio.canvas.bbox(item)
            assert 0 <= left < right <= 640
            assert 0 <= top < bottom <= 480
