from __future__ import annotations

import time

import pytest
from test_rescue_studio_ui import desktop_root as desktop_root
from test_rescue_studio_ui import studio as studio

from tracker.rescue.annotation_ui import AnnotationApp
from tracker.rescue.frame_tracking import merge_tracking, track_frames
from tracker.rescue.tracking_ui import TrackingWindow


def pending(studio: AnnotationApp) -> None:
    studio.session.document.frames = [studio.session.frame(0)]


def finish(studio: AnnotationApp, window: TrackingWindow) -> None:
    end = time.monotonic() + 5
    while window.busy and time.monotonic() < end:
        studio.root.update()
        time.sleep(0.01)
    assert not window.busy


def preview(studio: AnnotationApp) -> TrackingWindow:
    pending(studio)
    studio.open_tracking()
    window = studio.tracking_window
    assert window is not None
    window.mode.set("Fixed positions (copy)")
    window.start()
    finish(studio, window)
    assert window.result is not None and window.preview_image is not None
    return window


def test_copy_next_button_preserves_original_and_undo(studio: AnnotationApp) -> None:
    pending(studio)
    original = studio.session.document.model_copy(deep=True)
    studio.copy_boxes_next()
    assert studio.index == 1 and not studio.session.frame(1).reviewed
    assert studio.session.frame(1).objects == original.frames[0].objects
    studio.undo()
    assert studio.session.document == original


def test_copy_does_not_overwrite_reviewed_destination(studio: AnnotationApp) -> None:
    original = studio.session.document.model_copy(deep=True)
    studio.copy_boxes_next()
    assert studio.session.document == original and studio.index == 0


def test_preview_apply_review_and_single_undo(studio: AnnotationApp) -> None:
    window = preview(studio)
    original = studio.session.document.model_copy(deep=True)
    assert len(original.frames) == 1
    assert window.frames.cget("values") == ("1", "2", "3")
    window.step(1)
    assert window.frames.get() == "2"
    window.apply()
    assert not window.winfo_exists()
    assert studio.index == 1
    assert len(studio.session.document.frames) == 4
    assert not any(f.reviewed for f in studio.session.document.frames if f.frame_index)
    studio.undo()
    assert studio.session.document == original


def test_update_follows_selected_box_after_edit(studio: AnnotationApp) -> None:
    pending(studio)
    doc, _ = merge_tracking(
        studio.session.document, track_frames(studio.session.document, 0, 3, method="fixed")
    )
    studio.session.replace_document(doc)
    studio.go(1)
    studio.objects.selection_set(0)
    studio.select_object()
    studio.box_fields[0].set("14")
    studio.update_object()
    assert studio.selected == 0
    studio.open_tracking(True)
    window = studio.tracking_window
    assert window is not None and window.scope.get() == "Selected box"
    window.mode.set("Fixed positions (copy)")
    window.start()
    finish(studio, window)
    window.apply()
    assert studio.session.frame(2).objects[0].bbox_xyxy[0] == 14
    assert studio.session.frame(3).objects[0].bbox_xyxy[0] == 14


def test_changed_settings_invalidate_preview(studio: AnnotationApp) -> None:
    window = preview(studio)
    original = studio.session.document.model_copy(deep=True)
    window.end.set("2")
    assert window.result is None and str(window.apply_button.cget("state")) == "disabled"
    window.apply()
    assert studio.session.document == original


def test_changed_labels_reject_apply(
    studio: AnnotationApp, monkeypatch: pytest.MonkeyPatch
) -> None:
    window = preview(studio)
    errors = []
    monkeypatch.setattr(window, "error", errors.append)
    studio.session.replace_frame(1, [], reviewed=True)
    original = studio.session.document.model_copy(deep=True)
    window.apply()
    assert errors and "Labels changed" in str(errors[0])
    assert studio.session.document == original


def test_changed_video_rejects_copy_and_apply(
    studio: AnnotationApp, monkeypatch: pytest.MonkeyPatch
) -> None:
    window = preview(studio)
    original = studio.session.document.model_copy(deep=True)
    errors = []
    monkeypatch.setattr(window, "error", errors.append)
    monkeypatch.setattr(studio, "error", errors.append)

    def changed(index: int):
        raise ValueError("video changed")

    monkeypatch.setattr(studio.reader, "read", changed)
    window.apply()
    studio.copy_boxes_next()
    assert len(errors) == 2 and studio.session.document == original


def test_cancellation_and_settings_changed_during_worker(studio: AnnotationApp) -> None:
    pending(studio)
    original = studio.session.document.model_copy(deep=True)
    studio.open_tracking()
    window = studio.tracking_window
    assert window is not None
    window.mode.set("Fixed positions (copy)")
    window.start()
    window.cancel.set()
    finish(studio, window)
    assert window.result is None and "Cancelled" in window.status.get()
    window.start()
    window.end.set("2")
    finish(studio, window)
    assert window.result is None and "Settings changed" in window.status.get()
    assert studio.session.document == original


def test_selected_without_selection_fails_without_worker(
    studio: AnnotationApp, monkeypatch: pytest.MonkeyPatch
) -> None:
    pending(studio)
    studio.open_tracking()
    window = studio.tracking_window
    assert window is not None
    errors = []
    monkeypatch.setattr(window, "error", errors.append)
    window.scope.set("Selected box")
    window.start()
    assert errors and not window.busy and window.result is None
