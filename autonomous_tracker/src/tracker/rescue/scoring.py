from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast
from uuid import uuid4

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, model_validator

from tracker.rescue.annotations import AnnotationDocument
from tracker.rescue.evaluation import Evaluation, TruthObject
from tracker.rescue.observations import Observation


class SavedObservation(TruthObject):
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)
    model: str = Field(min_length=1)
    confidence: float = Field(ge=0, le=1)
    tracker_id: int | None = Field(default=None, ge=0)

    def observation(self) -> Observation:
        return Observation(self.model, self.label, self.confidence, self.bbox_xyxy, self.tracker_id)


class SavedFrame(BaseModel):
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)
    schema_version: int = Field(ge=1, le=1)
    frame_index: int = Field(ge=0)
    source_time_s: float = Field(ge=0)
    read_process_encode_ms: float = Field(ge=0)
    observations: list[SavedObservation]

    @model_validator(mode="after")
    def validate_ids(self) -> SavedFrame:
        keys = [
            (obs.model, obs.tracker_id) for obs in self.observations if obs.tracker_id is not None
        ]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate model tracking IDs in a saved frame")
        return self


class RunMetadata(BaseModel):
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)
    schema_version: int = Field(ge=1, le=1)
    status: str
    frames_reviewed: int = Field(gt=0)
    image_dimensions: tuple[int, int]
    source_video_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    model_settings: dict[str, Any]
    timing_note: str


