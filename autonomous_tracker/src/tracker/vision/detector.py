"""Pluggable image detectors with a model-free color-blob implementation."""

from __future__ import annotations

from importlib import import_module
from typing import Protocol, cast

import cv2
import numpy as np

from tracker.config import TargetConfig
from tracker.types import Frame, TargetDetection


class TargetDetector(Protocol):
    """Image detector interface."""

    def detect(self, frame: Frame) -> list[TargetDetection]:
        """Return all target detections for one frame."""
        ...


class _ArrayTensor(Protocol):
    def cpu(self) -> _ArrayTensor:
        """Return a CPU-backed tensor."""
        ...

    def numpy(self) -> np.ndarray:
        """Return a NumPy view or copy."""
        ...


class _YOLOBoxes(Protocol):
    xyxy: _ArrayTensor
    conf: _ArrayTensor
    cls: _ArrayTensor


class _YOLOResult(Protocol):
    boxes: _YOLOBoxes | None
    names: dict[int, str]


class _YOLOModel(Protocol):
    def predict(self, source: np.ndarray, **kwargs: object) -> list[_YOLOResult]:
        """Run object detection on one BGR image."""
        ...


class ColorBlobDetector:
    """Detect saturated color blobs without external model downloads."""

    def __init__(self, config: TargetConfig, minimum_area_px: float = 20.0) -> None:
        self._config = config
        self._minimum_area_px = minimum_area_px

    def detect(self, frame: Frame) -> list[TargetDetection]:
        """Find configured HSV hue blobs and return confidence from fill quality."""
        hsv = cv2.cvtColor(frame.image, cv2.COLOR_BGR2HSV)
        lower = np.array([self._config.hue_min, 80, 50], dtype=np.uint8)
        upper = np.array([self._config.hue_max, 255, 255], dtype=np.uint8)
        mask = cv2.inRange(hsv, lower, upper)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        detections: list[TargetDetection] = []
        for contour in contours:
            area = float(cv2.contourArea(contour))
            if area < self._minimum_area_px:
                continue
            x, y, width, height = cv2.boundingRect(contour)
            fill = area / max(float(width * height), 1.0)
            confidence = float(np.clip(0.5 + 0.5 * fill, 0.0, 1.0))
            detections.append(
                TargetDetection(
                    (float(x), float(y), float(width), float(height)),
                    (x + width * 0.5, y + height * 0.5),
                    confidence,
                    "color_blob",
                    frame.capture_timestamp_ns,
                )
            )
        return detections


class ArucoDetector:
    """Detect OpenCV ArUco markers without any network-fetched model."""

    def __init__(self, dictionary_id: int = cv2.aruco.DICT_4X4_50) -> None:
        self._dictionary = cv2.aruco.getPredefinedDictionary(dictionary_id)
        self._parameters = cv2.aruco.DetectorParameters()
        self._detector = cv2.aruco.ArucoDetector(self._dictionary, self._parameters)
        self.last_corners: dict[int, np.ndarray] = {}

    def detect(self, frame: Frame) -> list[TargetDetection]:
        """Return one detection for each decoded fiducial marker."""
        corners, ids, _ = self._detector.detectMarkers(frame.image)
        self.last_corners = {}
        if ids is None:
            return []
        detections: list[TargetDetection] = []
        for marker_corners, marker_id_array in zip(corners, ids, strict=True):
            marker_id = int(marker_id_array[0])
            points = np.asarray(marker_corners, dtype=np.float64).reshape(4, 2)
            x_min, y_min = points.min(axis=0)
            x_max, y_max = points.max(axis=0)
            center = points.mean(axis=0)
            self.last_corners[marker_id] = points
            detections.append(
                TargetDetection(
                    (float(x_min), float(y_min), float(x_max - x_min), float(y_max - y_min)),
                    (float(center[0]), float(center[1])),
                    1.0,
                    "aruco",
                    frame.capture_timestamp_ns,
                    marker_id,
                )
            )
        return detections


class YOLODetector:
    """Run Ultralytics YOLO detection while leaving tracking to the 3D Kalman pipeline."""

    def __init__(self, config: TargetConfig, model: _YOLOModel | None = None) -> None:
        self._config = config
        self._allowed_ids = frozenset(config.yolo_class_ids)
        self._allowed_names = frozenset(name.strip().casefold() for name in config.yolo_class_names)
        self._model = model if model is not None else self._load_model(config.yolo_model)

    def detect(self, frame: Frame) -> list[TargetDetection]:
        """Return filtered YOLO boxes with capture-time timestamps."""
        options: dict[str, object] = {
            "conf": self._config.minimum_confidence,
            "iou": self._config.yolo_iou_threshold,
            "imgsz": self._config.yolo_image_size,
            "max_det": self._config.yolo_max_detections,
            "verbose": False,
        }
        if self._config.yolo_device is not None:
            options["device"] = self._config.yolo_device
        results = self._model.predict(frame.image, **options)
        if not results or results[0].boxes is None:
            return []
        result = results[0]
        boxes = result.boxes
        assert boxes is not None
        coordinates = np.asarray(boxes.xyxy.cpu().numpy(), dtype=np.float64)
        confidences = np.asarray(boxes.conf.cpu().numpy(), dtype=np.float64)
        class_ids = np.asarray(boxes.cls.cpu().numpy(), dtype=np.int64)
        detections: list[TargetDetection] = []
        for xyxy, confidence, class_id_value in zip(
            coordinates, confidences, class_ids, strict=True
        ):
            class_id = int(class_id_value)
            class_label = result.names.get(class_id, f"class_{class_id}")
            if not self._class_allowed(class_id, class_label):
                continue
            x_min, y_min, x_max, y_max = (float(value) for value in xyxy)
            width = max(0.0, x_max - x_min)
            height = max(0.0, y_max - y_min)
            if width <= 0.0 or height <= 0.0:
                continue
            detections.append(
                TargetDetection(
                    (x_min, y_min, width, height),
                    (x_min + width * 0.5, y_min + height * 0.5),
                    float(confidence),
                    class_label,
                    frame.capture_timestamp_ns,
                )
            )
        return detections

    def _class_allowed(self, class_id: int, class_label: str) -> bool:
        if not self._allowed_ids and not self._allowed_names:
            return True
        return class_id in self._allowed_ids or class_label.casefold() in self._allowed_names

    @staticmethod
    def _load_model(model_name: str) -> _YOLOModel:
        try:
            module = import_module("ultralytics")
        except ImportError as exc:
            raise RuntimeError(
                "YOLO detector requires the optional dependency: pip install -e '.[yolo]'"
            ) from exc
        factory = getattr(module, "YOLO", None)
        if not callable(factory):
            raise RuntimeError("installed ultralytics package does not expose YOLO")
        return cast(_YOLOModel, factory(model_name))


def make_detector(config: TargetConfig) -> TargetDetector:
    """Create the configured detector with optional dependencies loaded lazily."""
    if config.detector == "aruco":
        return ArucoDetector()
    if config.detector == "color_blob":
        return ColorBlobDetector(config)
    if config.detector == "yolo":
        return YOLODetector(config)
    raise ValueError(f"detector {config.detector!r} is not valid for a real camera")
