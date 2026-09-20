from __future__ import annotations

import ast
import json
from itertools import pairwise
from pathlib import Path
from typing import ClassVar

import cv2
import numpy as np
import pytest

from tracker.cli import rescue_review
from tracker.rescue.config import DetectorSettings, RescueConfig
from tracker.rescue.detector import RescueDetector
from tracker.rescue.evaluation import Evaluation, GroundTruth, TruthFrame, TruthObject
from tracker.rescue.observations import Observation, ObservationHistory
from tracker.rescue.regions import ReviewRegion, review_regions
from tracker.rescue.render import render_review


def observation(identity: int | None = 1, label: str = "person") -> Observation:
    return Observation("general", label, 0.9, (10.0, 10.0, 30.0, 40.0), identity)


def test_missing_tracks_are_last_seen_observations_and_then_expire() -> None:
    history = ObservationHistory(2, 0.5, 3)
    assert history.update([observation()], 0.0)[0].state == "tentative"
    confirmed = history.update([observation()], 0.1)[0]
    assert confirmed.state == "confirmed"
    missing = history.update([], 0.2)[0]
    assert missing.state == "missing"
    assert missing.bbox_xyxy == confirmed.bbox_xyxy
    assert missing.last_seen_s == 0.1
    assert history.update([], 0.7)[0].state == "lost"
    assert history.update([], 0.8) == []
    assert confirmed.state == "confirmed"


def test_reacquisition_requires_fresh_confirmation() -> None:
    history = ObservationHistory(2, 1.0, 3)
    history.update([observation()], 0.0)
    history.update([observation()], 0.1)
    history.update([], 0.2)
    assert history.update([observation()], 0.3)[0].state == "tentative"
    with pytest.raises(ValueError, match="timestamps"):
        history.update([], 0.3)


def test_accuracy_is_not_invented_for_unlabeled_footage() -> None:
    evaluation = Evaluation(None)
    evaluation.update(0, [observation()])
    assert evaluation.summary()["overall"] is None
    assert evaluation.summary()["status"] == "not_measured"


def test_evaluation_counts_duplicates_misses_and_explicit_empty_frames() -> None:
    truth = GroundTruth(
        image_width=100,
        image_height=100,
        frames=[
            TruthFrame(
                frame_index=0,
                objects=[TruthObject(label="person", bbox_xyxy=(10, 10, 30, 40), object_id="p1")],
            ),
            TruthFrame(frame_index=1, objects=[]),
            TruthFrame(
                frame_index=3,
                objects=[TruthObject(label="person", bbox_xyxy=(10, 10, 30, 40), object_id="p1")],
            ),
        ],
    )
    evaluation = Evaluation(truth)
    evaluation.update(0, [observation(), observation(2)])
    evaluation.update(1, [observation()])
    evaluation.update(2, [observation()])
    evaluation.update(3, [])
    summary = evaluation.summary()
    assert summary["labeled_frames_evaluated"] == 3
    assert summary["overall"] == {
        "true_positives": 1,
        "false_positives": 2,
        "false_negatives": 1,
        "precision": 1 / 3,
        "recall": 0.5,
    }


def test_evaluation_counts_identity_changes_but_not_missing_ids() -> None:
    truth = GroundTruth(
        image_width=100,
        image_height=100,
        frames=[
            TruthFrame(
                frame_index=index,
                objects=[TruthObject(label="person", bbox_xyxy=(10, 10, 30, 40), object_id="p1")],
            )
            for index in range(3)
        ],
    )
    evaluation = Evaluation(truth)
    evaluation.update(0, [observation(1)])
    evaluation.update(1, [observation(None)])
    evaluation.update(2, [observation(2)])
    assert evaluation.summary()["identity_switches"] == 1
    assert evaluation.summary()["tracked_matches"] == 2


def test_regions_never_authorize_delivery_and_only_apply_to_the_marked_frame() -> None:
    region = ReviewRegion(
        name="Candidate A",
        frame_index=3,
        polygon_normalized=[(0, 0), (0.5, 0), (0.5, 0.5), (0, 0.5)],
    )
    assert review_regions([region], 2, [], 100, 100, []) == []
    overlap = review_regions([region], 3, [observation()], 100, 100, ["fire"])[0]
    assert overlap["status"] == "observation_overlap"
    assert overlap["approved_for_delivery"] is False
    empty = review_regions([region], 3, [], 100, 100, ["fire"])[0]
    assert empty["status"] == "unverified"
    assert empty["approved_for_delivery"] is False


def test_regions_use_masks_when_available() -> None:
    region = ReviewRegion(
        name="Review",
        frame_index=0,
        polygon_normalized=[(0.6, 0.6), (0.9, 0.6), (0.9, 0.9), (0.6, 0.9)],
    )
    obs = Observation(
        "hazard", "smoke", 0.9, (0, 0, 100, 100), None, ((0, 0), (20, 0), (20, 20), (0, 20))
    )
    result = review_regions([region], 0, [obs], 100, 100, [])[0]
    assert result["overlapping_labels"] == []


