from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from tracker.rescue.annotations import AnnotationDocument, BoxLink, LabelFrame
from tracker.rescue.evaluation import TruthObject, box_iou
from tracker.rescue.scoring import RunMetadata, SavedFrame


@dataclass(frozen=True)
class Suggestions:
    frames: list[LabelFrame]
    classes: list[str]
    source_hash: str


def load_suggestions(directory: Path, document: AnnotationDocument) -> Suggestions:
    metadata_path = directory / "summary.json"
    metadata_bytes = metadata_path.read_bytes()
    raw = json.loads(metadata_bytes)
    if not isinstance(raw, dict) or not raw.get("source_video_sha256"):
        raise ValueError("run has no video checksum; regenerate it with rescue_review")
    metadata = RunMetadata.model_validate(raw)
    if metadata.status not in {"completed", "frame_limit_reached", "operator_stopped"}:
        raise ValueError("finish the recognition run before importing suggestions")
    source = document.source
    if metadata.source_video_sha256 != source.sha256:
        raise ValueError("saved run belongs to a different video (SHA256 mismatch)")
    if metadata.image_dimensions != (source.width, source.height):
        raise ValueError("saved run dimensions differ from the source video")
    frames: list[LabelFrame] = []
    names: set[str] = set()
    digest = hashlib.sha256()
    last_time = -1.0
    boxes = 0
    identities: dict[tuple[str, int], tuple[int, str, str]] = {}
    namespace = hashlib.sha256(metadata_bytes).hexdigest()
    with (directory / "frames.jsonl").open("rb") as stream:
        while line := stream.readline(8 * 1024 * 1024 + 1):
            if len(line) > 8 * 1024 * 1024:
                raise ValueError("saved frame record exceeds 8 MB")
            digest.update(line)
            frame = SavedFrame.model_validate_json(line)
            if frame.frame_index != len(frames) or frame.source_time_s <= last_time:
                raise ValueError("saved frames must be contiguous with increasing timestamps")
            if frame.frame_index >= source.frame_count:
                raise ValueError("saved frame index exceeds source video length")
            objects = []
            links = {}
            for obs in frame.observations:
                if obs.bbox_xyxy[2] > source.width or obs.bbox_xyxy[3] > source.height:
                    raise ValueError("saved box is outside the video")
                names.add(obs.label)
                objects.append(TruthObject(label=obs.label, bbox_xyxy=obs.bbox_xyxy))
                if obs.tracker_id is not None:
                    identity = (obs.model, obs.tracker_id)
                    old = identities.get(identity)
                    if old is not None and old[0] >= frame.frame_index - 2 and old[1] == obs.label:
                        key = old[2]
                    else:
                        key = hashlib.sha256(
                            f"{namespace}:{identity}:{frame.frame_index}".encode()
                        ).hexdigest()[:32]
                    identities[identity] = (frame.frame_index, obs.label, key)
                else:
                    key = hashlib.sha256(
                        f"{namespace}:unlinked:{frame.frame_index}:{len(objects)}".encode()
                    ).hexdigest()[:32]
                links[len(objects) - 1] = BoxLink(
                    track_key=key,
                    generated=objects[-1].model_copy(deep=True),
                    origin="predicted",
                )
            boxes += len(objects)
            if boxes > 200_000 or len(frames) >= 100_000:
                raise ValueError("suggestion import exceeds the 100,000-frame / 200,000-box limit")
            frames.append(
                LabelFrame(frame_index=frame.frame_index, objects=objects, box_links=links)
            )
            last_time = frame.source_time_s
    if len(frames) != metadata.frames_reviewed:
        raise ValueError("saved frame count does not match summary; log may be truncated")
    if metadata_path.read_bytes() != metadata_bytes:
        raise ValueError("run metadata changed while importing")
    fingerprint = digest.hexdigest()
    for labeled in frames:
        labeled.suggestion_source = fingerprint
    return Suggestions(frames, sorted(names), fingerprint)


def merge_suggestions(
    document: AnnotationDocument, suggestions: Suggestions, *, refresh_machine: bool = False
) -> tuple[AnnotationDocument, int, int]:
    # Existing drafts include deliberate deletions, so even empty existing frames are protected.
    existing = {frame.frame_index: frame for frame in document.frames}
    key_map = retained_prediction_links(existing, suggestions) if refresh_machine else {}
    unknown = set(suggestions.classes) - set(document.classes)
    added = [
        scoped_suggestion(frame, document.classes, key_map)
        for frame in suggestions.frames
        if frame.frame_index not in existing
    ]
    skipped_boxes = sum(
        obj.label in unknown for frame in suggestions.frames for obj in frame.objects
    )
    payload = document.model_dump()
    refreshed = {
        frame.frame_index: scoped_suggestion(frame, document.classes, key_map)
        for frame in suggestions.frames
        if refresh_machine
        and frame.frame_index in existing
        and untouched_prediction(existing[frame.frame_index])
    }
    payload["frames"] = [
        refreshed[frame["frame_index"]].model_dump() if frame["frame_index"] in refreshed else frame
        for frame in payload["frames"]
    ]
    payload["frames"].extend(frame.model_dump() for frame in added)
    return AnnotationDocument.model_validate(payload), len(added) + len(refreshed), skipped_boxes


def untouched_prediction(frame: LabelFrame) -> bool:
    return (
        frame.prediction_draft
        and not frame.reviewed
        and not frame.blocked_tracks
        and len(frame.box_links) == len(frame.objects)
        and all(
            link.origin == "predicted"
            and not link.edited
            and not link.needs_attention
            and link.generated == frame.objects[i]
            for i, link in frame.box_links.items()
        )
    )


def retained_prediction_links(
    existing: dict[int, LabelFrame], suggestions: Suggestions
) -> dict[str, str]:
    forward: dict[str, set[str]] = {}
    backward: dict[str, set[str]] = {}
    for frame in suggestions.frames:
        old = existing.get(frame.frame_index)
        if old is None or not untouched_prediction(old):
            continue
        for index, link in frame.box_links.items():
            obj = frame.objects[index]
            for prior, prior_link in old.box_links.items():
                original = old.objects[prior]
                if (
                    obj.label == original.label
                    and box_iou(obj.bbox_xyxy, original.bbox_xyxy) >= 0.7
                ):
                    forward.setdefault(link.track_key, set()).add(prior_link.track_key)
                    backward.setdefault(prior_link.track_key, set()).add(link.track_key)
    return {
        new: next(iter(old))
        for new, old in forward.items()
        if len(old) == 1 and len(backward[next(iter(old))]) == 1
    }


def scoped_suggestion(
    frame: LabelFrame, classes: list[str], key_map: dict[str, str] | None = None
) -> LabelFrame:
    indices = [i for i, obj in enumerate(frame.objects) if obj.label in classes]
    return LabelFrame(
        frame_index=frame.frame_index,
        prediction_draft=True,
        objects=[frame.objects[i].model_copy(deep=True) for i in indices],
        suggestion_source=frame.suggestion_source,
        box_links={
            new: frame.box_links[old].model_copy(
                deep=True,
                update={
                    "track_key": (key_map or {}).get(
                        frame.box_links[old].track_key, frame.box_links[old].track_key
                    )
                },
            )
            for new, old in enumerate(indices)
            if old in frame.box_links
        },
    )
