from __future__ import annotations

import hashlib
import json
import math
from bisect import bisect_left, insort
from collections.abc import Callable
from pathlib import Path

import cv2
import numpy as np
from pydantic import Field, model_validator

from tracker.rescue.annotations import AnnotationDocument
from tracker.rescue.config import ReviewModel
from tracker.rescue.media import FrameReader
from tracker.rescue.scoring import SavedFrame
from tracker.rescue.state_store import StateStore
from tracker.rescue.suggestions import load_suggestions


class ReviewCandidate(ReviewModel):
    frame_index: int = Field(ge=0, strict=True)
    priority: float = Field(ge=0, le=1)
    reasons: list[str] = Field(min_length=1)


class QueueBookmark(ReviewModel):
    cursor: int | None = Field(default=None, ge=0)
    skipped: dict[str, str] = Field(default_factory=dict)


class AssistedQueue(ReviewModel):
    schema_version: int = Field(default=1, ge=1, le=1)
    source_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    classes: list[str]
    run_directory: str = ""
    run_sha256: str = ""
    candidates: list[ReviewCandidate] = Field(max_length=1000)
    bookmark: QueueBookmark = Field(default_factory=QueueBookmark)
    undo: list[QueueBookmark] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def unique_frames(self) -> AssistedQueue:
        indices = [item.frame_index for item in self.candidates]
        if len(indices) != len(set(indices)):
            raise ValueError("Review queue contains duplicate frames.")
        if self.bookmark.cursor is not None and self.bookmark.cursor not in indices:
            raise ValueError("Saved review cursor is outside the queue.")
        return self


