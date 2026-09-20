from __future__ import annotations

import json
import os
import shutil
import time
from pathlib import Path
from typing import Any

import pytest
from test_rescue_studio_ui import desktop_root as desktop_root
from test_rescue_studio_ui import home as home
from test_rescue_studio_ui import studio as studio
from test_rescue_training import make_project, make_run, read_doc

from tracker.cli.rescue_model_check import check_model, validation_document
from tracker.rescue.annotation_ui import AnnotationApp
from tracker.rescue.annotations import AnnotationSession
from tracker.rescue.library import LibraryItem, ProjectInfo, discover_library
from tracker.rescue.media import FrameReader, file_sha256
from tracker.rescue.studio_home import StudioHome
from tracker.rescue.training_data import export_dataset, verify_dataset, write_json
from tracker.rescue.training_panel import TrainingPanel
from tracker.rescue.training_workflow import (
    TrainingState,
    apply_shared_tags,
    export_issues,
    load_training_state,
    plan_shared_tags,
    require_fresh_export,
    save_training_state,
)


def test_library_ignores_saved_backups_and_truth(tmp_path: Path) -> None:
    directory = tmp_path / "annotations"
    directory.mkdir()
    path = make_project(directory, "clip", "training")
    doc = read_doc(path)
    session = AnnotationSession.open(path, doc.source)
    session.replace_frame(0, [])
    session.save()
    session.export()
    assert list(directory.glob("*.backup-*.json"))
    library = discover_library(tmp_path)
    assert not library.warnings
    assert len(library.items) == 1
    assert [project.path for project in library.items[0].projects] == [path]


def test_moved_video_save_without_edit_preserves_labels(tmp_path: Path) -> None:
    path = make_project(tmp_path, "clip", "training")
    before = read_doc(path)
    moved = tmp_path / "relocated.avi"
    shutil.copyfile(before.source.path, moved)
    reader = FrameReader(moved)
    try:
        session = AnnotationSession.open(path, reader.source)
        assert session.dirty
        session.save()
        assert read_doc(path).source.path == str(moved.resolve())
        assert read_doc(path).frames == before.frames
        assert list(tmp_path.glob("clip.backup-*.json"))
    finally:
        reader.close()


def test_relocated_source_still_checks_identity_and_save_conflicts(tmp_path: Path) -> None:
    path = make_project(tmp_path, "clip", "training")
    other = make_project(tmp_path, "other", "validation", 80)
    with pytest.raises(ValueError, match="SHA256"):
        AnnotationSession.open(path, read_doc(other).source)
    source = read_doc(path).source.model_copy(update={"path": "new-location.avi"})
    session = AnnotationSession.open(path, source)
    writer = AnnotationSession.open(path, read_doc(path).source)
    writer.replace_frame(0, [])
    writer.save()
    with pytest.raises(ValueError, match="changed on disk"):
        session.save()


@pytest.fixture
def exported(tmp_path: Path) -> tuple[list[Path], Path]:
    paths = [
        make_project(tmp_path, "train", "training"),
        make_project(tmp_path, "val", "validation", 50),
    ]
    return paths, export_dataset(paths, tmp_path / "exports")


@pytest.mark.parametrize("change", ["box", "review", "scope", "split", "incident"])
def test_changed_training_inputs_block_stale_exports(
    exported: tuple[list[Path], Path], change: str
) -> None:
    paths, data = exported
    doc = read_doc(paths[0])
    if change == "box":
        doc.frames[0].objects = []
    elif change == "review":
        doc.frames[0].reviewed = False
    elif change == "scope":
        doc.classes.append("smoke")
    elif change == "split":
        doc.split = "test"
    else:
        doc.incident_id = "different incident"
    AnnotationSession(doc, paths[0]).save()
    assert verify_dataset(data)["status"] == "complete"
    with pytest.raises(ValueError, match="STALE EXPORT"):
        require_fresh_export(data, paths)


def test_draft_only_edits_and_relocation_do_not_stale_export(
    exported: tuple[list[Path], Path],
) -> None:
    paths, data = exported
    doc = read_doc(paths[0])
    doc.frames[3].objects = []
    doc.source.path = str(paths[0].parent / "moved.avi")
    AnnotationSession(doc, paths[0]).save()
    assert not export_issues(data, paths)
    assert export_issues(data, paths[:1])


