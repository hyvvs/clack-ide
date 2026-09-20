from __future__ import annotations

import time
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from test_rescue_training import make_project, make_run

from tracker.rescue.annotation_ui import AnnotationApp
from tracker.rescue.annotations import AnnotationSession, BoxLink
from tracker.rescue.library import Library, LibraryItem, ProjectInfo, RunInfo
from tracker.rescue.media import FrameReader
from tracker.rescue.project_boxes_ui import ProjectBoxesWindow
from tracker.rescue.range_tools_ui import BulkReviewWindow, ClipExportWindow
from tracker.rescue.studio_home import StudioHome
from tracker.rescue.studio_state import load_position, save_position
from tracker.rescue.suggestions import load_suggestions
from tracker.rescue.training_data import verify_dataset


@pytest.fixture(scope="module")
def desktop_root() -> Iterator[Any]:
    import tkinter as tk

    try:
        root = tk.Tk()
    except tk.TclError as exc:
        pytest.skip(f"Tk desktop runtime unavailable: {exc}")
    root.withdraw()
    original_toplevel = tk.Toplevel.__init__

    def hidden_toplevel(window, *args, **kwargs):
        original_toplevel(window, *args, **kwargs)
        window.withdraw()

    with pytest.MonkeyPatch.context() as desktop_patch:
        desktop_patch.setattr(tk.Toplevel, "__init__", hidden_toplevel)
        try:
            yield root
        finally:
            root.destroy()


@pytest.fixture
def studio(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, desktop_root: Any
) -> Iterator[AnnotationApp]:
    root = desktop_root
    path = make_project(tmp_path, "train", "training")
    reader = FrameReader(tmp_path / "train.avi")
    session = AnnotationSession.open(path, reader.source)
    monkeypatch.setattr(
        "tracker.rescue.annotation_ui.messagebox.askyesno", lambda *args, **kwargs: True
    )
    monkeypatch.setattr(
        "tracker.rescue.annotation_ui.messagebox.showinfo", lambda *args, **kwargs: None
    )
    errors: list[BaseException] = []
    root.report_callback_exception = lambda kind, value, trace: errors.append(value)
    app = AnnotationApp(root, reader, session)
    monkeypatch.setattr(app.canvas, "winfo_width", lambda: 640)
    monkeypatch.setattr(app.canvas, "winfo_height", lambda: 480)
    app.draw()
    try:
        yield app
        root.update()
        assert not errors
    finally:
        for callback in root.tk.call("after", "info"):
            root.tk.call("after", "cancel", callback)
        reader.close()
        for child in root.winfo_children():
            child.destroy()


def point(app: AnnotationApp, x: float, y: float) -> SimpleNamespace:
    return SimpleNamespace(
        x=round(x * app.scale + app.offset[0]), y=round(y * app.scale + app.offset[1])
    )


def test_playback_runs_without_tracking_or_review_writes(studio: AnnotationApp) -> None:
    app = studio
    app.root.update()
    app.carry.enabled.set(True)
    original = app.session.document.model_dump_json()
    app.media.speed.set("4x")
    app.media.button.invoke()
    deadline = time.monotonic() + 3
    while app.media.playing and time.monotonic() < deadline:
        app.root.update()
        time.sleep(0.01)
    assert app.index == 3 and not app.media.playing
    assert app.session.document.model_dump_json() == original
    assert not app.carry.busy
    assert "frame 3" in app.media.clock.get()
    app.media.button.invoke()
    assert app.media.playing and app.index == 0
    app.go(2)
    assert not app.media.playing and app.index == 2


def test_playback_pauses_before_drawing_and_tools(studio: AnnotationApp) -> None:
    app = studio
    app.root.update()
    app.media.toggle()
    app.start_box(point(app, 30, 30))
    assert not app.media.playing and app.box_drag is not None
    app.finish_box(point(app, 30, 30))
    app.media.toggle()
    app.open_project_tool("boxes")
    assert not app.media.playing
    window = app.project_windows["boxes"]
    assert isinstance(window, ProjectBoxesWindow)
    assert window.state() == "withdrawn"
    assert len(window.rows) == 3
    window.table.selection_set("2")
    window.open_selected()
    assert app.index == 3 and app.selected == 0
    app.session.replace_frame(3, [])
    window.open_selected()
    assert "Labels changed" in window.summary.get()
    assert len(window.rows) == 2


