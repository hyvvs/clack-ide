"""Training-only plans that leave saved annotation projects untouched."""

from __future__ import annotations

from dataclasses import dataclass

from tracker.rescue.annotations import AnnotationDocument


@dataclass(frozen=True)
class PracticePlan:
    classes: tuple[str, ...]
    unused: tuple[str, ...]
    reviewed_frames: int
    boxes: int


def practice_plan(document: AnnotationDocument) -> PracticePlan:
    if document.split in {"validation", "test"}:
        raise ValueError(
            "This video is reserved for checking or final testing. "
            "Choose teaching footage, or explicitly change its purpose in Advanced."
        )
    reviewed = [frame for frame in document.frames if frame.reviewed]
    if not reviewed:
        raise ValueError("Approve some frames in Label video first. Your boxes are already saved.")
    used = {obj.label for frame in document.frames for obj in frame.objects}
    approved = {obj.label for frame in reviewed for obj in frame.objects}
    if not approved:
        raise ValueError("Approve at least one frame with an object box before training.")
    if missing := used - approved:
        raise ValueError(
            "These tags have boxes only in draft frames: "
            + ", ".join(sorted(missing))
            + ". Review an example of each first; they will not be silently discarded."
        )
    return PracticePlan(
        tuple(sorted(approved)),
        tuple(sorted(set(document.classes) - used)),
        len(reviewed),
        sum(len(frame.objects) for frame in reviewed),
    )
