from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Literal
from uuid import uuid4

import cv2
import numpy as np
from numpy.typing import NDArray
from pydantic import Field

from tracker.rescue.annotations import AnnotationDocument, BoxLink, LabelFrame
from tracker.rescue.box_motion import BoxMotionTracker
from tracker.rescue.config import ReviewModel
from tracker.rescue.evaluation import TruthObject
from tracker.rescue.media import FrameReader
from tracker.rescue.propagation import document_digest

MAX_TRACK_FRAMES = 5000
MAX_TRACK_BOXES = 100_000


class TrackSeed(ReviewModel):
    track_key: str
    object_index: int | None
    box: TruthObject | None
    until_frame: int
    boundary: str = "Requested range complete."


class TrackProposal(ReviewModel):
    track_key: str
    frame_index: int
    box: TruthObject
    support: float | None = None
    needs_attention: str | None = None


class TrackStop(ReviewModel):
    track_key: str
    label: str
    last_frame: int
    reason: str


class TrackingResult(ReviewModel):
    document_sha256: str
    source_sha256: str
    seed_frame: int
    end_frame: int
    method: Literal["motion", "fixed"]
    seeds: list[TrackSeed]
    proposals: list[TrackProposal] = Field(default_factory=list, max_length=MAX_TRACK_BOXES)
    stops: list[TrackStop] = Field(default_factory=list)


class TrackingChanges(ReviewModel):
    added: int = 0
    replaced: int = 0
    removed: int = 0
    protected: int = 0
    frames: list[int] = Field(default_factory=list)

    @property
    def count(self) -> int:
        return self.added + self.replaced + self.removed

    def describe(self) -> str:
        return (
            f"{self.added} added, {self.replaced} updated, {self.removed} stale drafts removed; "
            f"{self.protected} conflicts protected, across {len(self.frames)} changed frames."
        )


def machine_box(frame: LabelFrame, index: int, track_key: str) -> bool:
    link = frame.box_links.get(index)
    return (
        not frame.reviewed
        and link is not None
        and link.track_key == track_key
        and link.generated is not None
        and not link.needs_attention
        and frame.objects[index] == link.generated
    )


def tracking_seeds(
    document: AnnotationDocument, start: int, end: int, selected: list[int] | None
) -> list[TrackSeed]:
    if not 0 <= start < end < document.source.frame_count:
        raise ValueError("Choose an end frame after the current frame, within this video.")
    if end - start > MAX_TRACK_FRAMES:
        raise ValueError(f"Use ranges of at most {MAX_TRACK_FRAMES} frames, then continue.")
    frame = next((frame for frame in document.frames if frame.frame_index == start), None)
    if frame is None:
        raise ValueError("Draw or select boxes on the current frame first.")
    indices = list(range(len(frame.objects))) if selected is None else sorted(set(selected))
    if any(not 0 <= index < len(frame.objects) for index in indices):
        raise ValueError("Selected box no longer exists.")
    if any(frame.box_links[i].needs_attention for i in indices if i in frame.box_links):
        raise ValueError(
            "Resolve Needs attention boxes first: move/resize, confirm, or delete them."
        )
    seeds = [
        TrackSeed(
            track_key=frame.box_links[index].track_key if index in frame.box_links else uuid4().hex,
            object_index=index,
            box=frame.objects[index].model_copy(deep=True),
            until_frame=end,
        )
        for index in indices
    ]
    if selected is None:
        seeds.extend(
            TrackSeed(track_key=key, object_index=None, box=None, until_frame=end)
            for key in frame.blocked_tracks
        )
    if not seeds:
        raise ValueError("No boxes or previously tracked deletions on this frame.")
    if len(seeds) > 512 or len(seeds) * (end - start) > MAX_TRACK_BOXES:
        raise ValueError("Choose fewer boxes or a shorter range (maximum 100,000 box-frames).")
    future = sorted(
        (item for item in document.frames if start < item.frame_index <= end),
        key=lambda item: item.frame_index,
    )
    for seed in seeds:
        for item in future:
            linked = next(
                (
                    index
                    for index, link in item.box_links.items()
                    if link.track_key == seed.track_key
                ),
                None,
            )
            if (
                item.reviewed
                or seed.track_key in item.blocked_tracks
                or (linked is not None and not machine_box(item, linked, seed.track_key))
            ):
                seed.until_frame = item.frame_index - 1
                seed.boundary = f"Stopped before protected keyframe {item.frame_index}."
                break
    return seeds


