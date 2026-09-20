from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
from pydantic import Field, model_validator
from scipy.optimize import linear_sum_assignment

from tracker.rescue.config import ReviewModel
from tracker.rescue.observations import Box, Observation


class TruthObject(ReviewModel):
    label: str = Field(min_length=1)
    bbox_xyxy: Box
    object_id: str | None = None

    @model_validator(mode="after")
    def validate_box(self) -> TruthObject:
        x1, y1, x2, y2 = self.bbox_xyxy
        if x1 < 0 or y1 < 0 or x2 <= x1 or y2 <= y1:
            raise ValueError("annotation boxes must be positive-area pixel coordinates")
        self.label = self.label.strip().casefold()
        if not self.label:
            raise ValueError("annotation label cannot be empty")
        return self


class TruthFrame(ReviewModel):
    frame_index: int = Field(ge=0)
    objects: list[TruthObject]


class GroundTruth(ReviewModel):
    schema_version: int = Field(default=1, ge=1, le=1)
    image_width: int = Field(gt=0)
    image_height: int = Field(gt=0)
    video_sha256: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    label_scope: list[str] | None = None
    frames: list[TruthFrame]

    @model_validator(mode="after")
    def validate_frames(self) -> GroundTruth:
        if self.label_scope is not None:
            self.label_scope = [label.strip().casefold() for label in self.label_scope]
            if not self.label_scope or any(not label for label in self.label_scope):
                raise ValueError("label scope must contain nonempty classes")
            if len(set(self.label_scope)) != len(self.label_scope):
                raise ValueError("label scope cannot contain duplicates")
        indices = [frame.frame_index for frame in self.frames]
        if len(indices) != len(set(indices)):
            raise ValueError("duplicate labeled frame indices")
        for frame in self.frames:
            if self.label_scope is not None and any(
                obj.label not in self.label_scope for obj in frame.objects
            ):
                raise ValueError("annotation class is outside label scope")
            identifiers = [obj.object_id for obj in frame.objects if obj.object_id is not None]
            if len(identifiers) != len(set(identifiers)):
                raise ValueError("object IDs must be unique within a labeled frame")
            if any(
                obj.bbox_xyxy[2] > self.image_width or obj.bbox_xyxy[3] > self.image_height
                for obj in frame.objects
            ):
                raise ValueError("annotation box lies outside declared image dimensions")
        return self


def box_iou(first: Box, second: Box) -> float:
    x1, y1 = max(first[0], second[0]), max(first[1], second[1])
    x2, y2 = min(first[2], second[2]), min(first[3], second[3])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    area1 = (first[2] - first[0]) * (first[3] - first[1])
    area2 = (second[2] - second[0]) * (second[3] - second[1])
    union = area1 + area2 - intersection
    return intersection / union if union > 0 else 0.0


@dataclass
class Counts:
    tp: int = 0
    fp: int = 0
    fn: int = 0

    def summary(self) -> dict[str, int | float | None]:
        return {
            "true_positives": self.tp,
            "false_positives": self.fp,
            "false_negatives": self.fn,
            "precision": self.tp / (self.tp + self.fp) if self.tp + self.fp else None,
            "recall": self.tp / (self.tp + self.fn) if self.tp + self.fn else None,
        }


@dataclass(frozen=True)
class BoxMatch:
    truth_index: int
    prediction_index: int
    iou: float


def match_boxes(
    objects: list[TruthObject], observations: list[Observation], iou_threshold: float
) -> list[BoxMatch]:
    if not 0 < iou_threshold <= 1:
        raise ValueError("IoU threshold must be in (0, 1]")
    if not objects or not observations:
        return []
    unmatched_cost = float(min(len(objects), len(observations)) + 1)
    costs = np.full((len(objects), len(observations)), unmatched_cost, dtype=np.float64)
    for row, obj in enumerate(objects):
        for column, observation in enumerate(observations):
            overlap = box_iou(obj.bbox_xyxy, observation.bbox_xyxy)
            if obj.label == observation.label and overlap >= iou_threshold:
                costs[row, column] = 1.0 - overlap
    rows, columns = linear_sum_assignment(costs)
    return [
        BoxMatch(int(row), int(column), 1.0 - float(costs[row, column]))
        for row, column in zip(rows, columns, strict=True)
        if costs[row, column] < unmatched_cost
    ]