def test_export_detects_missing_live_project(exported: tuple[list[Path], Path]) -> None:
    paths, data = exported
    paths[1].rename(paths[1].with_suffix(".moved.json"))
    assert any("missing" in issue for issue in export_issues(data, paths))


def test_shared_tags_preserve_boxes_and_reset_only_changed_scopes(
    exported: tuple[list[Path], Path],
) -> None:
    paths, _ = exported
    first = AnnotationSession.open(paths[0], read_doc(paths[0]).source)
    before = [read_doc(path) for path in paths]
    changes = plan_shared_tags(paths, ["fire", "dense smoke"], first)
    assert len(changes) == 2
    apply_shared_tags(changes)
    for path, original in zip(paths, before, strict=True):
        doc = read_doc(path)
        assert doc.classes == ["dense smoke", "fire"]
        assert [frame.objects for frame in doc.frames] == [
            frame.objects for frame in original.frames
        ]
        assert not any(frame.reviewed for frame in doc.frames)
        assert list(path.parent.glob(f"{path.stem}.backup-*.json"))
    assert not plan_shared_tags(paths, ["fire", "dense smoke"], first)
    with pytest.raises(ValueError, match="cannot remove tags with boxes"):
        plan_shared_tags(paths, ["dense smoke"], first)


def test_shared_scope_writer_conflict_changes_no_files(exported: tuple[list[Path], Path]) -> None:
    paths, _ = exported
    current = AnnotationSession.open(paths[0], read_doc(paths[0]).source)
    changes = plan_shared_tags(paths, ["fire", "smoke"], current)
    other = AnnotationSession.open(paths[1], read_doc(paths[1]).source)
    other.replace_frame(0, [])
    other.save()
    hashes = [file_sha256(path) for path in paths]
    with pytest.raises(ValueError, match="changed on disk"):
        apply_shared_tags(changes)
    assert [file_sha256(path) for path in paths] == hashes
    assert current.document.classes == ["fire"]
    assert not list(paths[0].parent.glob(".*.lock"))


def test_shared_scope_busy_lock_changes_no_files(exported: tuple[list[Path], Path]) -> None:
    paths, _ = exported
    current = AnnotationSession.open(paths[0], read_doc(paths[0]).source)
    changes = plan_shared_tags(paths, ["fire", "smoke"], current)
    lock = paths[1].with_name(f".{paths[1].name}.lock")
    lock.touch()
    with pytest.raises(ValueError, match="being saved elsewhere"):
        apply_shared_tags(changes)
    assert read_doc(paths[0]).classes == ["fire"]
    assert lock.is_file()
    assert not paths[0].with_name(f".{paths[0].name}.lock").exists()


def test_training_state_is_separate_from_annotation_truth(tmp_path: Path) -> None:
    path = make_project(tmp_path, "clip", "training")
    original = path.read_bytes()
    state = TrainingState(
        projects=[str(path)], dataset="data.yaml", epochs="12", weights="model.pt"
    )
    save_training_state(path, state)
    assert load_training_state(path) == state
    assert path.read_bytes() == original


