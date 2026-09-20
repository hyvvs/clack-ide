from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest
import yaml

from tracker.cli.rescue_train import TrainingCancelled, TrainingSettings, train
from tracker.rescue.annotations import AnnotationDocument, AnnotationSession
from tracker.rescue.box_edit import BoxDrag, hit_box
from tracker.rescue.media import FrameReader, file_sha256
from tracker.rescue.suggestions import load_suggestions, merge_suggestions
from tracker.rescue.training_data import (
    export_dataset,
    read_projects,
    stage_training_data,
    verify_dataset,
)


def make_project(root: Path, name: str, split: str, shade: int = 0) -> Path:
    video = root / f"{name}.avi"
    writer = cv2.VideoWriter(str(video), cv2.VideoWriter.fourcc(*"MJPG"), 5, (96, 96))
    assert writer.isOpened()
    for index in range(4):
        image = np.full((96, 96, 3), shade + index * 10, dtype=np.uint8)
        if index != 1:
            cv2.rectangle(image, (12, 12), (48, 60), (0, 100, 220), -1)
        writer.write(image)
    writer.release()
    reader = FrameReader(video)
    try:
        doc = AnnotationDocument.model_validate(
            {
                "source": reader.source.model_dump(),
                "classes": ["fire"],
                "incident_id": name,
                "split": split,
                "frames": [
                    {
                        "frame_index": index,
                        "reviewed": index != 3,
                        "objects": []
                        if index == 1
                        else [{"label": "fire", "bbox_xyxy": [12, 12, 48, 60]}],
                    }
                    for index in range(4)
                ],
            }
        )
        path = root / f"{name}.json"
        AnnotationSession(doc, path).save()
        return path
    finally:
        reader.close()


def read_doc(path: Path) -> AnnotationDocument:
    return AnnotationDocument.model_validate_json(path.read_bytes())


def make_run(root: Path, doc: AnnotationDocument) -> Path:
    root.mkdir()
    summary = {
        "schema_version": 1,
        "status": "completed",
        "frames_reviewed": 4,
        "image_dimensions": [96, 96],
        "source_video_sha256": doc.source.sha256,
        "model_settings": {"synthetic_fixture_not_yolo": True},
        "timing_note": "synthetic",
    }
    (root / "summary.json").write_text(json.dumps(summary))
    frames = [
        {
            "schema_version": 1,
            "frame_index": index,
            "source_time_s": index / 5,
            "read_process_encode_ms": 10,
            "observations": [
                {
                    "model": "hazard",
                    "label": "fire",
                    "bbox_xyxy": [10, 10, 50, 64],
                    "confidence": 0.8,
                    "tracker_id": 1,
                }
            ],
        }
        for index in range(4)
    ]
    (root / "frames.jsonl").write_text("\n".join(map(json.dumps, frames)) + "\n")
    return root


def test_imported_predictions_are_drafts_with_provenance_not_truth_ids(tmp_path: Path) -> None:
    doc = read_doc(make_project(tmp_path, "train", "training"))
    doc.frames = []
    suggestions = load_suggestions(make_run(tmp_path / "run", doc), doc)
    updated, count, skipped = merge_suggestions(doc, suggestions)
    assert count == 4 and skipped == 0
    assert len(doc.frames) == 0
    assert all(not frame.reviewed and frame.suggestion_source for frame in updated.frames)
    assert all(obj.object_id is None for frame in updated.frames for obj in frame.objects)
    assert not updated.to_truth().frames
    updated.frames[0].objects = []
    updated.frames[0].blocked_tracks = [
        link.track_key for link in updated.frames[0].box_links.values()
    ]
    updated.frames[0].box_links = {}
    updated.frames[1].reviewed = True
    again, count, _ = merge_suggestions(updated, suggestions)
    assert count == 0
    assert not again.frames[0].objects
    assert again.frames[1].reviewed


@pytest.mark.parametrize("fault", ["hash", "bounds", "count", "time", "duplicate", "unfinished"])
def test_import_rejects_mismatched_and_corrupt_runs(tmp_path: Path, fault: str) -> None:
    doc = read_doc(make_project(tmp_path, "train", "training"))
    run = make_run(tmp_path / "run", doc)
    summary = json.loads((run / "summary.json").read_text())
    frames = [json.loads(line) for line in (run / "frames.jsonl").read_text().splitlines()]
    if fault == "hash":
        summary["source_video_sha256"] = "a" * 64
    elif fault == "bounds":
        frames[0]["observations"][0]["bbox_xyxy"][2] = 1000
    elif fault == "count":
        frames.pop()
    elif fault == "time":
        frames[1]["source_time_s"] = 0
    elif fault == "duplicate":
        frames[1]["frame_index"] = 0
    else:
        summary["status"] = "running"
    (run / "summary.json").write_text(json.dumps(summary))
    (run / "frames.jsonl").write_text("\n".join(map(json.dumps, frames)) + "\n")
    with pytest.raises(ValueError):
        load_suggestions(run, doc)