@dataclass
class FrameEvaluation:
    frame_index: int
    objects: list[TruthObject]
    predictions: list[Observation]
    matches: list[BoxMatch]
    identity_changes: list[dict[str, str]]

    def summary(self) -> dict[str, object]:
        total = Counts(
            len(self.matches),
            len(self.predictions) - len(self.matches),
            len(self.objects) - len(self.matches),
        )
        return {
            "frame_index": self.frame_index,
            **total.summary(),
            "identity_switches": len(self.identity_changes),
            "identity_changes": self.identity_changes,
            "truth_objects": [obj.model_dump(mode="json") for obj in self.objects],
            "predictions": [asdict(obs) for obs in self.predictions],
            "matches": [asdict(match) for match in self.matches],
        }


class Evaluation:
    """Score only explicitly labeled frames, including explicitly empty frames."""

    def __init__(self, truth: GroundTruth | None, iou_threshold: float = 0.5) -> None:
        if not 0 < iou_threshold <= 1:
            raise ValueError("IoU threshold must be in (0, 1]")
        self.truth = truth
        self.frames = {} if truth is None else {frame.frame_index: frame for frame in truth.frames}
        self.iou_threshold = iou_threshold
        self.counts: dict[str, Counts] = {}
        self.evaluated_frames = 0
        self.identity_switches = 0
        self.tracked_matches = 0
        self._identities: dict[str, str] = {}
        self._last_index = -1

    def update(self, index: int, observations: list[Observation]) -> FrameEvaluation | None:
        if index <= self._last_index:
            raise ValueError("evaluation frame indices must strictly increase")
        self._last_index = index
        frame = self.frames.get(index)
        if frame is None:
            return None
        if self.truth is not None and self.truth.label_scope is not None:
            observations = [obs for obs in observations if obs.label in self.truth.label_scope]
        self.evaluated_frames += 1
        objects = frame.objects
        matches = match_boxes(objects, observations, self.iou_threshold)
        matched_predictions = {match.prediction_index for match in matches}
        matched_truth = {match.truth_index for match in matches}
        identity_changes: list[dict[str, str]] = []
        for match in matches:
            obj, observation = objects[match.truth_index], observations[match.prediction_index]
            self.counts.setdefault(obj.label, Counts()).tp += 1
            if obj.object_id is not None and observation.key is not None:
                self.tracked_matches += 1
                previous = self._identities.get(obj.object_id)
                if previous is not None and previous != observation.key:
                    self.identity_switches += 1
                    identity_changes.append(
                        {
                            "object_id": obj.object_id,
                            "previous": previous,
                            "current": observation.key,
                        }
                    )
                self._identities[obj.object_id] = observation.key
        for row, obj in enumerate(objects):
            if row not in matched_truth:
                self.counts.setdefault(obj.label, Counts()).fn += 1
        for column, observation in enumerate(observations):
            if column not in matched_predictions:
                self.counts.setdefault(observation.label, Counts()).fp += 1
        return FrameEvaluation(
            index,
            [obj.model_copy(deep=True) for obj in objects],
            list(observations),
            matches,
            identity_changes,
        )

    def summary(self) -> dict[str, object]:
        measured = self.evaluated_frames > 0
        total = Counts(
            sum(c.tp for c in self.counts.values()),
            sum(c.fp for c in self.counts.values()),
            sum(c.fn for c in self.counts.values()),
        )
        return {
            "status": "measured" if measured else "not_measured",
            "labeled_frames_available": len(self.frames),
            "labeled_frames_evaluated": self.evaluated_frames,
            "iou_threshold": self.iou_threshold,
            "label_scope": None if self.truth is None else self.truth.label_scope,
            "overall": total.summary() if measured else None,
            "per_class": {label: counts.summary() for label, counts in sorted(self.counts.items())},
            "identity_switches": self.identity_switches if self.tracked_matches else None,
            "tracked_matches": self.tracked_matches,
            "note": (
                "Fixed-threshold box matching, not mAP; unlabeled frames are excluded. "
                "ID changes count across matched labeled observations, including gaps."
            ),
        }


def load_ground_truth(path: Path | None) -> GroundTruth | None:
    return (
        None
        if path is None
        else GroundTruth.model_validate(json.loads(path.read_text(encoding="utf-8")))
    )