def test_gui_stale_export_prevents_process_launch(
    studio: AnnotationApp, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    panel = studio.training_panel
    panel.paths.append(make_project(tmp_path, "val", "validation", 50))
    data = export_dataset(panel.paths, tmp_path / "exports")
    panel.dataset.set(str(data))
    panel.weights.set(str(studio.session.path))  # Existing file; no model is ever loaded.
    studio.session.replace_frame(0, [])
    errors = []
    monkeypatch.setattr(panel, "error", lambda exc: errors.append(str(exc)))
    monkeypatch.setattr(
        "tracker.rescue.training_panel.subprocess.Popen",
        lambda *a, **k: pytest.fail("must not launch stale training"),
    )
    panel.start()
    assert errors and "STALE EXPORT" in errors[0]
    assert "STALE EXPORT" in panel.export_status.get()


def test_gui_shared_scope_confirmation_and_saved_workspace(
    studio: AnnotationApp, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    panel = studio.training_panel
    second = make_project(tmp_path, "val", "validation", 50)
    panel.paths.append(second)
    monkeypatch.setattr(
        "tracker.rescue.training_panel.simpledialog.askstring", lambda *a, **k: "fire, dense smoke"
    )
    monkeypatch.setattr("tracker.rescue.training_panel.messagebox.askyesno", lambda *a, **k: False)
    panel.edit_tags()
    assert read_doc(second).classes == ["fire"]
    monkeypatch.setattr("tracker.rescue.training_panel.messagebox.askyesno", lambda *a, **k: True)
    panel.edit_tags()
    assert read_doc(second).classes == ["dense smoke", "fire"]
    assert "no reviewed frames" in panel.readiness.get()
    panel.epochs.set("17")
    restored = load_training_state(studio.session.path)
    assert restored.epochs == "17" and restored.projects == list(map(str, panel.paths))


def test_home_auto_training_excludes_same_video_revisions(
    home: StudioHome, monkeypatch: pytest.MonkeyPatch
) -> None:
    item = home.library.items[0]
    alternate = ProjectInfo(
        item.projects[0].path.with_name("revision.json"), ("fire",), 3, 1, 4, item.sha256
    )
    home.library.items.append(LibraryItem(item.video, item.sha256, "duplicate", [alternate]))
    launches = []
    monkeypatch.setattr(home, "launch_editor", lambda path, args: launches.append(args))
    home.open_project(training=True)
    assert launches and "--training-project" not in launches[0]


def fake_training(data: Path) -> Path:
    directory = data.parent / "fake-training"
    directory.mkdir()
    result = directory / "result.json"
    (directory / "model.pt").write_bytes(b"test fixture only, never loaded")
    (directory / "review.yaml").write_text("models: []")
    write_json(
        result,
        {
            "status": "completed",
            "best_weights": str(directory / "model.pt"),
            "review_config": str(directory / "review.yaml"),
            "baseline_review_config": str(directory / "review.yaml"),
        },
    )
    write_json(
        directory / "request.json",
        {"data": str(data), "manifest_sha256": file_sha256(data.parent / "manifest.json")},
    )
    return result


def test_validation_preflight_rejects_training_and_incident_leakage(
    exported: tuple[list[Path], Path],
) -> None:
    paths, data = exported
    result = fake_training(data)
    assert validation_document(paths[1], result).split == "validation"
    with pytest.raises(ValueError, match="VALIDATION"):
        validation_document(paths[0], result)
    doc = read_doc(paths[1])
    doc.incident_id = read_doc(paths[0]).incident_id
    AnnotationSession(doc, paths[1]).save()
    with pytest.raises(ValueError, match="belongs to training"):
        validation_document(paths[1], result)


def test_model_comparison_same_snapshot_and_cancel(
    exported: tuple[list[Path], Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    paths, data = exported
    result = fake_training(data)
    calls = []
    monkeypatch.setattr("tracker.cli.rescue_model_check.local_review_config", lambda *a: ["fire"])

    def synthetic_inference(args: Any) -> int:
        args.output.mkdir(parents=True)
        make_run(args.output / "review-fixture", read_doc(paths[1]))
        summary = args.output / "review-fixture" / "summary.json"
        payload = json.loads(summary.read_bytes())
        payload["unsupported_review_classes"] = []
        summary.write_text(json.dumps(payload))
        calls.append(args.config)
        return 0

    monkeypatch.setattr("tracker.cli.rescue_model_check.rescue_review.run", synthetic_inference)
    output = check_model(result, paths[1], data.parent / "checks", compare=True)
    payload = json.loads(output.read_bytes())
    assert len(calls) == len(payload["evaluations"]) == 2
    assert all(row["coverage"]["scored_frames"] == 3 for row in payload["evaluations"])
    stop = data.parent / "stop"
    stop.touch()
    with pytest.raises(ValueError, match="stopped"):
        check_model(result, paths[1], data.parent / "checks", compare=True, stop_file=stop)
    assert len(calls) == 2


def test_incomplete_inference_is_not_reported_as_success(
    exported: tuple[list[Path], Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    paths, data = exported
    result = fake_training(data)
    monkeypatch.setattr("tracker.cli.rescue_model_check.local_review_config", lambda *a: ["fire"])

    def stopped(args: Any) -> int:
        args.output.mkdir(parents=True)
        run = make_run(args.output / "review-fixture", read_doc(paths[1]))
        payload = json.loads((run / "summary.json").read_bytes())
        payload["status"] = "operator_stopped"
        (run / "summary.json").write_text(json.dumps(payload))
        return 0

    monkeypatch.setattr("tracker.cli.rescue_model_check.rescue_review.run", stopped)
    output = data.parent / "checks"
    with pytest.raises(ValueError, match="stopped or incomplete"):
        check_model(result, paths[1], output, compare=True)
    assert not list(output.glob("model-check-*/result.json"))
    assert list(output.glob("model-check-*/FAILED.json"))
    assert list(output.glob("model-check-*/model-0/review-*/frames.jsonl"))


@pytest.mark.skipif(
    os.environ.get("RESCUE_RUN_TRAINING_SMOKE") != "1", reason="opt-in real YOLO training"
)
def test_gui_real_training_test_and_comparison(
    studio: AnnotationApp, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Synthetic shapes only: verify plumbing, never rescue detection accuracy."""
    baseline = Path(__file__).resolve().parents[1] / "models/rescue-fire-smoke/best.pt"
    assert baseline.is_file()
    digest = file_sha256(baseline)
    panel = studio.training_panel
    validation = make_project(tmp_path, "validation", "validation", 50)
    panel.paths.append(validation)
    changes = plan_shared_tags(panel.paths, ["fire", "dense smoke"], studio.session)
    apply_shared_tags(changes)
    for path in panel.paths:
        doc = read_doc(path)
        for frame in doc.frames:
            frame.reviewed = frame.frame_index != 3
            if frame.frame_index == 2:
                frame.objects[0].label = "dense smoke"
        if path == studio.session.path:
            studio.session.replace_document(doc)
            studio.session.save()
        else:
            AnnotationSession(doc, path).save()
    errors = []
    monkeypatch.setattr(
        "tracker.rescue.training_panel.messagebox.showerror", lambda *a, **k: errors.append(a)
    )
    monkeypatch.setattr(
        "tracker.rescue.training_panel.filedialog.askdirectory",
        lambda **k: str(tmp_path / "exports"),
    )
    panel.refresh()
    panel.guide.prepare_button.invoke()

    def finish() -> None:
        deadline = time.monotonic() + 180
        while panel.busy and time.monotonic() < deadline:
            studio.root.update()
            time.sleep(0.025)
        assert not panel.busy, panel.log.get("1.0", "end")
        assert not errors, errors

    finish()
    panel.weights.set(str(baseline))
    panel.epochs.set("1")
    panel.image_size.set("64")
    panel.batch.set("2")
    panel.guide.start_button.invoke()
    assert panel.busy
    finish()
    check = panel.check_panel
    assert check.test_button.instate(["!disabled"])
    assert check.compare_button.instate(["!disabled"])
    assert "dense smoke" in check.status.get()
    check.project.set(str(validation))
    check.test_button.invoke()
    assert check.busy
    finish()
    assert len(check.rows) == 1
    check.compare_button.invoke()
    finish()
    assert len(check.rows) == 3
    assert file_sha256(baseline) == digest
    assert all(row["coverage"]["scored_frames"] == 3 for _, row in check.rows.values())
    state = load_training_state(studio.session.path)
    assert state.training_result and len(state.checks) == 2
    opened = []
    monkeypatch.setattr(check, "inspect", lambda project, run: opened.append((project, run)))
    check.open_selected()
    assert opened[0][0] == validation
    assert (opened[0][1] / "frames.jsonl").is_file()
    # Recreate the actual controls from disk, not just the serialized state model.
    reopened = TrainingPanel(studio.tabs, studio.session, studio.save)
    assert reopened.paths == panel.paths
    assert reopened.weights.get() == str(baseline)
    assert reopened.epochs.get() == "1"
    assert len(reopened.check_panel.rows) == 3
    assert reopened.check_panel.project.get() == str(validation)
    doc = read_doc(validation)
    doc.frames[0].objects = []
    AnnotationSession(doc, validation).save()
    reopened.check_panel.select_result()
    assert "STALE" in reopened.check_panel.status.get()
