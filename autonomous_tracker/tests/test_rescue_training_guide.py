from __future__ import annotations

import time
from pathlib import Path

import pytest
from test_rescue_studio_ui import desktop_root as desktop_root
from test_rescue_studio_ui import studio as studio
from test_rescue_training import make_project, read_doc

from tracker.rescue.annotation_ui import AnnotationApp
from tracker.rescue.annotations import AnnotationSession
from tracker.rescue.media import file_sha256
from tracker.rescue.model_library import ModelLibrary
from tracker.rescue.training_data import read_projects, verify_dataset
from tracker.rescue.training_guide import (
    StartingModel,
    assign_purpose,
    discover_saved_videos,
    load_saved_video,
    setup_issues,
    starting_models,
    suggested_group,
    workspace_for,
)
from tracker.rescue.training_guide_ui import PurposeDialog
from tracker.rescue.training_panel import TrainingPanel
from tracker.rescue.training_workflow import load_training_state


def test_picker_discovery_excludes_backups_exports_and_provenance(tmp_path: Path) -> None:
    root = tmp_path / "annotations"
    root.mkdir()
    (tmp_path / "configs").mkdir()
    live = make_project(root, "smoke", "training")
    session = AnnotationSession.open(live, read_doc(live).source)
    session.replace_frame(3, [])
    session.save()
    session.export()
    (root / "clip-origin.json").write_text('{"original_video": "smoke.avi"}')
    (root / "broken.json").write_text("invalid")
    (root / ".hidden.json").write_bytes(live.read_bytes())
    before = live.read_bytes()
    videos = discover_saved_videos(tmp_path, [live])
    assert [video.path for video in videos] == [live]
    assert videos[0].title == "smoke.avi" and videos[0].reviewed == 3
    assert live.read_bytes() == before
    assert workspace_for(live) == tmp_path


def test_nested_clips_and_external_saved_projects_are_discovered(tmp_path: Path) -> None:
    root = tmp_path / "annotations/clips/clip-0-3-example"
    root.mkdir(parents=True)
    clip = make_project(root, "clip", "unassigned")
    external = tmp_path / "other-folder"
    external.mkdir()
    other = make_project(external, "other", "unassigned", 70)
    assert {video.path for video in discover_saved_videos(tmp_path, [other])} == {clip, other}


def test_purpose_has_a_default_without_changing_any_labels(tmp_path: Path) -> None:
    path = make_project(tmp_path, "clip", "unassigned")
    video = load_saved_video(path)
    video.document.incident_id = ""
    before = video.document.model_dump_json()
    group = suggested_group(video, [video])
    assert group.startswith("recording-")
    changed = assign_purpose(video, [video], "training", group)
    assert changed.split == "training" and changed.incident_id == group
    assert changed.frames == video.document.frames
    assert video.document.model_dump_json() == before
    assert read_doc(path).split == "unassigned"


@pytest.mark.parametrize("relationship", ["same_source", "clip", "event"])
def test_guided_assignment_keeps_related_footage_together(
    tmp_path: Path, relationship: str
) -> None:
    first = load_saved_video(make_project(tmp_path, "train", "training"))
    second = load_saved_video(make_project(tmp_path, "check", "unassigned", 70))
    second.document.incident_id = ""
    group = "different"
    if relationship == "same_source":
        second.document.source.sha256 = first.document.source.sha256
    elif relationship == "clip":
        second.document.source_ancestors = [first.document.source.sha256]
    else:
        group = "  TRAIN  "
    if relationship != "event":
        assert suggested_group(second, [first, second]) == "train"
    with pytest.raises(ValueError, match="same recording or event"):
        assign_purpose(second, [first, second], "validation", group)
    assert assign_purpose(second, [first, second], "training", group).split == "training"


def test_readiness_catches_all_missing_steps_not_just_first(tmp_path: Path) -> None:
    video = load_saved_video(make_project(tmp_path, "clip", "unassigned"))
    for frame in video.document.frames:
        frame.reviewed = False
    issues = setup_issues([video])
    messages = " ".join(issue.message for issue in issues)
    assert "no frames approved" in messages
    assert "choose 'Teach the model'" in messages
    assert "different, approved recording" in messages
    assert {issue.action for issue in issues} == {"review", "purpose", "videos"}


