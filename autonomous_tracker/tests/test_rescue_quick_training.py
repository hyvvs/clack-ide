from __future__ import annotations

import json
import os
import time
from pathlib import Path

import pytest
import yaml
from test_rescue_studio_ui import desktop_root as desktop_root
from test_rescue_studio_ui import studio as studio
from test_rescue_training import make_project, read_doc

from tracker.cli.rescue_train import TrainingSettings, train
from tracker.rescue.annotation_ui import AnnotationApp
from tracker.rescue.annotations import AnnotationSession
from tracker.rescue.media import file_sha256
from tracker.rescue.practice_training import practice_plan
from tracker.rescue.training_data import export_dataset, read_projects, verify_dataset
from tracker.rescue.training_panel import TrainingPanel
from tracker.rescue.training_workflow import (
    apply_shared_tags,
    export_issues,
    load_training_state,
    plan_shared_tags,
)


def test_unused_tag_removal_preserves_reviews_and_boxes(tmp_path: Path) -> None:
    path = make_project(tmp_path, "teach", "unassigned")
    doc = read_doc(path)
    doc.classes.append("unused scene category")
    session = AnnotationSession(doc, path)
    before = session.document.model_copy(deep=True)
    session.remove_unused_class("unused scene category")
    assert session.document.frames == before.frames
    assert session.document.classes == ["fire"]
    assert session.undo() and session.document == before
    with pytest.raises(ValueError, match="still has boxes"):
        session.remove_unused_class("fire")


def test_practice_export_ignores_only_genuinely_unused_tags_without_touching_project(
    tmp_path: Path,
) -> None:
    path = make_project(tmp_path, "teach", "unassigned")
    doc = read_doc(path)
    doc.incident_id = ""
    doc.classes.append("unused")
    AnnotationSession(doc, path).save()
    before = path.read_bytes()
    plan = practice_plan(doc)
    assert plan.unused == ("unused",) and plan.reviewed_frames == 3
    data = export_dataset([path], tmp_path / "exports", practice=True)
    manifest = verify_dataset(data)
    assert manifest["frames"] == {"train": 3}
    assert manifest["training_mode"] == "practice"
    assert manifest["classes"] == ["fire"]
    assert manifest["unused_tags_excluded"] == ["unused"]
    assert yaml.safe_load(data.read_bytes())["val"] is None
    assert not (data.parent / "images/val").exists()
    assert path.read_bytes() == before
    assert not export_issues(data, [path])
    with pytest.raises(ValueError):
        read_projects([path])


@pytest.mark.parametrize("reserved", ["validation", "test"])
def test_quick_training_does_not_consume_reserved_footage(tmp_path: Path, reserved: str) -> None:
    path = make_project(tmp_path, "reserved", reserved)
    with pytest.raises(ValueError, match="reserved"):
        export_dataset([path], tmp_path / "exports", practice=True)


def test_tags_with_only_draft_examples_are_not_silently_dropped(tmp_path: Path) -> None:
    doc = read_doc(make_project(tmp_path, "teach", "unassigned"))
    doc.classes.append("smoke")
    doc.frames[3].objects[0].label = "smoke"
    with pytest.raises(ValueError, match="only in draft"):
        practice_plan(doc)


def test_changed_label_snapshot_blocks_quick_export(tmp_path: Path) -> None:
    path = make_project(tmp_path, "teach", "unassigned")
    with pytest.raises(ValueError, match="saved labels changed"):
        export_dataset([path], tmp_path / "exports", practice=True, expected_project_hash="0" * 64)
    assert not (tmp_path / "exports").exists()


def test_shared_removal_of_unused_tag_preserves_approval(tmp_path: Path) -> None:
    path = make_project(tmp_path, "teach", "training")
    doc = read_doc(path)
    doc.classes.append("unused")
    session = AnnotationSession(doc, path)
    session.save()
    before = session.document.frames.copy()
    changes = plan_shared_tags([path], ["fire"], session)
    apply_shared_tags(changes)
    assert session.document.frames == before
    assert read_doc(path).classes == ["fire"]


def test_single_screen_ready_without_incident_or_validation(studio: AnnotationApp) -> None:
    doc = studio.session.document.model_copy(deep=True)
    doc.split, doc.incident_id = "unassigned", ""
    doc.classes.append("unused")
    studio.session.replace_document(doc)
    studio.training_panel.refresh()
    panel = studio.training_panel
    assert panel.views.select() == str(panel.quick)
    assert panel.quick.train_button.instate(["!disabled"])
    assert "unused" in panel.quick.summary.get()
    assert "3 approved frames" in panel.quick.summary.get()
    assert studio.session.document.classes == ["fire", "unused"]
    assert sum(frame.reviewed for frame in studio.session.document.frames) == 3


