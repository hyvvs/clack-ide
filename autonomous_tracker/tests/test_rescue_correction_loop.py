from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import pytest
from test_rescue_managed_models import completed_run, finish
from test_rescue_studio_ui import desktop_root as desktop_root
from test_rescue_studio_ui import studio as studio
from test_rescue_training import make_project, make_run, read_doc

from tracker.rescue.annotation_ui import AnnotationApp
from tracker.rescue.annotations import AnnotationSession
from tracker.rescue.box_motion import BoxMotionTracker, _flow_box, advance_box
from tracker.rescue.correction_workflow import complete_video_run, prepare_correction_project
from tracker.rescue.frame_tracking import merge_tracking, track_frames
from tracker.rescue.managed_models import save_trained_model
from tracker.rescue.model_library import ModelLibrary
from tracker.rescue.suggestions import load_suggestions, merge_suggestions, scoped_suggestion
from tracker.rescue.training_guide import discover_saved_videos
from tracker.rescue.training_workflow import load_training_state


@pytest.mark.parametrize("size,shift", [(8, 4), (20, 8), (24, 24)])
def test_flat_small_boxes_and_larger_moves_that_flow_alone_cannot_follow(
    size: int, shift: int
) -> None:
    first = np.zeros((140, 180), dtype=np.uint8)
    first[40 : 40 + size, 40 : 40 + size] = 190
    second = np.zeros_like(first)
    second[40 : 40 + size, 40 + shift : 40 + size + shift] = 190
    box = (40.0, 40.0, 40.0 + size, 40.0 + size)
    assert _flow_box(first, second, box)[0] is None
    moved, support, reason = advance_box(first, second, box)
    assert moved is not None, reason
    np.testing.assert_allclose(moved, (40 + shift, 40, 40 + size + shift, 40 + size), atol=1)
    assert support > 0.9


def test_ambiguous_twins_and_disappearance_do_not_create_confident_tracks() -> None:
    first = np.zeros((120, 160), dtype=np.uint8)
    first[40:56, 60:76] = 190
    blank = np.zeros_like(first)
    assert advance_box(first, blank, (60, 40, 76, 56))[0] is None
    twins = blank.copy()
    twins[40:56, 44:60] = 190
    twins[40:56, 80:96] = 190
    moved, _, reason = advance_box(first, twins, (60, 40, 76, 56))
    assert moved is None and "ambiguous" in reason


def test_static_flat_object_keeps_position_through_a_range() -> None:
    frame = np.zeros((120, 160), dtype=np.uint8)
    frame[40:60, 50:80] = 160
    motion = BoxMotionTracker(frame, (50, 40, 80, 60))
    for _ in range(25):
        moved, _, reason = motion.advance(frame)
        assert moved is not None, reason
        np.testing.assert_allclose(moved, (50, 40, 80, 60), atol=0.2)