def test_annotation_validation_rejects_out_of_bounds_boxes() -> None:
    with pytest.raises(ValueError, match="outside"):
        GroundTruth(
            image_width=10,
            image_height=10,
            frames=[
                TruthFrame(
                    frame_index=0, objects=[TruthObject(label="person", bbox_xyxy=(0, 0, 11, 9))]
                )
            ],
        )


class _Tensor:
    def __init__(self, data: object) -> None:
        self.data = np.asarray(data)

    def cpu(self) -> _Tensor:
        return self

    def numpy(self) -> np.ndarray:
        return self.data


class _Boxes:
    xyxy = _Tensor([[10, 10, 30, 40]])
    conf = _Tensor([0.9])
    cls = _Tensor([0])
    id = _Tensor([7])


class _Result:
    boxes = _Boxes()
    masks = None


class _Model:
    names: ClassVar[dict[int, str]] = {0: "person"}
    task = "detect"

    def track(self, source: np.ndarray, **kwargs: object) -> list[_Result]:
        assert kwargs["persist"] is True
        return [_Result()]


def test_yolo_review_checks_model_capabilities_and_reads_ids() -> None:
    settings = DetectorSettings(name="general", weights="unused.pt", classes=["person"])
    detector = RescueDetector(settings, _Model())
    obs = detector.detect(np.zeros((100, 100, 3), dtype=np.uint8))[0]
    assert obs.key == "general:7"
    settings = DetectorSettings(name="fire", weights="unused.pt", classes=["fire"])
    with pytest.raises(ValueError, match="do not support"):
        RescueDetector(settings, _Model())


def test_duplicate_model_names_are_rejected() -> None:
    settings = DetectorSettings(name="general", weights="unused.pt", classes=["person"])
    with pytest.raises(ValueError, match="unique"):
        RescueConfig(models=[settings, settings])


def test_review_header_has_a_separate_background_and_preserves_source() -> None:
    source = np.full((240, 640, 3), 255, dtype=np.uint8)
    rendered = render_review(source, [observation()], [], [], 0, 0, [], ["debris"])
    assert rendered.shape == source.shape
    assert np.all(source == 255)
    assert np.array_equal(rendered[1, 1], [22, 25, 29])
    assert np.array_equal(rendered[55, 1], [22, 25, 29])
    assert np.array_equal(rendered[-1, -1], [255, 255, 255])


def test_rescue_runtime_exports_video_records_and_unmeasured_accuracy(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    video = tmp_path / "source.avi"
    writer = cv2.VideoWriter(str(video), cv2.VideoWriter.fourcc(*"MJPG"), 10, (100, 100))
    assert writer.isOpened()
    for index in range(5):
        writer.write(np.full((100, 100, 3), index * 30, dtype=np.uint8))
    writer.release()
    monkeypatch.setattr(
        rescue_review, "RescueDetector", lambda settings: RescueDetector(settings, _Model())
    )
    config = tmp_path / "review.yaml"
    config.write_text(
        "models:\n  - name: general\n    weights: unused.pt\n    classes: [person]\n",
        encoding="utf-8",
    )
    args = rescue_review.build_parser().parse_args(
        [
            "--video",
            str(video),
            "--config",
            str(config),
            "--output",
            str(tmp_path / "output"),
        ]
    )
    assert rescue_review.run(args) == 0
    directory = next((tmp_path / "output").iterdir())
    summary = json.loads((directory / "summary.json").read_text())
    assert summary["status"] == "completed"
    assert summary["frames_reviewed"] == 5
    assert summary["evaluation"]["status"] == "not_measured"
    records = [json.loads(line) for line in (directory / "frames.jsonl").read_text().splitlines()]
    assert all(right["source_time_s"] > left["source_time_s"] for left, right in pairwise(records))
    assert records[2]["tracks"][0]["state"] == "confirmed"
    assert (directory / "annotated.mp4").stat().st_size > 0
    assert cv2.imread(str(directory / "preview.jpg")) is not None


def test_rescue_modules_have_no_imports_of_actuation_or_ballistics() -> None:
    root = Path(__file__).parents[1] / "src" / "tracker"
    paths = [*(root / "rescue").glob("*.py"), *(root / "cli").glob("rescue_*.py")]
    forbidden = (
        "tracker.hardware",
        "tracker.ballistics",
        "tracker.control",
        "tracker.autonomy",
        "tracker.simulation",
    )
    for path in paths:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                assert not (node.module or "").startswith(forbidden), path
            elif isinstance(node, ast.Import):
                assert not any(alias.name.startswith(forbidden) for alias in node.names), path