def annotation_digest(document: AnnotationDocument) -> str:
    payload = document.to_truth().model_dump_json()
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def score_saved_run(
    run_directory: Path, document: AnnotationDocument, iou_threshold: float = 0.5
) -> dict[str, Any]:
    truth = document.to_truth()
    if not truth.frames:
        raise ValueError("mark at least one frame reviewed before evaluating")
    metadata_path = run_directory / "summary.json"
    metadata_bytes = metadata_path.read_bytes()
    raw = json.loads(metadata_bytes)
    if not isinstance(raw, dict) or not raw.get("source_video_sha256"):
        raise ValueError(
            "legacy run has no video checksum; rerun rescue_review once to bind its source"
        )
    metadata = RunMetadata.model_validate(raw)
    if metadata.status not in {"completed", "frame_limit_reached", "operator_stopped"}:
        raise ValueError("cannot evaluate an unfinished or failed run")
    if metadata.source_video_sha256 != document.source.sha256:
        raise ValueError("saved run belongs to a different video (SHA256 mismatch)")
    if metadata.image_dimensions != (truth.image_width, truth.image_height):
        raise ValueError("saved run dimensions differ from annotations")
    evaluator = Evaluation(truth, iou_threshold)
    labeled_indices = {frame.frame_index for frame in truth.frames}
    seen: set[int] = set()
    per_frame: list[dict[str, Any]] = []
    timings: list[float] = []
    fingerprint = hashlib.sha256()
    last_time = -1.0
    count = 0
    with (run_directory / "frames.jsonl").open("rb") as stream:
        while line := stream.readline(8 * 1024 * 1024 + 1):
            if len(line) > 8 * 1024 * 1024:
                raise ValueError("saved frame record exceeds 8 MB")
            fingerprint.update(line)
            frame = SavedFrame.model_validate_json(line)
            if frame.frame_index != count or frame.source_time_s <= last_time:
                raise ValueError("saved frames must be contiguous and timestamps must increase")
            if frame.frame_index >= document.source.frame_count:
                raise ValueError("saved frame index exceeds source video length")
            if any(
                obs.bbox_xyxy[2] > truth.image_width or obs.bbox_xyxy[3] > truth.image_height
                for obs in frame.observations
            ):
                raise ValueError("saved observation box is outside the video")
            last_time = frame.source_time_s
            observations = [obs.observation() for obs in frame.observations]
            scored = evaluator.update(frame.frame_index, observations)
            timings.append(frame.read_process_encode_ms)
            if scored is not None:
                seen.add(frame.frame_index)
                per_frame.append({**scored.summary(), "source_time_s": frame.source_time_s})
            count += 1
    if count != metadata.frames_reviewed:
        raise ValueError("saved frame count does not match run summary (truncated or changed log)")
    if metadata_path.read_bytes() != metadata_bytes:
        raise ValueError("run metadata changed during evaluation; retry after the run finishes")
    measured = evaluator.summary()
    overall = cast(dict[str, Any] | None, measured["overall"])
    negative_frames = {
        frame.frame_index
        for frame in truth.frames
        if not frame.objects and frame.frame_index in seen
    }
    false_positive_frames = sum(row["false_positives"] > 0 for row in per_frame)
    negative_with_fp = sum(
        row["false_positives"] > 0 and row["frame_index"] in negative_frames for row in per_frame
    )
    labeled_minutes = len(seen) / document.source.nominal_fps / 60
    return {
        "schema_version": 1,
        "created_utc": datetime.now(UTC).isoformat(),
        "run_directory": str(run_directory.resolve()),
        "source_video_sha256": document.source.sha256,
        "source_nominal_fps": document.source.nominal_fps,
        "prediction_log_sha256": fingerprint.hexdigest(),
        "run_summary_sha256": hashlib.sha256(metadata_bytes).hexdigest(),
        "annotation_sha256": annotation_digest(document),
        "incident_id": document.incident_id,
        "split": document.split,
        "model_settings": metadata.model_settings,
        "evaluation": measured,
        "coverage": {
            "reviewed_frames": len(truth.frames),
            "scored_frames": len(seen),
            "missing_prediction_frames": sorted(labeled_indices - seen),
            "source_frames": document.source.frame_count,
            "complete_for_reviewed_frames": seen == labeled_indices,
        },
        "false_positives": {
            "frames_with_false_positives": false_positive_frames,
            "fraction_of_scored_frames": false_positive_frames / len(seen) if seen else None,
            "reviewed_negative_frames": len(negative_frames),
            "negative_frames_with_false_positives": negative_with_fp,
            "box_detections_per_labeled_minute_nominal_fps": (
                overall["false_positives"] / labeled_minutes
                if overall and labeled_minutes
                else None
            ),
            "note": (
                "Repeated boxes count on each frame, not independent alarm events. "
                "Minute rate uses reviewed-frame count / nominal FPS, not the span between sparse "
                "labels; variable-rate media can make this rate inaccurate."
            ),
        },
        "processing_ms": {
            "p50": float(np.median(timings)) if timings else None,
            "p95": float(np.percentile(timings, 95)) if timings else None,
            "frames": len(timings),
            "note": "Recomputed across all saved frames. Source run note: " + metadata.timing_note,
        },
        "per_frame": per_frame,
        "unscored_reviewed_frames": [
            frame.model_dump(mode="json") for frame in truth.frames if frame.frame_index not in seen
        ],
        "frame_detail_schema_version": 1,
        "limitations": [
            "Human labels must cover every visible object in the declared class scope.",
            "Fixed-IoU box metrics, not mAP, incident recall, independent alarm rate or readiness.",
            "Select models and thresholds on validation data, not the final test incident.",
        ],
    }


def save_evaluation(
    output_root: Path, document: AnnotationDocument, result: dict[str, Any]
) -> Path:
    if annotation_digest(document) != result["annotation_sha256"]:
        raise ValueError("evaluation does not match the annotation snapshot")
    directory = output_root / f"evaluation-{datetime.now(UTC):%Y%m%d-%H%M%S}-{uuid4().hex[:8]}"
    directory.mkdir(parents=True, exist_ok=False)
    for name, payload in (
        ("summary.json", result),
        ("annotations.json", document.to_truth().model_dump(mode="json")),
    ):
        with (directory / name).open("x", encoding="utf-8") as stream:
            json.dump(payload, stream, indent=2, allow_nan=False)
            stream.write("\n")
    return directory