def test_playback_stops_cleanly_on_decode_failure(
    studio: AnnotationApp,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = studio
    app.root.update()

    def failed_read(index):
        raise ValueError("Video changed")

    monkeypatch.setattr(app.reader, "read", failed_read)
    app.media.toggle()
    deadline = time.monotonic() + 2
    while app.media.playing and time.monotonic() < deadline:
        app.root.update()
        time.sleep(0.01)
    assert not app.media.playing
    assert "Video changed" in app.status.get()
    assert app.index == 0


def test_bulk_thumbnail_review_confirmation_undo_and_stale_guard(
    studio: AnnotationApp,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = studio
    app.mark_draft()
    app.open_project_tool("review")
    window = app.project_windows["review"]
    assert isinstance(window, BulkReviewWindow)
    assert window.state() == "withdrawn"
    assert window.ready and window.indices == [0, 1, 2, 3]
    assert len(window.photos) == 4
    original = app.session.document.model_dump_json()
    monkeypatch.setattr("tkinter.messagebox.askyesno", lambda *a, **kw: False)
    window.apply(True, True)
    assert app.session.document.model_dump_json() == original
    monkeypatch.setattr("tkinter.messagebox.askyesno", lambda *a, **kw: True)
    window.apply(True, True)
    assert all(frame.reviewed for frame in app.session.document.frames)
    app.undo()
    assert app.session.document.model_dump_json() == original
    window.apply(True, True)
    assert "Thumbnails refreshed" in window.status.get()
    assert app.session.document.model_dump_json() == original
    window.apply(True, True)
    assert all(frame.reviewed for frame in app.session.document.frames)


def test_bulk_review_excludes_unreviewed_empty_and_attention_frames(studio: AnnotationApp) -> None:
    app = studio
    app.session.replace_frame(0, [])
    doc = app.session.document.model_copy(deep=True)
    frame = next(frame for frame in doc.frames if frame.frame_index == 3)
    frame.box_links[0] = BoxLink(track_key="f" * 32, needs_attention="Check position")
    app.session.replace_document(doc)
    window = BulkReviewWindow(app)
    window.apply(True, False)
    assert not app.session.frame(0).reviewed
    assert not app.session.frame(3).reviewed
    assert "empty frames excluded" in window.status.get()
    window.include_empty.set(True)
    window.apply(True, False)
    assert app.session.frame(0).reviewed
    assert not app.session.frame(3).reviewed
    assert app.session.frame(3).box_links[0].needs_attention


def test_clip_export_from_hidden_ui_keeps_original_and_opens_only_on_request(
    studio: AnnotationApp,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = studio
    app.open_project_tool("clip")
    window = app.project_windows["clip"]
    assert isinstance(window, ClipExportWindow)
    assert window.state() == "withdrawn"
    app.go(1)
    window.mark_current(window.start)
    app.go(2)
    window.mark_current(window.end)
    window.output.set(str(tmp_path / "clips"))
    original = app.session.document.model_dump_json()
    window.start_export()
    deadline = time.monotonic() + 10
    while window.busy and time.monotonic() < deadline:
        app.root.update()
        time.sleep(0.01)
    assert not window.busy and window.result is not None, window.status.get()
    assert window.result.is_file()
    assert app.session.document.model_dump_json() == original
    assert not app.validation_windows
    assert "Audio not included" in window.status.get()
    opened = []
    monkeypatch.setattr(
        "tracker.rescue.range_tools_ui.DesktopJob",
        lambda *args: opened.append(args) or SimpleNamespace(poll=lambda: None),
    )
    window.open_button.invoke()
    assert len(opened) == 1
    assert str(window.result) in opened[0][2]
    window.open_button.invoke()
    assert len(opened) == 1


def test_new_toolbar_requested_width_fits_minimum_window(studio: AnnotationApp) -> None:
    studio.root.update_idletasks()
    assert studio.media.winfo_reqwidth() <= 980


def test_canvas_click_move_resize_and_undo(studio: AnnotationApp) -> None:
    app = studio
    original = app.session.frame(0).objects[0].bbox_xyxy
    app.start_box(point(app, 30, 30))
    app.finish_box(point(app, 30, 30))
    assert app.selected == 0 and app.session.frame(0).reviewed
    app.start_box(point(app, 30, 30))
    app.drag_box(point(app, 34, 36))
    app.finish_box(point(app, 34, 36))
    assert app.session.frame(0).objects[0].bbox_xyxy == (16, 18, 52, 66)
    assert not app.session.frame(0).reviewed
    app.start_box(point(app, 52, 66))
    app.finish_box(point(app, 58, 70))
    assert app.session.frame(0).objects[0].bbox_xyxy == (16, 18, 58, 70)
    app.undo()
    app.undo()
    assert app.session.frame(0).objects[0].bbox_xyxy == original
    assert app.session.frame(0).reviewed


def test_existing_labels_need_explicit_prediction_adoption(
    studio: AnnotationApp, tmp_path: Path
) -> None:
    app = studio
    original = app.session.frame(0)
    suggestions = load_suggestions(
        make_run(tmp_path / "run", app.session.document), app.session.document
    )
    app.finish_import(suggestions)
    assert app.session.frame(0) == original
    app.adopt_predictions()
    assert app.session.frame(0).objects[0].bbox_xyxy == (10, 10, 50, 64)
    assert not app.session.frame(0).reviewed
    app.undo()
    assert app.session.frame(0) == original


def test_typed_box_class_addition_and_draw_inside_existing(studio: AnnotationApp) -> None:
    app = studio
    app.draw_mode.set(True)
    app.label.set("dense smoke")
    app.start_box(point(app, 20, 20))
    app.finish_box(point(app, 40, 40))
    assert len(app.session.frame(0).objects) == 2
    assert app.session.frame(0).objects[1].label == "dense smoke"
    assert not any(frame.reviewed for frame in app.session.document.frames)


def test_training_assignment_survives_subsequent_save(studio: AnnotationApp) -> None:
    app = studio
    panel = app.training_panel
    panel.refresh()
    panel.table.selection_set("0")
    panel.select_project()
    panel.incident.set("new group")
    panel.split.set("validation")
    panel.assign()
    app.root.update()
    assert app.incident.get() == "new group"
    assert app.split.get() == "validation"
    assert app.save()
    assert app.session.document.incident_id == "new group"
    assert app.session.document.split == "validation"


def test_guided_export_runs_without_blocking_the_ui(
    studio: AnnotationApp, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    second = make_project(tmp_path, "validation", "validation", 50)
    panel = studio.training_panel
    panel.paths.append(second)
    monkeypatch.setattr(
        "tracker.rescue.training_panel.filedialog.askdirectory",
        lambda **kwargs: str(tmp_path / "exports"),
    )
    panel.export()
    deadline = time.monotonic() + 15
    while panel.busy and time.monotonic() < deadline:
        studio.root.update()
        time.sleep(0.02)
    assert not panel.busy
    assert verify_dataset(Path(panel.dataset.get()))["frames"] == {"train": 3, "val": 3}


def test_tag_button_relabels_selected_box_and_preserves_selection(studio: AnnotationApp) -> None:
    app = studio
    app.objects.selection_set(0)
    app.select_object()
    original = app.session.frame(0)
    app.apply_tag("dense smoke")
    assert app.selected == 0 and app.session.frame(0).objects[0].label == "dense smoke"
    assert app.session.frame(0).objects[0].bbox_xyxy == original.objects[0].bbox_xyxy
    app.tag_buttons.winfo_children()[0].invoke()
    assert app.session.frame(0).objects[0].label == "fire"
    app.undo()
    app.undo()
    assert app.session.frame(0) == original


def test_tag_scope_cancel_keeps_boxes_and_review_status(
    studio: AnnotationApp, monkeypatch: pytest.MonkeyPatch
) -> None:
    app = studio
    original = app.session.document.model_copy(deep=True)
    monkeypatch.setattr("tracker.rescue.annotation_ui.messagebox.askyesno", lambda *a, **k: False)
    app.objects.selection_set(0)
    app.select_object()
    app.apply_tag("smoke")
    assert app.session.document == original


def test_create_tag_without_box_then_draw(studio: AnnotationApp) -> None:
    app = studio
    app.apply_tag("floating debris")
    assert len(app.session.frame(0).objects) == 1
    assert app.label.get() == "floating debris"
    app.start_box(point(app, 60, 60))
    app.finish_box(point(app, 85, 85))
    assert app.session.frame(0).objects[-1].label == "floating debris"
    assert app.selected == 1
    app.apply_tag("fire")
    assert app.session.frame(0).objects[-1].label == "fire"
    app.clear_selection()
    app.apply_tag("floating debris")
    assert app.selected is None and app.session.frame(0).objects[-1].label == "fire"


def test_save_remembers_position_without_training(studio: AnnotationApp) -> None:
    app = studio
    app.go(2)
    assert app.save()
    assert load_position(app.session.path, app.reader.source).frame_index == 2
    assert str(app.tabs.select()) == str(app.tabs.tabs()[0])


def test_editor_initializes_at_saved_frame(tmp_path: Path, desktop_root: Any) -> None:
    path = make_project(tmp_path, "resume", "training")
    reader = FrameReader(tmp_path / "resume.avi")
    save_position(path, reader.source, 2, "fire")
    app = AnnotationApp(desktop_root, reader, AnnotationSession.open(path, reader.source))
    try:
        assert app.index == 2 and app.jump_index.get() == "2"
        assert app.session.frame(2).objects[0].label == "fire"
        assert str(app.tabs.select()) == str(app.tabs.tabs()[0])
    finally:
        for callback in desktop_root.tk.call("after", "info"):
            desktop_root.tk.call("after", "cancel", callback)
        reader.close()
        for child in desktop_root.winfo_children():
            child.destroy()


@pytest.fixture
def home(
    tmp_path: Path, desktop_root: Any, monkeypatch: pytest.MonkeyPatch
) -> Iterator[StudioHome]:
    monkeypatch.setattr(StudioHome, "refresh", lambda self: None)
    app = StudioHome(desktop_root, tmp_path)
    project_path = make_project(tmp_path, "review", "training")
    reader = FrameReader(tmp_path / "review.avi")
    project = ProjectInfo(project_path, ("fire",), 3, 1, 4, reader.source.sha256)
    item = LibraryItem(
        reader.path, reader.source.sha256, "test", [project], [RunInfo(tmp_path / "run", 4, True)]
    )
    reader.close()
    app.library = Library([item], [])
    app.render_library()
    try:
        yield app
    finally:
        for callback in desktop_root.tk.call("after", "info"):
            desktop_root.tk.call("after", "cancel", callback)
        for child in desktop_root.winfo_children():
            child.destroy()


def test_continue_labeling_never_imports_or_trains(
    home: StudioHome, monkeypatch: pytest.MonkeyPatch
) -> None:
    launches = []
    monkeypatch.setattr(home, "launch_editor", lambda path, args: launches.append((path, args)))
    home.label_button.invoke()
    assert home.label_button.cget("text") == "Continue labeling"
    assert len(launches) == 1
    assert "--project" in launches[0][1]
    assert "--training" not in launches[0][1] and "--suggestions" not in launches[0][1]
    home.import_predictions_button.invoke()
    assert "--suggestions" in launches[1][1] and "--training" not in launches[1][1]
    home.train_button.invoke()
    assert "--training" in launches[2][1] and "--suggestions" not in launches[2][1]


def test_resume_project_picker_opens_saved_boxes_directly(
    home: StudioHome, monkeypatch: pytest.MonkeyPatch
) -> None:
    item = home.library.items[0]
    launches = []
    monkeypatch.setattr(
        "tracker.rescue.studio_home.filedialog.askopenfilename",
        lambda **kw: str(item.projects[0].path),
    )
    monkeypatch.setattr(home, "launch_editor", lambda path, args: launches.append((path, args)))
    home.resume_project()
    assert launches == [
        (
            item.projects[0].path,
            ["--video", str(item.video), "--project", str(item.projects[0].path)],
        )
    ]


def test_filter_empty_state_disables_labeling_and_prediction_import(home: StudioHome) -> None:
    home.search.set("missing clip")
    assert home.current() is None
    assert home.label_button.instate(["disabled"])
    assert home.import_predictions_button.instate(["disabled"])