def frame_revision(document: AnnotationDocument, index: int) -> str:
    frame = next((frame for frame in document.frames if frame.frame_index == index), None)
    raw = json.dumps(
        {
            "classes": sorted(document.classes),
            "frame": None if frame is None else frame.model_dump(),
        },
        sort_keys=True,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def candidate_status(queue: AssistedQueue, document: AnnotationDocument, index: int) -> str:
    if any(frame.frame_index == index and frame.reviewed for frame in document.frames):
        return "Reviewed"
    if queue.bookmark.skipped.get(str(index)) == frame_revision(document, index):
        return "Skipped"
    return "Pending"


def queue_path(project: Path) -> Path:
    return project.parent / ".studio" / f"{project.name}.queue.json"


def load_queue(store: StateStore, document: AnnotationDocument) -> AssistedQueue | None:
    payload = store.read()
    if payload is None:
        return None
    queue = AssistedQueue.model_validate_json(payload)
    if queue.source_sha256 != document.source.sha256 or any(
        item.frame_index >= document.source.frame_count for item in queue.candidates
    ):
        raise ValueError("Saved review queue belongs to a different video.")
    if set(queue.classes) != set(document.classes):
        raise ValueError("Tags changed. Build a new review queue for the current scope.")
    return queue


def next_candidate(queue: AssistedQueue, document: AnnotationDocument) -> int | None:
    cursor = queue.bookmark.cursor
    ordered = [item.frame_index for item in queue.candidates]
    if cursor in ordered:
        pivot = ordered.index(cursor)
        ordered = ordered[pivot:] + ordered[:pivot]
    return next(
        (index for index in ordered if candidate_status(queue, document, index) == "Pending"), None
    )


def skip_candidate(queue: AssistedQueue, document: AnnotationDocument, index: int) -> AssistedQueue:
    if index not in {item.frame_index for item in queue.candidates}:
        raise ValueError("Open a suggested frame before skipping it.")
    updated = queue.model_copy(deep=True)
    updated.undo = [*updated.undo[-19:], updated.bookmark.model_copy(deep=True)]
    updated.bookmark.skipped[str(index)] = frame_revision(document, index)
    updated.bookmark.cursor = next_candidate(updated, document)
    return updated


def build_queue(
    document: AnnotationDocument,
    run: Path | None = None,
    *,
    limit: int = 150,
    check_stop: Callable[[], None] = lambda: None,
    progress: Callable[[str], None] = lambda _: None,
) -> AssistedQueue:
    if not 1 <= limit <= 1000:
        raise ValueError("Choose between 1 and 1000 suggested frames.")
    suggestions = None
    scores: dict[int, tuple[float, set[str]]] = {}
    detected: set[int] = set()
    reviewed = {frame.frame_index for frame in document.frames if frame.reviewed}

    def add(index: int, score: float, reason: str) -> None:
        if index in reviewed:
            return
        previous, reasons = scores.setdefault(index, (0, set()))
        reasons.add(reason)
        scores[index] = max(previous, score), reasons

    if run is not None:
        progress("Checking recognition source and reading detection signals...")
        suggestions = load_suggestions(run, document)
        previous_tracks: dict[tuple[str, int], tuple[float, float]] = {}
        previous_count = 0
        fingerprint = hashlib.sha256()
        with (run / "frames.jsonl").open("rb") as stream:
            for line in stream:
                check_stop()
                fingerprint.update(line)
                frame = SavedFrame.model_validate_json(line)
                observations = [obs for obs in frame.observations if obs.label in document.classes]
                if observations:
                    detected.add(frame.frame_index)
                tracks = {}
                for obs in observations:
                    if obs.confidence < 0.65:
                        add(frame.frame_index, 1 - obs.confidence * 0.5, "Low-confidence detection")
                    if obs.tracker_id is None:
                        continue
                    key = obs.model, obs.tracker_id
                    x1, y1, x2, y2 = obs.bbox_xyxy
                    center = (x1 + x2) / 2, (y1 + y2) / 2
                    if (
                        key in previous_tracks
                        and math.dist(center, previous_tracks[key])
                        > math.hypot(document.source.width, document.source.height) * 0.08
                    ):
                        add(frame.frame_index, 0.85, "Abrupt box movement")
                    tracks[key] = center
                if previous_tracks.keys() - tracks.keys():
                    add(frame.frame_index, 0.8, "Track disappeared or ID changed")
                if previous_count == 0 and observations:
                    add(frame.frame_index, 0.7, "Objects appeared")
                previous_tracks, previous_count = tracks, len(observations)
        if fingerprint.hexdigest() != suggestions.source_hash:
            raise ValueError("Recognition log changed while building the queue.")
    reader = FrameReader(Path(document.source.path))
    uniform: list[int] = []
    try:
        if reader.source.sha256 != document.source.sha256:
            raise ValueError("Source video changed. Reopen the original project.")
        stride = max(
            1, round(document.source.nominal_fps), math.ceil(document.source.frame_count / 2000)
        )
        indices = list(range(0, document.source.frame_count, stride))
        if document.source.frame_count - 1 not in indices:
            indices.append(document.source.frame_count - 1)
        previous: np.ndarray | None = None
        for count, index in enumerate(indices):
            check_stop()
            image = reader.read(index)
            thumbnail = (
                cv2.resize(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), (64, 36)).astype(np.float32)
                / 255
            )
            if previous is not None and float(np.mean(np.abs(thumbnail - previous))) > 0.18:
                add(index, 0.9, "Sampled scene / lighting change")
            previous = thumbnail
            if index not in reviewed:
                uniform.append(index)
                reason = (
                    "Coverage sample"
                    if suggestions is None
                    else "Coverage sample: no saved detection"
                    if index not in detected
                    else "Coverage sample"
                )
                add(index, 0.2, reason)
            if count % 30 == 0:
                progress(f"Sampling scenes: {count + 1}/{len(indices)}")
    finally:
        reader.close()
    # Reserve coverage samples so confident misses are not invisible to the queue.
    coverage_budget = min(len(uniform), max(1, limit // 3))
    reserved = (
        {uniform[int(index)] for index in np.linspace(0, len(uniform) - 1, coverage_budget)}
        if uniform
        else set()
    )
    selected = set(reserved)
    ordered = sorted(selected)
    separation = max(1, round(document.source.nominal_fps * 0.5))
    for index in sorted(scores, key=lambda item: (-scores[item][0], item)):
        if len(selected) >= limit:
            break
        position = bisect_left(ordered, index)
        neighbours = ordered[max(0, position - 1) : position + 1]
        if all(abs(index - other) >= separation for other in neighbours):
            selected.add(index)
            insort(ordered, index)
    candidates = [
        ReviewCandidate(
            frame_index=index, priority=scores[index][0], reasons=sorted(scores[index][1])
        )
        for index in sorted(selected, key=lambda item: (-scores[item][0], item))
    ]
    return AssistedQueue(
        source_sha256=document.source.sha256,
        classes=document.classes.copy(),
        run_directory=str(run.resolve()) if run else "",
        run_sha256=suggestions.source_hash if suggestions else "",
        candidates=candidates,
    )