def track_frames(
    document: AnnotationDocument,
    start: int,
    end: int,
    selected: list[int] | None = None,
    *,
    method: Literal["motion", "fixed"] = "motion",
    check_stop: Callable[[], None] = lambda: None,
    progress: Callable[[str], None] = lambda _: None,
    frame_pair: tuple[NDArray[np.uint8], NDArray[np.uint8]] | None = None,
) -> TrackingResult:
    # The editor supplies its verified adjacent frames to avoid hashing the video on every Next.
    if frame_pair is not None and (
        end != start + 1
        or any(
            frame.shape != (document.source.height, document.source.width, 3)
            or frame.dtype != np.uint8
            for frame in frame_pair
        )
    ):
        raise ValueError("Prepared frames must be the verified adjacent pair at video resolution.")
    check_stop()
    seeds = tracking_seeds(document, start, end, selected)
    result = TrackingResult(
        document_sha256=document_digest(document),
        source_sha256=document.source.sha256,
        seed_frame=start,
        end_frame=end,
        method=method,
        seeds=seeds,
    )
    active = {
        seed.track_key: seed.box.model_copy(deep=True) for seed in seeds if seed.box is not None
    }
    limits = {seed.track_key: seed for seed in seeds}
    last = {key: start for key in active}
    reasons: dict[str, str] = {}
    reader = None
    previous = None
    motion: dict[str, BoxMotionTracker] = {}
    try:
        if method == "motion" and active:
            if frame_pair is None:
                reader = FrameReader(Path(document.source.path))
                if reader.source.sha256 != document.source.sha256 or (
                    reader.source.width,
                    reader.source.height,
                    reader.source.frame_count,
                ) != (document.source.width, document.source.height, document.source.frame_count):
                    raise ValueError("Tracking source differs from the annotation video.")
                first_image = reader.read(start)
            else:
                first_image = frame_pair[0]
            previous = np.asarray(
                cv2.cvtColor(first_image, cv2.COLOR_BGR2GRAY),
                dtype=np.uint8,
            )
            motion = {key: BoxMotionTracker(previous, box.bbox_xyxy) for key, box in active.items()}
        for index in range(start + 1, end + 1):
            check_stop()
            active = {key: box for key, box in active.items() if index <= limits[key].until_frame}
            if not active:
                break
            current = None
            scene_changed = False
            if method == "motion" and (reader is not None or frame_pair is not None):
                if frame_pair is not None:
                    next_image = frame_pair[1]
                else:
                    assert reader is not None
                    next_image = reader.read(index)
                current = np.asarray(
                    cv2.cvtColor(next_image, cv2.COLOR_BGR2GRAY),
                    dtype=np.uint8,
                )
                if previous is not None:
                    before = cv2.resize(previous, (48, 32)).astype(np.float32)
                    after = cv2.resize(current, (48, 32)).astype(np.float32)
                    scene_changed = float(np.mean(np.abs(before - after))) > 80
            for key, box in list(active.items()):
                check_stop()
                support = None
                if previous is not None and current is not None:
                    if scene_changed:
                        coordinates, support, reason = None, 0.0, "Scene or lighting changed."
                    else:
                        coordinates, support, reason = motion[key].advance(current)
                    if coordinates is None:
                        reasons[key] = f"Stopped at frame {index}: {reason}"
                        del active[key]
                        continue
                    box = box.model_copy(update={"bbox_xyxy": coordinates})
                    active[key] = box
                result.proposals.append(
                    TrackProposal(
                        track_key=key,
                        frame_index=index,
                        box=box.model_copy(deep=True),
                        support=support,
                    )
                )
                last[key] = index
            previous = current
            if (index - start) % 10 == 0 or index == end:
                progress(
                    f"Frame {index}/{end}: {len(active)} boxes continuing; "
                    f"{len(result.proposals)} draft suggestions."
                )
    finally:
        if reader is not None:
            reader.close()
    result.stops = [
        TrackStop(
            track_key=seed.track_key,
            label=f"{seed.box.label} (box {seed.object_index + 1})"
            if seed.box and seed.object_index is not None
            else "Deleted track",
            last_frame=last.get(seed.track_key, start),
            reason=reasons.get(seed.track_key, seed.boundary)
            if seed.box
            else "Deleted at starting frame.",
        )
        for seed in seeds
    ]
    return result


def overlaps(one: TruthObject, two: TruthObject) -> bool:
    return min(one.bbox_xyxy[2], two.bbox_xyxy[2]) > max(
        one.bbox_xyxy[0], two.bbox_xyxy[0]
    ) and min(one.bbox_xyxy[3], two.bbox_xyxy[3]) > max(one.bbox_xyxy[1], two.bbox_xyxy[1])