def test_class_changes_are_global_review_invalidating_and_undoable(tmp_path: Path) -> None:
    path = make_project(tmp_path, "train", "training")
    session = AnnotationSession.open(path, read_doc(path).source)
    session.change_class("dense smoke")
    assert session.document.classes == ["fire", "dense smoke"]
    assert not any(frame.reviewed for frame in session.document.frames)
    assert session.undo()
    assert session.frame(0).reviewed
    session.change_class("visible flame", "fire")
    assert session.frame(0).objects[0].label == "visible flame"
    assert not session.frame(0).reviewed
    assert session.undo()
    for name in ("", "\n", "a" * 65, "fire", "bad\nname"):
        with pytest.raises(ValueError):
            session.change_class(name)


def test_box_select_move_resize_preserves_bounds() -> None:
    box = (10.0, 10.0, 30.0, 40.0)
    assert hit_box([box, (15, 15, 25, 25)], (20, 20), None, 2) == (1, "move")
    assert hit_box([box], (10, 10), 0, 2) == (0, "0")
    assert hit_box([box], (60, 60), None, 2) is None
    assert BoxDrag(0, "move", (20, 20), box).update((-50, 400), 100, 100) == (0, 70, 20, 100)
    assert BoxDrag(0, "0", (10, 10), box).update((90, 90), 100, 100) == (30, 40, 90, 90)
    assert BoxDrag(0, "1", (30, 10), box).update((200, -30), 100, 100) == (10, 0, 100, 40)


def test_unused_classes_can_be_removed_without_dropping_boxes(tmp_path: Path) -> None:
    path = make_project(tmp_path, "train", "training")
    session = AnnotationSession.open(path, read_doc(path).source)
    session.change_class("smoke")
    with pytest.raises(ValueError, match="still has boxes"):
        session.remove_unused_class("fire")
    session.remove_unused_class("smoke")
    assert session.document.classes == ["fire"]
    assert session.frame(0).objects
    assert session.undo()
    assert session.document.classes == ["fire", "smoke"]


def test_isolated_training_copy_excludes_test_incidents(tmp_path: Path) -> None:
    paths = [
        make_project(tmp_path, "first", "training"),
        make_project(tmp_path, "second", "validation", 50),
        make_project(tmp_path, "third", "test", 80),
    ]
    data = export_dataset(paths, tmp_path / "exports")
    manifest = verify_dataset(data)
    staged = stage_training_data(data, tmp_path / "isolated", manifest)
    assert "test" not in yaml.safe_load(staged.read_text())
    assert not (staged.parent / "images/test").exists()
    next((staged.parent / "labels/train").glob("*.txt")).write_text("isolated edit")
    assert verify_dataset(data)["status"] == "complete"


def test_export_real_frames_normalized_labels_and_reviewed_negatives(tmp_path: Path) -> None:
    paths = [
        make_project(tmp_path, "first", "training"),
        make_project(tmp_path, "second", "validation", 50),
    ]
    before = [path.read_bytes() for path in paths]
    data = export_dataset(paths, tmp_path / "exports")
    manifest = verify_dataset(data)
    assert manifest["frames"] == {"train": 3, "val": 3}
    labels = sorted((data.parent / "labels" / "train").glob("*.txt"))
    assert len(labels) == 3
    assert labels[1].read_text() == ""
    values = [float(value) for value in labels[0].read_text().split()]
    assert values == pytest.approx([0, 30 / 96, 36 / 96, 36 / 96, 48 / 96])
    assert not any("00000003" in name for name in manifest["files"])
    assert [path.read_bytes() for path in paths] == before
    labels[0].write_text("0 0.5 0.5 0.5 0.5\n")
    with pytest.raises(ValueError, match="changed"):
        verify_dataset(data)