def test_motion_checks_use_a_local_region_not_a_full_frame_per_box(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    image = np.zeros((1080, 1920), dtype=np.uint8)
    image[400:420, 800:820] = np.random.default_rng(7).integers(30, 220, (20, 20), dtype=np.uint8)
    original = cv2.goodFeaturesToTrack
    shapes = []

    def checked(source, *args, **kwargs):
        shapes.append(source.shape)
        return original(source, *args, **kwargs)

    monkeypatch.setattr(cv2, "goodFeaturesToTrack", checked)
    advance_box(image, image, (800, 400, 820, 420))
    assert shapes and max(shapes[0]) < 100


def test_imported_yolo_track_is_editable_and_correction_updates_following_drafts(
    tmp_path: Path,
) -> None:
    path = make_project(tmp_path, "video", "unassigned")
    doc = read_doc(path)
    doc.frames = []
    suggestions = load_suggestions(make_run(tmp_path / "run", doc), doc)
    doc, _, _ = merge_suggestions(doc, suggestions)
    keys = [frame.box_links[0].track_key for frame in doc.frames]
    assert len(set(keys)) == 1
    assert all(frame.box_links[0].origin == "predicted" for frame in doc.frames)
    session = AnnotationSession(doc, path)
    session.apply_tag(0, "smoke", 0)
    before = session.document.model_copy(deep=True)
    updated, changes = merge_tracking(before, track_frames(before, 0, 3, [0], method="fixed"))
    assert changes.replaced == 3 and not changes.added
    assert all(frame.objects[0].label == "smoke" for frame in updated.frames)
    assert all(not frame.reviewed for frame in updated.frames)
    session.replace_document(updated)
    assert session.undo() and session.document == before
    scoped = scoped_suggestion(suggestions.frames[0], ["fire"])
    assert scoped.box_links[0].track_key == keys[0]


def test_correction_project_is_managed_resumable_and_keeps_human_edits(tmp_path: Path) -> None:
    path = make_project(tmp_path, "video", "unassigned")
    doc = read_doc(path)
    run = make_run(tmp_path / "run", doc)
    version = save_trained_model(tmp_path, completed_run(tmp_path))
    project = prepare_correction_project(tmp_path, Path(doc.source.path), run, version.id)
    assert project.is_relative_to(tmp_path / "annotations/corrections")
    session = AnnotationSession.open(project, doc.source)
    session.replace_frame(0, [], reviewed=True)
    session.save()
    assert prepare_correction_project(tmp_path, Path(doc.source.path), run, version.id) == project
    corrected = next(frame for frame in read_doc(project).frames if frame.frame_index == 0)
    assert not corrected.objects and corrected.reviewed
    state = load_training_state(project)
    assert state.correction_model_id == version.id
    assert state.weights == version.config.models[0].weights
    assert project in [video.path for video in discover_saved_videos(tmp_path, [])]
    assert read_doc(path) == doc


def test_partial_run_cannot_be_misrepresented_as_full_video(tmp_path: Path) -> None:
    (tmp_path / "review-one").mkdir()
    (tmp_path / "review-one/summary.json").write_text('{"status":"frame_limit_reached"}')
    with pytest.raises(ValueError, match="not completed"):
        complete_video_run(tmp_path)


def test_refresh_replaces_only_pristine_predictions_including_empty_frames(tmp_path: Path) -> None:
    path = make_project(tmp_path, "video", "unassigned")
    doc = read_doc(path)
    doc.frames = []
    run = make_run(tmp_path / "run", doc)
    suggestions = load_suggestions(run, doc)
    doc, _, _ = merge_suggestions(doc, suggestions)
    session = AnnotationSession(doc, path)
    session.replace_frame(0, [], reviewed=False)
    session.replace_frame(1, session.frame(1).objects, reviewed=True)
    before = session.document.model_copy(deep=True)
    changed = suggestions.frames[2].model_copy(deep=True)
    changed.objects, changed.box_links = [], {}
    suggestions.frames[2] = changed
    updated, count, _ = merge_suggestions(before, suggestions, refresh_machine=True)
    assert count == 2
    by_index = {frame.frame_index: frame for frame in updated.frames}
    assert by_index[0] == session.frame(0)
    assert by_index[1] == session.frame(1)
    assert not by_index[2].objects and by_index[2].prediction_draft
    original = load_suggestions(run, doc)
    again, count, _ = merge_suggestions(updated, original, refresh_machine=True)
    assert count == 2
    assert next(frame for frame in again.frames if frame.frame_index == 2).objects
    legacy = again.model_copy(deep=True)
    for frame in legacy.frames:
        frame.prediction_draft = False
    assert merge_suggestions(legacy, original, refresh_machine=True)[1] == 0


def test_machine_ids_break_at_gaps_or_class_changes_and_unlinked_boxes_stay_drafts(
    tmp_path: Path,
) -> None:
    doc = read_doc(make_project(tmp_path, "video", "unassigned"))
    doc.frames = []
    run = make_run(tmp_path / "run", doc)
    records = [json.loads(line) for line in (run / "frames.jsonl").read_text().splitlines()]
    records[1]["observations"][0]["label"] = "smoke"
    records[2]["observations"][0]["tracker_id"] = None
    (run / "frames.jsonl").write_text("\n".join(map(json.dumps, records)) + "\n")
    suggestions = load_suggestions(run, doc)
    assert len({frame.box_links[0].track_key for frame in suggestions.frames}) == 4
    assert all(frame.objects[0].object_id is None for frame in suggestions.frames)
    updated, _, _ = merge_suggestions(doc, suggestions)
    assert merge_suggestions(updated, suggestions, refresh_machine=True)[1] == 4
    records[1]["observations"] = []
    records[2]["observations"] = []
    (run / "frames.jsonl").write_text("\n".join(map(json.dumps, records)) + "\n")
    suggestions = load_suggestions(run, doc)
    assert (
        suggestions.frames[0].box_links[0].track_key != suggestions.frames[3].box_links[0].track_key
    )


def test_stopped_correction_preparation_keeps_existing_saved_project(tmp_path: Path) -> None:
    path = make_project(tmp_path, "video", "unassigned")
    doc = read_doc(path)
    run = make_run(tmp_path / "run", doc)
    version = save_trained_model(tmp_path, completed_run(tmp_path))
    project = prepare_correction_project(tmp_path, Path(doc.source.path), run, version.id)
    before = project.read_bytes()
    with pytest.raises(ValueError, match="stopped"):
        prepare_correction_project(
            tmp_path, Path(doc.source.path), run, version.id, stopped=lambda: True
        )
    assert project.read_bytes() == before


def test_reanalysis_retains_unambiguous_track_links_to_the_corrected_seed(tmp_path: Path) -> None:
    path = make_project(tmp_path, "video", "unassigned")
    doc = read_doc(path)
    doc.frames = []
    run = make_run(tmp_path / "run", doc)
    suggestions = load_suggestions(run, doc)
    doc, _, _ = merge_suggestions(doc, suggestions)
    session = AnnotationSession(doc, path)
    session.apply_tag(0, "smoke", 0)
    original_key = session.frame(0).box_links[0].track_key
    metadata = json.loads((run / "summary.json").read_bytes())
    metadata["timing_note"] = "new inference pass"
    (run / "summary.json").write_text(json.dumps(metadata))
    fresh = load_suggestions(run, doc)
    assert fresh.frames[1].box_links[0].track_key != original_key
    refreshed, _, _ = merge_suggestions(session.document, fresh, refresh_machine=True)
    assert all(frame.box_links[0].track_key == original_key for frame in refreshed.frames)
    updated, changes = merge_tracking(refreshed, track_frames(refreshed, 0, 3, [0], method="fixed"))
    assert changes.replaced == 3
    assert all(frame.objects[0].label == "smoke" for frame in updated.frames)


@pytest.mark.parametrize("outcome", ["failed", "stopped"])
def test_failed_or_stopped_analysis_does_not_handoff_labels(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, outcome: str
) -> None:
    from tracker.cli import rescue_correct

    stop, receipt = tmp_path / "stop", tmp_path / "receipt.json"
    monkeypatch.setattr(ModelLibrary, "config_path", lambda *a: tmp_path / "config.yaml")

    def review(args):
        assert args.max_frames == 0
        if outcome == "stopped":
            stop.touch()
        return 1 if outcome == "failed" else 0

    monkeypatch.setattr(rescue_correct, "run", review)
    monkeypatch.setattr(
        rescue_correct, "prepare_correction_project", lambda *a, **k: pytest.fail("no handoff")
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "rescue_correct",
            "--workspace",
            str(tmp_path),
            "--video",
            str(tmp_path / "video.avi"),
            "--model-id",
            "0" * 32,
            "--output",
            str(tmp_path),
            "--result-file",
            str(receipt),
            "--stop-file",
            str(stop),
        ],
    )
    with pytest.raises(SystemExit) as exc:
        rescue_correct.main()
    assert exc.value.code == 1 and not receipt.exists()


