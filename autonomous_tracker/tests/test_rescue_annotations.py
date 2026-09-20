from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from tracker.rescue.annotations import AnnotationDocument, AnnotationSession, LabelFrame
from tracker.rescue.error_review import comparison_reasons, review_queue
from tracker.rescue.evaluation import Evaluation, GroundTruth, TruthFrame, TruthObject
from tracker.rescue.media import FrameReader, VideoIdentity
from tracker.rescue.observations import Observation
from tracker.rescue.scoring import annotation_digest, save_evaluation, score_saved_run


def source() -> VideoIdentity:
    return VideoIdentity(
        path="synthetic.avi", sha256="a" * 64, width=100, height=100, frame_count=5, nominal_fps=10
    )


def person() -> TruthObject:
    return TruthObject(label="person", bbox_xyxy=(10, 10, 30, 40), object_id="p1")


def document() -> AnnotationDocument:
    return AnnotationDocument(
        source=source(),
        classes=["person"],
        frames=[
            LabelFrame(frame_index=0, objects=[person()], reviewed=True),
            LabelFrame(frame_index=1, objects=[], reviewed=True),
            LabelFrame(frame_index=2, objects=[person()], reviewed=False),
            LabelFrame(frame_index=3, objects=[person()], reviewed=True),
        ],
    )


def write_run(path: Path, count: int = 5) -> Path:
    path.mkdir()
    metadata = {
        "schema_version": 1,
        "status": "completed",
        "frames_reviewed": count,
        "image_dimensions": [100, 100],
        "source_video_sha256": "a" * 64,
        "model_settings": {"synthetic_fixture_not_yolo": True},
        "timing_note": "test",
    }
    (path / "summary.json").write_text(json.dumps(metadata), encoding="utf-8")
    records = []
    for index in range(count):
        obs = {
            "model": "test",
            "label": "person",
            "confidence": 0.8,
            "bbox_xyxy": [10, 10, 30, 40],
            "tracker_id": 1 if index < 3 else 2,
        }
        records.append(
            {
                "schema_version": 1,
                "frame_index": index,
                "source_time_s": index / 10,
                "read_process_encode_ms": 10 + index,
                "observations": [obs],
            }
        )
    (path / "frames.jsonl").write_text("\n".join(map(json.dumps, records)) + "\n", encoding="utf-8")
    return path


def test_export_only_reviewed_and_retains_explicit_negatives(tmp_path: Path) -> None:
    session = AnnotationSession(document(), tmp_path / "project.json")
    exported = GroundTruth.model_validate_json(session.export().read_text())
    assert [f.frame_index for f in exported.frames] == [0, 1, 3]
    assert exported.frames[1].objects == []
    assert exported.video_sha256 == source().sha256
    assert exported.label_scope == ["person"]


def test_edits_invalidate_review_and_undo_restores_it(tmp_path: Path) -> None:
    session = AnnotationSession(document(), tmp_path / "project.json")
    session.replace_frame(0, [])
    assert not session.frame(0).reviewed
    assert session.undo()
    assert session.frame(0).reviewed
    detached = session.frame(0)
    detached.objects.clear()
    assert len(session.frame(0).objects) == 1


def test_save_resume_backup_and_conflicting_writer(tmp_path: Path) -> None:
    path = tmp_path / "project.json"
    session = AnnotationSession(document(), path)
    session.save()
    second = AnnotationSession.open(path, source())
    original = path.read_bytes()
    session.replace_frame(0, [])
    session.save()
    assert next(tmp_path.glob("*.backup-*.json")).read_bytes() == original
    with pytest.raises(ValueError, match="changed on disk"):
        second.save()
    assert not list(tmp_path.glob("*.tmp"))
    resumed = AnnotationSession.open(path, source())
    assert resumed.frame(0).objects == []


def test_annotation_validation_and_wrong_video(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="outside"):
        AnnotationDocument(
            source=source(), classes=["person"], frames=[LabelFrame(frame_index=5, objects=[])]
        )
    with pytest.raises(ValueError, match="scope"):
        AnnotationDocument(
            source=source(),
            classes=["fire"],
            frames=[LabelFrame(frame_index=0, objects=[person()])],
        )
    path = tmp_path / "project.json"
    AnnotationSession(document(), path).save()
    wrong = source().model_copy(update={"sha256": "b" * 64})
    with pytest.raises(ValueError, match="different video"):
        AnnotationSession.open(path, wrong)


