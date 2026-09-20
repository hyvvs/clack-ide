from __future__ import annotations

import hashlib
from collections.abc import Callable
from pathlib import Path

import cv2
import numpy as np
from pydantic import Field

from tracker.rescue.annotations import AnnotationDocument, LabelFrame
from tracker.rescue.box_motion import BoxMotionTracker
from tracker.rescue.config import ReviewModel
from tracker.rescue.evaluation import TruthObject
from tracker.rescue.media import FrameReader


class PropagatedBox(ReviewModel):
    frame_index: int = Field(ge=0)
    box: TruthObject
    support: float = Field(ge=0, le=1)


class PropagationResult(ReviewModel):
    source_sha256: str
    document_sha256: str
    seed_frame: int
    proposals: list[PropagatedBox]
    stop_reason: str


def document_digest(document: AnnotationDocument) -> str:
    return hashlib.sha256(document.model_dump_json().encode("utf-8")).hexdigest()


def propagate_box(
    document: AnnotationDocument,
    frame_index: int,
    object_index: int,
    *,
    steps: int = 15,
    direction: int = 1,
    check_stop: Callable[[], None] = lambda: None,
) -> PropagationResult:
    if not 1 <= steps <= 60 or direction not in {-1, 1}:
        raise ValueError("Propagation is limited to 1-60 nearby frames, forward or backward.")
    frame = next((item for item in document.frames if item.frame_index == frame_index), None)
    if frame is None or not 0 <= object_index < len(frame.objects):
        raise ValueError("Select a corrected box in the annotation tab first.")
    seed = frame.objects[object_index]
    reader = FrameReader(Path(document.source.path))
    proposals: list[PropagatedBox] = []
    reason = "Requested range complete."
    try:
        if reader.source.sha256 != document.source.sha256:
            raise ValueError("Propagation source differs from the annotation project.")
        previous = np.asarray(
            cv2.cvtColor(reader.read(frame_index), cv2.COLOR_BGR2GRAY), dtype=np.uint8
        )
        box = seed.bbox_xyxy
        motion = BoxMotionTracker(previous, box)
        for step in range(1, steps + 1):
            check_stop()
            index = frame_index + direction * step
            if not 0 <= index < document.source.frame_count:
                reason = "Reached the end of the recording."
                break
            current = np.asarray(
                cv2.cvtColor(reader.read(index), cv2.COLOR_BGR2GRAY), dtype=np.uint8
            )
            coordinates, support, stop = motion.advance(current)
            if coordinates is None:
                reason = "Stopped: " + stop
                break
            box = coordinates
            proposals.append(
                PropagatedBox(
                    frame_index=index,
                    box=TruthObject(label=seed.label, bbox_xyxy=box, object_id=seed.object_id),
                    support=support,
                )
            )
            previous = current
    finally:
        reader.close()
    return PropagationResult(
        source_sha256=document.source.sha256,
        document_sha256=document_digest(document),
        seed_frame=frame_index,
        proposals=proposals,
        stop_reason=reason,
    )


def merge_propagation(
    document: AnnotationDocument,
    result: PropagationResult,
    *,
    append_drafts: bool = False,
) -> tuple[AnnotationDocument, list[int], list[int]]:
    if (
        document_digest(document) != result.document_sha256
        or document.source.sha256 != result.source_sha256
    ):
        raise ValueError(
            "Labels changed since propagation. Rebuild suggestions before applying them."
        )
    updated = document.model_copy(deep=True)
    frames = {frame.frame_index: frame for frame in updated.frames}
    added, protected = [], []
    for proposal in result.proposals:
        frame = frames.get(proposal.frame_index)
        if frame is not None:
            if (
                frame.reviewed
                or not append_drafts
                or any(
                    (proposal.box.object_id is not None and obj.object_id == proposal.box.object_id)
                    or (
                        min(obj.bbox_xyxy[2], proposal.box.bbox_xyxy[2])
                        > max(obj.bbox_xyxy[0], proposal.box.bbox_xyxy[0])
                        and min(obj.bbox_xyxy[3], proposal.box.bbox_xyxy[3])
                        > max(obj.bbox_xyxy[1], proposal.box.bbox_xyxy[1])
                    )
                    for obj in frame.objects
                )
            ):
                protected.append(proposal.frame_index)
                continue
        else:
            frame = LabelFrame(
                frame_index=proposal.frame_index,
                objects=[],
                suggestion_source=f"propagation:{result.source_sha256}:{result.seed_frame}",
            )
            updated.frames.append(frame)
            frames[proposal.frame_index] = frame
        frame.objects.append(proposal.box.model_copy(deep=True))
        frame.reviewed = False
        added.append(proposal.frame_index)
    return AnnotationDocument.model_validate(updated.model_dump()), added, protected