def test_full_video_button_uses_selected_version_and_imports_without_folder_picker(
    studio: AnnotationApp,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    quick = studio.training_panel.quick
    result = completed_run(quick.workspace)
    quick.refresh_models(result)
    finish(studio)
    version = quick.shelf.selected()
    assert version is not None
    runs = []
    monkeypatch.setattr(
        "tkinter.filedialog.askdirectory", lambda **k: pytest.fail("no folder picker")
    )

    def capture(*args, **kwargs):
        runs.append(args)
        raise ValueError("captured")

    monkeypatch.setattr("tracker.rescue.quick_training_ui.DesktopJob", capture)
    monkeypatch.setattr(studio.training_panel, "error", lambda _: None)
    quick.analyze_button.invoke()
    assert runs[0][1] == "tracker.cli.rescue_correct"
    arguments = runs[0][2]
    assert arguments[arguments.index("--model-id") + 1] == version.id
    assert arguments[arguments.index("--project") + 1] == str(studio.session.path.resolve())
    run = make_run(quick.workspace / "full-run", studio.session.document)
    before = studio.session.document.model_copy(deep=True)
    studio.open_corrections(studio.session.path, run, version.id)
    deadline = time.monotonic() + 5
    while studio.import_busy and time.monotonic() < deadline:
        studio.root.update()
        time.sleep(0.01)
    assert not studio.import_busy
    assert studio.session.document == before
    assert studio.correction_bar.winfo_manager() == "pack"
    invocations = []
    monkeypatch.setattr(
        quick, "train", lambda: invocations.append(studio.training_panel.weights.get())
    )
    studio.train_corrections_button.invoke()
    assert invocations == [version.config.models[0].weights]
    assert ModelLibrary(quick.workspace).catalog.active_id is None