def merge_tracking(
    document: AnnotationDocument, result: TrackingResult, *, update_generated: bool = True
) -> tuple[AnnotationDocument, TrackingChanges]:
    if (
        document_digest(document) != result.document_sha256
        or document.source.sha256 != result.source_sha256
    ):
        raise ValueError(
            "Labels changed after the preview. Preview again from the corrected frame."
        )
    updated = document.model_copy(deep=True)
    frames = {frame.frame_index: frame for frame in updated.frames}
    seeds = {seed.track_key: seed for seed in result.seeds}
    proposals: dict[int, dict[str, TrackProposal]] = {}
    for proposal in result.proposals:
        proposals.setdefault(proposal.frame_index, {})[proposal.track_key] = proposal
    changes = TrackingChanges()
    indices = sorted(
        set(proposals)
        | {index for index in frames if result.seed_frame < index <= result.end_frame}
    )
    for index in indices:
        frame = frames.get(index, LabelFrame(frame_index=index, objects=[]))
        before = frame.model_copy(deep=True)
        if frame.reviewed:
            continue
        incoming = proposals.get(index, {}).copy()
        objects: list[TruthObject] = []
        links: dict[int, BoxLink] = {}
        for old_index, obj in enumerate(frame.objects):
            link = frame.box_links.get(old_index)
            key = link.track_key if link else ""
            can_update = (
                update_generated
                and key in seeds
                and index <= seeds[key].until_frame
                and machine_box(frame, old_index, key)
            )
            if can_update:
                replacement = incoming.pop(key, None)
                if replacement is None:
                    changes.removed += 1
                    continue
                if any(
                    other_index != old_index
                    and (
                        (
                            replacement.box.object_id is not None
                            and replacement.box.object_id == other.object_id
                        )
                        or (
                            overlaps(replacement.box, other)
                            and (
                                other_index not in frame.box_links
                                or not machine_box(
                                    frame, other_index, frame.box_links[other_index].track_key
                                )
                            )
                        )
                    )
                    for other_index, other in enumerate(frame.objects)
                ):
                    changes.protected += 1
                else:
                    new_link = proposal_link(replacement, result.method)
                    if obj != replacement.box or link != new_link:
                        changes.replaced += 1
                    obj = replacement.box.model_copy(deep=True)
                    link = new_link
            if link is not None:
                links[len(objects)] = link.model_copy(deep=True)
            objects.append(obj.model_copy(deep=True))
        for key, proposal in incoming.items():
            if any(
                (proposal.box.object_id is not None and proposal.box.object_id == obj.object_id)
                or (link.track_key == key if (link := links.get(i)) else False)
                or (
                    overlaps(proposal.box, obj)
                    and (
                        i not in links
                        or links[i].track_key not in seeds
                        or links[i].generated is None
                        or obj != links[i].generated
                    )
                )
                for i, obj in enumerate(objects)
            ):
                changes.protected += 1
                continue
            links[len(objects)] = proposal_link(proposal, result.method)
            objects.append(proposal.box.model_copy(deep=True))
            changes.added += 1
        frame.objects, frame.box_links = objects, links
        if frame != before:
            if frame.suggestion_source is None:
                frame.suggestion_source = f"tracking:{result.source_sha256}:{result.seed_frame}"
            changes.frames.append(index)
            frames[index] = frame
    if changes.count:
        seed_frame = frames[result.seed_frame]
        for seed in result.seeds:
            if seed.object_index is not None:
                anchor = seed_frame.box_links.get(
                    seed.object_index, BoxLink(track_key=seed.track_key)
                )
                anchor.generated = None
                seed_frame.box_links[seed.object_index] = anchor
        updated.frames = sorted(frames.values(), key=lambda frame: frame.frame_index)
    return AnnotationDocument.model_validate(updated.model_dump()), changes


def proposal_link(proposal: TrackProposal, method: Literal["motion", "fixed"]) -> BoxLink:
    return BoxLink(
        track_key=proposal.track_key,
        generated=proposal.box.model_copy(deep=True),
        origin="tracked" if method == "motion" else "copied",
        needs_attention=proposal.needs_attention,
    )


def hold_failed_step(result: TrackingResult) -> TrackingResult:
    if result.end_frame != result.seed_frame + 1:
        raise ValueError("Last-known boxes are only offered for a single adjacent frame.")
    held = result.model_copy(deep=True)
    proposed = {proposal.track_key for proposal in result.proposals}
    stops = {stop.track_key: stop.reason for stop in result.stops}
    for seed in result.seeds:
        if seed.box and seed.until_frame >= result.end_frame and seed.track_key not in proposed:
            held.proposals.append(
                TrackProposal(
                    track_key=seed.track_key,
                    frame_index=result.end_frame,
                    box=seed.box.model_copy(deep=True),
                    needs_attention="Last known position, NOT a successful match. "
                    + stops.get(seed.track_key, "Tracking failed."),
                )
            )
    return held