def test_empty_export_requires_explicit_review(tmp_path: Path) -> None:
    session = AnnotationSession(
        AnnotationDocument(source=source(), classes=["person"]), tmp_path / "project.json"
    )
    with pytest.raises(ValueError, match="reviewed"):
        session.export()
    session.replace_frame(0, [], reviewed=True)
    assert session.export().is_file()


def test_save_lock_preserves_active_project_and_other_lock(tmp_path: Path) -> None:
    path = tmp_path / "project.json"
    session = AnnotationSession(document(), path)
    session.save()
    before = path.read_bytes()
    lock = tmp_path / ".project.json.lock"
    lock.write_text("another writer")
    with pytest.raises(ValueError, match="locked"):
        session.save()
    assert lock.read_text() == "another writer"
    assert path.read_bytes() == before


def test_ground_truth_hash_checked_before_inference(tmp_path: Path) -> None:
    from tracker.cli.rescue_review import build_parser, run

    video = tmp_path / "not-the-video.mp4"
    video.write_bytes(b"different input")
    truth = tmp_path / "truth.json"
    truth.write_text(document().to_truth().model_dump_json())
    config = tmp_path / "review.yaml"
    config.write_text("models:\n  - name: test\n    weights: unused.pt\n    classes: [person]\n")
    args = build_parser().parse_args(
        [
            "--video",
            str(video),
            "--config",
            str(config),
            "--annotations",
            str(truth),
        ]
    )
    with pytest.raises(ValueError, match="different video"):
        run(args)


def test_class_scope_excludes_other_predictions_and_duplicate_updates_fail() -> None:
    truth = GroundTruth(
        image_width=100,
        image_height=100,
        label_scope=["fire"],
        frames=[TruthFrame(frame_index=0, objects=[])],
    )
    evaluation = Evaluation(truth)
    evaluation.update(0, [Observation("general", "person", 0.9, (10, 10, 30, 40), 1)])
    assert evaluation.summary()["overall"] == {
        "true_positives": 0,
        "false_positives": 0,
        "false_negatives": 0,
        "precision": None,
        "recall": None,
    }
    with pytest.raises(ValueError, match="increase"):
        evaluation.update(0, [])
    for threshold in [0, -1, 2, float("nan")]:
        with pytest.raises(ValueError, match="threshold"):
            Evaluation(truth, threshold)


def test_saved_scoring_is_repeatable_and_rate_uses_reviewed_duration(tmp_path: Path) -> None:
    run = write_run(tmp_path / "run")
    labels = document()
    result = score_saved_run(run, labels)
    assert result["evaluation"]["overall"] == {
        "true_positives": 2,
        "false_positives": 1,
        "false_negatives": 0,
        "precision": 2 / 3,
        "recall": 1.0,
    }
    assert result["evaluation"]["identity_switches"] == 1
    assert result["coverage"]["scored_frames"] == 3
    assert result["coverage"]["complete_for_reviewed_frames"]
    assert result["false_positives"][
        "box_detections_per_labeled_minute_nominal_fps"
    ] == pytest.approx(200)
    again = score_saved_run(run, labels)
    for key in ["evaluation", "coverage", "annotation_sha256", "prediction_log_sha256"]:
        assert again[key] == result[key]
    output = save_evaluation(tmp_path / "evaluations", labels, result)
    assert json.loads((output / "summary.json").read_text())["evaluation"] == result["evaluation"]
    assert GroundTruth.model_validate_json((output / "annotations.json").read_text()).video_sha256
    assert annotation_digest(labels) == result["annotation_sha256"]


@pytest.mark.parametrize(
    "fault", ["wrong_video", "legacy", "failed", "truncated", "duplicate", "nan", "box"]
)
def test_saved_scoring_rejects_untrustworthy_inputs(tmp_path: Path, fault: str) -> None:
    run = write_run(tmp_path / "run")
    path = run / "summary.json"
    metadata = json.loads(path.read_text())
    if fault == "wrong_video":
        metadata["source_video_sha256"] = "b" * 64
    elif fault == "legacy":
        metadata.pop("source_video_sha256")
    elif fault == "failed":
        metadata["status"] = "failed"
    path.write_text(json.dumps(metadata))
    path = run / "frames.jsonl"
    records = [json.loads(line) for line in path.read_text().splitlines()]
    if fault == "truncated":
        records.pop()
    elif fault == "duplicate":
        records[1]["frame_index"] = 0
    elif fault == "nan":
        records[0]["read_process_encode_ms"] = float("nan")
    elif fault == "box":
        records[0]["observations"][0]["bbox_xyxy"][2] = 200
    path.write_text("\n".join(map(json.dumps, records)) + "\n")
    with pytest.raises(ValueError):
        score_saved_run(run, document())


