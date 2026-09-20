from __future__ import annotations

from dataclasses import dataclass

from tracker.rescue.annotations import AnnotationDocument, LabelFrame
from tracker.rescue.tracking_labels import attention_count, box_identity, box_state


def frame_range(document: AnnotationDocument, start: int, end: int) -> range:
    if not 0 <= start <= end < document.source.frame_count:
        raise ValueError(
            f"Use an inclusive frame range from 0 to {document.source.frame_count - 1}."
        )
    return range(start, end + 1)


def timestamp(index: int, fps: float) -> str:
    milliseconds = round(index * 1000 / fps)
    seconds, ms = divmod(milliseconds, 1000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02}:{minutes:02}:{seconds:02}.{ms:03}"


@dataclass(frozen=True)
class BoxOccurrence:
    frame_index: int
    object_index: int
    label: str
    identity: str
    state: str
    reviewed: bool
    coordinates: tuple[float, float, float, float]


def box_occurrences(
    document: AnnotationDocument, query: str = "", state: str = "All"
) -> list[BoxOccurrence]:
    terms = query.casefold().split()
    result: list[BoxOccurrence] = []
    for frame in sorted(document.frames, key=lambda item: item.frame_index):
        for index, obj in enumerate(frame.objects):
            identity, status = box_identity(frame, index), box_state(frame, index)
            searchable = f"{obj.label} {identity} {status} {frame.frame_index}".casefold()
            if any(term not in searchable for term in terms):
                continue
            if state == "Reviewed" and not frame.reviewed:
                continue
            if state == "Draft" and frame.reviewed:
                continue
            if state == "Needs attention" and status != state:
                continue
            result.append(
                BoxOccurrence(
                    frame.frame_index,
                    index,
                    obj.label,
                    identity,
                    status,
                    frame.reviewed,
                    obj.bbox_xyxy,
                )
            )
    return result


@dataclass(frozen=True)
class ReviewChanges:
    changed: int
    already: int
    empty_excluded: int
    attention_blocked: int
    negatives: int

    def describe(self) -> str:
        return (
            f"{self.changed} frames will change ({self.negatives} empty negatives).\n"
            f"{self.already} already in that state; {self.empty_excluded} empty frames excluded; "
            f"{self.attention_blocked} frames blocked by Needs attention."
        )


def bulk_review(
    document: AnnotationDocument,
    start: int,
    end: int,
    *,
    reviewed: bool,
    include_empty: bool = False,
) -> tuple[AnnotationDocument, ReviewChanges]:
    indices = frame_range(document, start, end)
    if len(indices) > 10000:
        raise ValueError("Review at most 10,000 frames at a time. Narrow the range.")
    frames = {frame.frame_index: frame.model_copy(deep=True) for frame in document.frames}
    changed = already = empty = blocked = negatives = 0
    for index in indices:
        frame = frames.get(index, LabelFrame(frame_index=index, objects=[]))
        if frame.reviewed == reviewed:
            already += 1
        elif reviewed and attention_count(frame):
            blocked += 1
        elif reviewed and not frame.objects and not include_empty:
            empty += 1
        else:
            frame.reviewed = reviewed
            if reviewed:
                for link in frame.box_links.values():
                    link.generated = None
                negatives += not frame.objects
            frames[index] = frame
            changed += 1
    payload = document.model_dump()
    payload["frames"] = [frames[index].model_dump() for index in sorted(frames)]
    return AnnotationDocument.model_validate(payload), ReviewChanges(
        changed, already, empty, blocked, negatives
    )