def test_readiness_agrees_with_export_and_reports_scope_and_source_errors(tmp_path: Path) -> None:
    paths = [
        make_project(tmp_path, "teach", "training"),
        make_project(tmp_path, "check", "validation", 70),
    ]
    videos = [load_saved_video(path) for path in paths]
    assert not setup_issues(videos)
    assert len(read_projects(paths)) == 2
    assert any("twice" in issue.message for issue in setup_issues([*videos, videos[0]]))
    videos[1].document.classes.append("smoke")
    assert any(issue.action == "tags" for issue in setup_issues(videos))
    videos[0].document.classes.append("smoke")
    assert any("no approved examples" in issue.message for issue in setup_issues(videos))
    videos[1].document.source.path = str(tmp_path / "missing.avi")
    assert any("file is missing" in issue.message for issue in setup_issues(videos))


def test_guided_training_is_default_and_open_project_already_selected(
    studio: AnnotationApp,
) -> None:
    panel = studio.training_panel
    panel.refresh()
    guide = panel.guide
    assert panel.views.select() == str(panel.quick)
    assert guide.selected_path() == studio.session.path.resolve()
    assert "open project is included" in guide.summary.get()
    assert guide.table.item(str(studio.session.path), "values") == (
        "train.avi",
        "Teach the model",
        "3 / 4",
    )
    assert guide.prepare_button.instate(["disabled"])
    panel.show_advanced()
    assert panel.views.index("current") == 2
    panel.show_checks()
    assert panel.views.index("current") == 1
    assert studio.root.state() == "withdrawn"