def test_partial_predictions_are_reported_not_treated_as_absence(tmp_path: Path) -> None:
    run = write_run(tmp_path / "run", count=2)
    result = score_saved_run(run, document())
    assert result["coverage"]["missing_prediction_frames"] == [3]
    assert not result["coverage"]["complete_for_reviewed_frames"]
    assert result["evaluation"]["overall"]["false_negatives"] == 0


def test_error_queue_contains_false_positives_and_identity_changes(tmp_path: Path) -> None:
    result = score_saved_run(write_run(tmp_path / "run"), document())
    rows = review_queue(result)
    assert [row["frame_index"] for row in rows] == [1, 3]
    assert rows[0]["false_positives"] == 1
    assert rows[0]["truth_objects"] == []
    assert len(rows[0]["predictions"]) == 1
    assert rows[1]["identity_switches"] == 1
    assert rows[1]["identity_changes"] == [
        {"object_id": "p1", "previous": "test:1", "current": "test:2"}
    ]
    assert rows[1]["matches"] == [{"truth_index": 0, "prediction_index": 0, "iou": 1.0}]
    assert len(review_queue(result, errors_only=False)) == 3


def test_missing_predictions_keep_unscored_truth_in_review_queue(tmp_path: Path) -> None:
    result = score_saved_run(write_run(tmp_path / "run", count=2), document())
    row = next(row for row in review_queue(result) if row["frame_index"] == 3)
    assert row["prediction_status"] == "missing"
    assert row["false_negatives"] is None
    assert row["truth_objects"] == [person().model_dump(mode="json")]
    assert "predictions" not in row


def test_run_comparison_rejects_different_coverage_and_label_snapshots(tmp_path: Path) -> None:
    first = score_saved_run(write_run(tmp_path / "first"), document())
    second = score_saved_run(write_run(tmp_path / "second", count=2), document())
    assert comparison_reasons(first, second) == ["different scored-frame coverage"]
    assert comparison_reasons(first, first) == []
    second["annotation_sha256"] = "c" * 64
    second["evaluation"]["iou_threshold"] = 0.75
    assert comparison_reasons(first, second) == [
        "different reviewed label snapshots",
        "different IoU thresholds",
        "different scored-frame coverage",
    ]


def test_frame_evidence_uses_filtered_indices_and_detaches_truth() -> None:
    labels = person()
    truth = GroundTruth(
        image_width=100,
        image_height=100,
        label_scope=["person"],
        frames=[TruthFrame(frame_index=0, objects=[labels])],
    )
    evaluator = Evaluation(truth)
    result = evaluator.update(
        0,
        [
            Observation("hazard", "fire", 0.9, (10, 10, 30, 40), 1),
            Observation("general", "person", 0.9, (10, 10, 30, 40), 1),
            Observation("general", "person", 0.8, (10, 10, 30, 40), 2),
        ],
    )
    assert result is not None
    assert len(result.predictions) == 2
    assert result.matches[0].prediction_index in {0, 1}
    assert result.summary()["false_positives"] == 1
    labels.label = "changed"
    assert result.objects[0].label == "person"


def test_frame_reader_preserves_indices_through_random_seeks(tmp_path: Path) -> None:
    path = tmp_path / "frames.avi"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter.fourcc(*"MJPG"), 10, (100, 100))
    assert writer.isOpened()
    for index in range(5):
        writer.write(np.full((100, 100, 3), index * 40, dtype=np.uint8))
    writer.release()
    reader = FrameReader(path)
    try:
        assert reader.source.frame_count == 5
        for index in [4, 0, 2, 1, 3]:
            assert float(reader.read(index).mean()) == pytest.approx(index * 40, abs=2)
        with pytest.raises(ValueError, match="outside"):
            reader.read(5)
    finally:
        reader.close()
