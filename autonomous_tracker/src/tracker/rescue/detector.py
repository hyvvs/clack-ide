from __future__ import annotations

import hashlib
from importlib import import_module
from pathlib import Path
from typing import Protocol, cast

import numpy as np
from numpy.typing import NDArray

from tracker.rescue.config import DetectorSettings
from tracker.rescue.observations import Observation, Point


class Tensor(Protocol):
    def cpu(self) -> Tensor: ...
    def numpy(self) -> np.ndarray: ...


class Boxes(Protocol):
    xyxy: Tensor
    conf: Tensor
    cls: Tensor
    id: Tensor | None


class Masks(Protocol):
    xy: list[np.ndarray]


class Result(Protocol):
    boxes: Boxes | None
    masks: Masks | None


class Model(Protocol):
    names: dict[int, str]
    task: str

    def track(self, source: np.ndarray, **kwargs: object) -> list[Result]: ...


class RescueDetector:
    def __init__(self, settings: DetectorSettings, model: Model | None = None) -> None:
        self.settings = settings
        if model is None:
            if settings.weights_sha256 is not None:
                with Path(settings.weights).open("rb") as stream:
                    actual_hash = hashlib.file_digest(stream, "sha256").hexdigest()
                if actual_hash != settings.weights_sha256:
                    raise ValueError(f"{settings.name}: model checksum does not match")
            try:
                factory = import_module("ultralytics").YOLO
            except (ImportError, AttributeError) as exc:
                raise RuntimeError('install YOLO with: python -m pip install -e ".[yolo]"') from exc
            model = cast(Model, factory(settings.weights))
        self.model = model
        if model.task not in {"detect", "segment"}:
            raise ValueError(f"{settings.name}: use a detection or instance-segmentation model")
        available = {name.casefold(): index for index, name in model.names.items()}
        unsupported = set(settings.classes) - available.keys()
        if unsupported:
            raise ValueError(
                f"{settings.name}: weights do not support {sorted(unsupported)}. "
                "Supply weights trained for those labels; editing the class list is insufficient."
            )
        self.class_ids = [available[name] for name in settings.classes]

    def detect(self, image: NDArray[np.uint8]) -> list[Observation]:
        options: dict[str, object] = {
            "persist": True,
            "tracker": self.settings.tracker,
            "classes": self.class_ids,
            "conf": self.settings.confidence,
            "imgsz": self.settings.image_size,
            "max_det": 100,
            "verbose": False,
        }
        if self.settings.device is not None:
            options["device"] = self.settings.device
        results = self.model.track(image, **options)
        if not results or results[0].boxes is None:
            return []
        result = results[0]
        boxes = result.boxes
        assert boxes is not None
        coords = np.asarray(boxes.xyxy.cpu().numpy(), dtype=np.float64)
        confidences = np.asarray(boxes.conf.cpu().numpy(), dtype=np.float64)
        labels = np.asarray(boxes.cls.cpu().numpy(), dtype=np.int64)
        ids = None if boxes.id is None else np.asarray(boxes.id.cpu().numpy(), dtype=np.int64)
        polygons = [] if result.masks is None else result.masks.xy
        observations: list[Observation] = []
        height, width = image.shape[:2]
        for index, (xyxy, confidence, label_id) in enumerate(
            zip(coords, confidences, labels, strict=True)
        ):
            if not np.all(np.isfinite(xyxy)) or not np.isfinite(confidence):
                continue
            x1, y1, x2, y2 = map(float, xyxy)
            x1, x2 = max(0.0, min(x1, width)), max(0.0, min(x2, width))
            y1, y2 = max(0.0, min(y1, height)), max(0.0, min(y2, height))
            if x2 <= x1 or y2 <= y1:
                continue
            label = self.model.names[int(label_id)].casefold()
            if label not in self.settings.classes:
                continue
            polygon: tuple[Point, ...] = ()
            if index < len(polygons):
                polygon = tuple((float(p[0]), float(p[1])) for p in polygons[index])
                if not all(np.isfinite(value) for point in polygon for value in point):
                    polygon = ()
            observations.append(
                Observation(
                    self.settings.name,
                    label,
                    float(confidence),
                    (x1, y1, x2, y2),
                    None if ids is None else int(ids[index]),
                    polygon,
                )
            )
        return observations