def test_gui_picker_uses_saved_videos_not_file_dialogs(
    studio: AnnotationApp, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    panel = studio.training_panel
    second = make_project(tmp_path, "check", "validation", 70)
    (tmp_path / "check.backup-aabbccdd.json").write_bytes(second.read_bytes())
    (tmp_path / "clip-origin.json").write_text("{}")
    monkeypatch.setattr(
        "tracker.rescue.training_panel.filedialog.askopenfilenames",
        lambda **_: pytest.fail("guided picker must not ask for JSON"),
    )
    monkeypatch.setattr("tracker.rescue.training_guide_ui.workspace_for", lambda _: tmp_path)
    panel.refresh()
    panel.add_projects()
    picker = panel.picker
    assert picker is not None and picker.state() == "withdrawn"
    deadline = time.monotonic() + 5
    while picker.scanning and time.monotonic() < deadline:
        studio.root.update()
        time.sleep(0.01)
    assert not picker.scanning
    assert [video.path for video in picker.rows.values()] == [second]
    picker.table.selection_set(next(iter(picker.rows)))
    picker.accept()
    assert panel.paths == [studio.session.path, second]
    assert not picker.winfo_exists()
    assert not panel.guide.issues
    assert panel.guide.prepare_button.instate(["!disabled"])


def test_gui_purpose_dialog_saves_defaults_and_syncs_editor(studio: AnnotationApp) -> None:
    panel = studio.training_panel
    panel.refresh()
    before = studio.session.document.frames.copy()
    panel.guide.choose_purpose("validation")
    dialog = panel.guide.dialog
    assert isinstance(dialog, PurposeDialog)
    assert dialog.recording.get() == "train"
    assert dialog.state() == "withdrawn"
    dialog.save()
    studio.root.update()
    assert not dialog.winfo_exists()
    assert read_doc(studio.session.path).split == "validation"
    assert studio.split.get() == "validation"
    assert studio.session.document.frames == before
    studio.save()
    assert read_doc(studio.session.path).split == "validation"


def test_gui_default_export_prepares_without_file_choices(
    studio: AnnotationApp, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    panel = studio.training_panel
    second = make_project(tmp_path, "check", "validation", 70)
    assert panel.include_projects([second])
    monkeypatch.setattr(
        "tracker.rescue.training_panel.filedialog.askdirectory",
        lambda **_: pytest.fail("guided prepare must use a managed output folder"),
    )
    errors = []
    monkeypatch.setattr(panel, "error", lambda exc: errors.append(str(exc)))
    panel.guide.checks()
    panel.guide.prepare_button.invoke()
    assert panel.export_busy
    assert panel.guide.prepare_button.instate(["disabled"])
    deadline = time.monotonic() + 10
    while panel.export_busy and time.monotonic() < deadline:
        studio.root.update()
        time.sleep(0.01)
    assert not panel.export_busy and not errors
    data = Path(panel.dataset.get())
    assert data.is_relative_to(studio.session.path.parent / "datasets")
    assert verify_dataset(data)["frames"] == {"train": 3, "val": 3}
    assert panel.guide.step == 2 and panel.export_is_current
    assert panel.process is None
    panel.weights.set("")
    assert panel.guide.start_button.instate(["disabled"])
    assert load_training_state(studio.session.path).dataset == str(data)
    restored = TrainingPanel(studio.tabs, studio.session, studio.save)
    restored.refresh()
    assert restored.dataset.get() == str(data) and restored.export_is_current
    studio.session.replace_frame(0, [])
    panel.guide.navigate(1)
    assert not panel.export_is_current
    assert panel.guide.continue_button.instate(["disabled"])
    assert "STALE EXPORT" in panel.export_status.get()


def test_gui_mixed_import_keeps_valid_project_and_explains_skipped_copy(
    studio: AnnotationApp, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    panel = studio.training_panel
    path = make_project(tmp_path, "check", "validation", 70)
    backup = tmp_path / "check.backup-aabbccdd.json"
    backup.write_bytes(path.read_bytes())
    notices = []
    monkeypatch.setattr(
        "tracker.rescue.training_panel.messagebox.showinfo", lambda *args, **_: notices.append(args)
    )
    assert panel.include_projects([path, backup, studio.session.path])
    assert panel.paths == [studio.session.path, path]
    assert notices and "backup" in notices[0][1]
    panel.guide.table.selection_set(str(path))
    before = path.read_bytes()
    panel.guide.remove_selected()
    assert path.read_bytes() == before and path not in panel.paths
    assert "not deleted" in panel.status.get()


def test_gui_review_action_returns_to_labels(studio: AnnotationApp) -> None:
    panel = studio.training_panel
    for frame in studio.session.document.frames:
        frame.reviewed = False
    studio.session.dirty = True
    panel.refresh()
    studio.tabs.select(panel)
    issue = next(issue for issue in panel.guide.issues if issue.action == "review")
    panel.guide.fix(issue)
    assert studio.tabs.index("current") == 0


def test_starting_model_names_are_read_without_loading_weights(tmp_path: Path) -> None:
    weights = tmp_path / "starter.pt"
    weights.write_bytes(b"synthetic non-model fixture; must not be loaded")
    config = tmp_path / "review.yaml"
    config.write_text(
        f"models:\n  - name: observation\n    weights: '{weights.as_posix()}'\n"
        "    classes: [fire]\nreview_classes: [fire]\n"
    )
    library = ModelLibrary(tmp_path)
    library.register("My starting model", config)
    choices = starting_models(tmp_path)
    assert choices == [StartingModel("My starting model", weights, file_sha256(weights))]
    assert library.catalog.active_id is None


def test_gui_saved_model_selection_checks_hash_and_never_activates(
    studio: AnnotationApp, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    panel = studio.training_panel
    weights = tmp_path / "starter.pt"
    weights.write_bytes(b"synthetic non-model fixture; no inference")
    choice = StartingModel("Saved starter", weights, file_sha256(weights))
    errors = []
    monkeypatch.setattr(panel, "error", lambda exc: errors.append(str(exc)))

    def finish() -> None:
        deadline = time.monotonic() + 5
        while panel.model_busy and time.monotonic() < deadline:
            studio.root.update()
            time.sleep(0.01)
        assert not panel.model_busy

    panel.use_saved_model(choice)
    assert panel.busy
    finish()
    assert not errors and panel.weights.get() == str(weights)
    assert panel.process is None and "Nothing was trained or activated" in panel.status.get()
    panel.weights.set("")
    weights.write_bytes(b"changed fixture")
    panel.use_saved_model(choice)
    finish()
    assert errors and "changed" in errors[0]
    assert not panel.weights.get()