def test_cancel_before_training_does_not_prepare_or_launch(
    studio: AnnotationApp, monkeypatch: pytest.MonkeyPatch
) -> None:
    panel = studio.training_panel
    panel.refresh()
    before = studio.session.path.read_bytes()
    monkeypatch.setattr(
        "tracker.rescue.quick_training_ui.messagebox.askyesno", lambda *a, **k: False
    )
    monkeypatch.setattr(
        "tracker.rescue.quick_training_ui.DesktopJob",
        lambda *a, **k: pytest.fail("cancelled job must not launch"),
    )
    panel.quick.train_button.invoke()
    assert not panel.quick.busy
    assert studio.session.path.read_bytes() == before
    assert not (studio.session.path.parent / "training").exists()


@pytest.mark.skipif(
    os.environ.get("RESCUE_RUN_TRAINING_SMOKE") != "1", reason="opt-in real training"
)
def test_one_button_real_training_and_preview(
    studio: AnnotationApp, monkeypatch: pytest.MonkeyPatch
) -> None:
    panel = studio.training_panel
    doc = studio.session.document.model_copy(deep=True)
    doc.classes.append("unused scene tag")
    doc.incident_id, doc.split = "", "unassigned"
    studio.session.replace_document(doc)
    studio.save()
    before = studio.session.path.read_bytes()
    baseline = Path(__file__).resolve().parents[1] / "models/rescue-fire-smoke/best.pt"
    baseline_hash = file_sha256(baseline)
    panel.weights.set(str(baseline))
    panel.epochs.set("1")
    panel.image_size.set("64")
    panel.batch.set("2")
    panel.refresh()
    monkeypatch.setattr(
        "tkinter.filedialog.askdirectory", lambda **k: pytest.fail("no output picker")
    )
    monkeypatch.setattr(
        "tkinter.filedialog.askopenfilenames", lambda **k: pytest.fail("no project picker")
    )
    errors = []
    monkeypatch.setattr(panel, "error", lambda exc: errors.append(str(exc)))

    def finish() -> None:
        deadline = time.monotonic() + 90
        while panel.busy and time.monotonic() < deadline:
            studio.root.update()
            time.sleep(0.02)
        assert not panel.busy, panel.log.get("1.0", "end")
        assert not errors, errors

    panel.quick.train_button.invoke()
    assert panel.quick.busy
    assert panel.quick.train_button.instate(["disabled"])
    finish()
    result_path = Path(panel.saved_state.quick_result)
    result = json.loads(result_path.read_bytes())
    assert result["training_mode"] == "practice"
    assert "NOT INDEPENDENTLY TESTED" in panel.quick.result_label.get()
    assert panel.views.select() == str(panel.quick)
    assert panel.quick.try_button.instate(["!disabled"])
    assert studio.session.path.read_bytes() == before
    assert file_sha256(baseline) == baseline_hash
    panel.quick.try_button.invoke()
    assert panel.quick.busy
    finish()
    assert Path(panel.saved_state.quick_preview).is_file()
    assert panel.quick.preview_window is not None
    assert panel.quick.preview_window.state() == "withdrawn"
    panel.quick.preview_window.restart()
    panel.quick.preview_window.toggle()
    panel.quick.preview_window.destroy()
    assert studio.session.path.read_bytes() == before
    assert load_training_state(studio.session.path).quick_result == str(result_path)
    reopened = TrainingPanel(studio.tabs, studio.session, studio.save)
    reopened.refresh()
    assert reopened.quick.try_button.instate(["!disabled"])
    assert reopened.quick.replay_button.instate(["!disabled"])


@pytest.mark.skipif(
    os.environ.get("RESCUE_RUN_TRAINING_SMOKE") != "1", reason="opt-in real training"
)
def test_real_practice_training_never_runs_validation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from ultralytics.models.yolo.detect import DetectionValidator

    monkeypatch.setattr(
        DetectionValidator,
        "__call__",
        lambda *a, **k: pytest.fail("practice must not evaluate any footage"),
    )
    path = make_project(tmp_path, "teach", "unassigned")
    data = export_dataset([path], tmp_path / "exports", practice=True)
    weights = Path(__file__).resolve().parents[1] / "models/rescue-fire-smoke/best.pt"
    original = file_sha256(weights)
    checkpoint = train(
        data, weights, tmp_path / "runs", TrainingSettings(epochs=2, image_size=64, batch=2)
    )
    assert checkpoint.name == "last.pt"
    assert file_sha256(weights) == original
    result = json.loads((checkpoint.parents[2] / "result.json").read_bytes())
    assert result["training_mode"] == "practice" and not result["independently_tested"]
    assert result["checkpoint_selection"] == "last_epoch"
    assert "metrics/" not in (checkpoint.parents[1] / "results.csv").read_text()
    assert "val/" not in (checkpoint.parents[1] / "results.csv").read_text()