@pytest.mark.parametrize(
    "fault",
    ["same_source", "incident", "unassigned", "draft", "scope", "no_validation", "no_positive"],
)
def test_export_preflight_blocks_bad_training_inputs(tmp_path: Path, fault: str) -> None:
    first = make_project(tmp_path, "first", "training")
    second = make_project(tmp_path, "second", "validation", 50)
    doc = read_doc(second)
    if fault == "same_source":
        doc.source = read_doc(first).source
    elif fault == "incident":
        doc.incident_id = " FIRST "
    elif fault == "unassigned":
        doc.split = "unassigned"
    elif fault == "draft":
        for frame in doc.frames:
            frame.reviewed = False
    elif fault == "scope":
        doc.classes.append("smoke")
    elif fault == "no_validation":
        doc.split = "training"
    else:
        first_doc = read_doc(first)
        for frame in first_doc.frames:
            frame.objects = []
        first.write_text(first_doc.model_dump_json())
    second.write_text(doc.model_dump_json())
    with pytest.raises(ValueError):
        read_projects([first, second])


def test_export_rejects_changed_video_and_extra_files(tmp_path: Path) -> None:
    paths = [
        make_project(tmp_path, "first", "training"),
        make_project(tmp_path, "second", "validation", 50),
    ]
    data = export_dataset(paths, tmp_path / "exports")
    (data.parent / "labels" / "train" / "extra.txt").write_text("")
    with pytest.raises(ValueError, match="unexpected"):
        verify_dataset(data)
    with Path(read_doc(paths[0]).source.path).open("ab") as stream:
        stream.write(b"changed")
    with pytest.raises(ValueError, match="no longer matches"):
        export_dataset(paths, tmp_path / "exports")
    assert len(list((tmp_path / "exports").glob("*/FAILED.json"))) == 1


def test_train_invokes_real_api_contract_and_does_not_replace_baseline(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ultralytics = pytest.importorskip("ultralytics")
    paths = [
        make_project(tmp_path, "first", "training"),
        make_project(tmp_path, "second", "validation", 50),
    ]
    data = export_dataset(paths, tmp_path / "exports")
    baseline = tmp_path / "baseline.pt"
    baseline.write_bytes(b"mock model")
    calls: list[dict[str, Any]] = []

    class FakeYOLO:
        task = "detect"

        def __init__(self, _: str) -> None:
            self.names = {0: "fire"}

        def add_callback(self, *_: Any) -> None:
            pass

        def train(self, **kwargs: Any) -> None:
            from ultralytics.utils import callbacks

            callbacks.add_integration_callbacks(None)
            calls.append(kwargs)
            weights = Path(kwargs["project"]) / kwargs["name"] / "weights"
            weights.mkdir(parents=True)
            (weights / "best.pt").write_bytes(b"new model")

    monkeypatch.setattr(ultralytics, "YOLO", FakeYOLO)
    best = train(data, baseline, tmp_path / "runs", TrainingSettings(epochs=1, image_size=64))
    assert best.read_bytes() == b"new model"
    assert baseline.read_bytes() == b"mock model"
    assert calls[0]["workers"] == 0 and calls[0]["resume"] is False
    config = yaml.safe_load((best.parents[2] / "review.yaml").read_text())
    assert config["models"][0]["weights_sha256"] == file_sha256(best)
    stop = tmp_path / "cancel"
    stop.touch()
    with pytest.raises(TrainingCancelled):
        train(data, baseline, tmp_path / "runs", TrainingSettings(), stop)


@pytest.mark.skipif(
    os.environ.get("RESCUE_RUN_TRAINING_SMOKE") != "1",
    reason="explicit opt-in real YOLO smoke test",
)
def test_actual_yolo_training_smoke_on_synthetic_images(tmp_path: Path) -> None:
    weights = Path(__file__).resolve().parents[1] / "models/rescue-fire-smoke/best.pt"
    if not weights.is_file():
        pytest.skip("local trusted smoke-test weights unavailable")
    paths = [
        make_project(tmp_path, "first", "training"),
        make_project(tmp_path, "second", "validation", 50),
    ]
    data = export_dataset(paths, tmp_path / "exports")
    original = file_sha256(weights)
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "tracker.cli.rescue_train",
            "--data",
            str(data),
            "--weights",
            str(weights),
            "--output",
            str(tmp_path / "runs"),
            "--epochs",
            "1",
            "--image-size",
            "64",
            "--batch",
            "2",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=120,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    best = next((tmp_path / "runs").glob("*/fit/weights/best.pt"))
    assert best.is_file() and file_sha256(best) != original
    assert file_sha256(weights) == original
    assert verify_dataset(data)["status"] == "complete"
    assert not list((data.parent / "labels").rglob("*.cache"))
