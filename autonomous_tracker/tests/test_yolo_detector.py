"""Tests for the optional YOLO detector adapter without model downloads."""

from __future__ import annotations

from typing import ClassVar

import numpy as np

from tracker.config import TargetConfig
from tracker.types import Frame
from tracker.vision.detector import YOLODetector


class _FakeTensor:
    def __init__(self, values: list[object]) -> None:
        self._values = np.asarray(values)

    def cpu(self) -> _FakeTensor:
        return self

    def numpy(self) -> np.ndarray:
        return self._values


class _FakeBoxes:
    xyxy = _FakeTensor([[10.0, 20.0, 110.0, 70.0], [30.0, 40.0, 80.0, 90.0]])
    conf = _FakeTensor([0.91, 0.88])
    cls = _FakeTensor([32, 0])


class _FakeResult:
    boxes = _FakeBoxes()
    names: ClassVar[dict[int, str]] = {0: "person", 32: "sports ball"}


class _FakeModel:
    def __init__(self) -> None:
        self.options: dict[str, object] = {}

    def predict(self, source: np.ndarray, **kwargs: object) -> list[_FakeResult]:
        assert source.shape == (120, 160, 3)
        self.options = kwargs
        return [_FakeResult()]


def test_yolo_detector_filters_classes_and_converts_boxes() -> None:
    model = _FakeModel()
    config = TargetConfig(
        detector="yolo",
        yolo_class_names=["sports ball"],
        minimum_confidence=0.4,
    )
    detector = YOLODetector(config, model)
    frame = Frame(np.zeros((120, 160, 3), dtype=np.uint8), 123, 456, 7)

    detections = detector.detect(frame)

    assert len(detections) == 1
    detection = detections[0]
    assert detection.bbox_xywh == (10.0, 20.0, 100.0, 50.0)
    assert detection.center_px == (60.0, 45.0)
    assert detection.class_label == "sports ball"
    assert detection.timestamp_ns == 123
    assert model.options["conf"] == 0.4
    assert model.options["imgsz"] == 640


def test_yolo_class_specific_dimensions() -> None:
    config = TargetConfig(class_dimensions_m={"sports ball": (0.22, 0.22)})

    assert config.dimensions_for_label("sports ball") == (0.22, 0.22)
    assert config.dimensions_for_label("unknown") == (config.width_m, config.height_m)
