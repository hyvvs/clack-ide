from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Literal
from uuid import uuid4

from pydantic import Field, model_validator

from tracker.rescue.config import ReviewModel
from tracker.rescue.evaluation import GroundTruth, TruthFrame, TruthObject
from tracker.rescue.media import VideoIdentity, file_sha256

DEFAULT_CLASSES = ["person", "fire", "smoke", "boat", "car", "truck", "bus", "floodwater", "debris"]


def normalize_class_name(name: str) -> str:
    name = name.strip().casefold()
    if not name or len(name) > 64 or any(ord(char) < 32 for char in name):
        raise ValueError("use a tag name of 1-64 characters without control characters")
    return name


class BoxLink(ReviewModel):
    track_key: str = Field(pattern=r"^[0-9a-f]{32}$")
    generated: TruthObject | None = None
    origin: Literal["tracked", "copied", "predicted"] | None = None
    edited: bool = False
    needs_attention: str | None = Field(default=None, max_length=1000)


class LabelFrame(TruthFrame):
    reviewed: bool = False
    prediction_draft: bool = False
    suggestion_source: str | None = None
    box_links: dict[int, BoxLink] = Field(default_factory=dict)
    blocked_tracks: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def valid_links(self) -> LabelFrame:
        if self.reviewed and any(link.needs_attention for link in self.box_links.values()):
            raise ValueError("Resolve Needs attention boxes before marking this frame reviewed.")
        if any(not 0 <= index < len(self.objects) for index in self.box_links):
            raise ValueError("box tracking history refers to a missing box")
        keys = [link.track_key for link in self.box_links.values()]
        if len(keys) != len(set(keys)):
            raise ValueError("a tracking identity occurs twice in one frame")
        if set(keys) & set(self.blocked_tracks):
            raise ValueError("a box cannot be both present and deleted in tracking history")
        if len(self.blocked_tracks) != len(set(self.blocked_tracks)) or any(
            len(key) != 32 or any(char not in "0123456789abcdef" for char in key)
            for key in self.blocked_tracks
        ):
            raise ValueError("invalid deleted tracking identities")
        return self


def carried_links(
    previous: LabelFrame, objects: list[TruthObject], edited_index: int | None = None
) -> dict[int, BoxLink]:
    links: dict[int, BoxLink] = {}
    used: set[int] = set()
    if edited_index is not None and edited_index in previous.box_links:
        link = previous.box_links[edited_index].model_copy(deep=True)
        link.generated = None
        link.edited = True
        link.needs_attention = None
        links[edited_index] = link
        used.add(edited_index)
    for index, obj in enumerate(objects):
        if index in links:
            continue
        matches = [
            old
            for old, original in enumerate(previous.objects)
            if old not in used and original == obj
        ]
        if objects == previous.objects and index not in used:
            matches = [index]
        if len(matches) == 1 and matches[0] in previous.box_links:
            links[index] = previous.box_links[matches[0]].model_copy(deep=True)
            used.add(matches[0])
    return links


class AnnotationDocument(ReviewModel):
    schema_version: int = Field(default=1, ge=1, le=1)
    source: VideoIdentity
    classes: list[str] = Field(min_length=1)
    incident_id: str = ""
    split: Literal["unassigned", "training", "validation", "test"] = "unassigned"
    frames: list[LabelFrame] = Field(default_factory=list)
    source_ancestors: list[str] = Field(default_factory=list, max_length=1000)

    @model_validator(mode="after")
    def validate_document(self) -> AnnotationDocument:
        if len(set(self.source_ancestors)) != len(self.source_ancestors) or any(
            len(value) != 64 or any(char not in "0123456789abcdef" for char in value)
            for value in self.source_ancestors
        ):
            raise ValueError("invalid source ancestry hashes")
        self.classes = [label.strip().casefold() for label in self.classes]
        if any(not label for label in self.classes) or len(self.classes) != len(set(self.classes)):
            raise ValueError("classes must be nonempty and unique")
        if any(frame.frame_index >= self.source.frame_count for frame in self.frames):
            raise ValueError("annotation frame is outside the video")
        self.to_truth(reviewed_only=False)
        return self

    def to_truth(self, reviewed_only: bool = True) -> GroundTruth:
        return GroundTruth(
            image_width=self.source.width,
            image_height=self.source.height,
            video_sha256=self.source.sha256,
            label_scope=self.classes,
            frames=[
                TruthFrame(frame_index=frame.frame_index, objects=frame.objects)
                for frame in sorted(self.frames, key=lambda f: f.frame_index)
                if frame.reviewed or not reviewed_only
            ],
        )


class AnnotationSession:
    def __init__(self, document: AnnotationDocument, path: Path) -> None:
        self.document = document
        self.path = path
        self.disk_hash = file_sha256(path) if path.exists() else None
        self.dirty = not path.exists()
        self._undo: list[AnnotationDocument] = []

    @classmethod
    def open(
        cls, path: Path, source: VideoIdentity, classes: list[str] | None = None
    ) -> AnnotationSession:
        original = path.read_bytes() if path.exists() else None
        source_changed = False
        if original is not None:
            document = AnnotationDocument.model_validate_json(original)
            if document.source.sha256 != source.sha256:
                raise ValueError(
                    "annotation project belongs to a different video (SHA256 mismatch)"
                )
            if (
                document.source.width,
                document.source.height,
                document.source.frame_count,
            ) != (source.width, source.height, source.frame_count):
                raise ValueError("annotation project video dimensions or frame count changed")
            if classes is not None and classes != document.classes:
                raise ValueError("existing project class scope differs; omit --classes to resume")
            source_changed = document.source != source
            document.source = source
        else:
            document = AnnotationDocument(source=source, classes=classes or DEFAULT_CLASSES)
        session = cls(document, path)
        session.disk_hash = hashlib.sha256(original).hexdigest() if original is not None else None
        session.dirty = original is None or source_changed
        return session

    def frame(self, index: int) -> LabelFrame:
        return next(
            (f.model_copy(deep=True) for f in self.document.frames if f.frame_index == index),
            LabelFrame(frame_index=index, objects=[]),
        )

    def replace_frame(
        self,
        index: int,
        objects: list[TruthObject],
        reviewed: bool = False,
        *,
        edited_index: int | None = None,
    ) -> None:
        previous = self.frame(index)
        if edited_index is not None and not (
            0 <= edited_index < len(objects) and edited_index < len(previous.objects)
        ):
            raise ValueError("edited box no longer exists")
        links = carried_links(previous, objects, edited_index)
        if reviewed:
            for link in links.values():
                link.generated = None
        kept = {link.track_key for link in links.values()}
        blocked = set(previous.blocked_tracks) | {
            link.track_key for link in previous.box_links.values() if link.track_key not in kept
        }
        payload = self.document.model_dump()
        payload["frames"] = [f for f in payload["frames"] if f["frame_index"] != index]
        payload["frames"].append(
            LabelFrame(
                frame_index=index,
                objects=objects,
                reviewed=reviewed,
                suggestion_source=previous.suggestion_source,
                box_links=links,
                blocked_tracks=sorted(blocked - kept),
            ).model_dump()
        )
        self.replace_document(AnnotationDocument.model_validate(payload))

    def replace_document(self, updated: AnnotationDocument) -> None:
        self._undo = [*self._undo[-19:], self.document.model_copy(deep=True)]
        self.document = updated
        self.dirty = True

    def change_class(self, name: str, previous: str | None = None) -> None:
        name = normalize_class_name(name)
        if name in self.document.classes:
            raise ValueError("that class already exists")
        if previous is not None and previous not in self.document.classes:
            raise ValueError("select an existing class to rename")
        payload = self.document.model_dump()
        if previous is None:
            payload["classes"].append(name)
        else:
            payload["classes"] = [name if item == previous else item for item in payload["classes"]]
        for frame in payload["frames"]:
            frame["reviewed"] = False
            for obj in frame["objects"]:
                if obj["label"] == previous:
                    obj["label"] = name
        self.replace_document(AnnotationDocument.model_validate(payload))

    def apply_tag(self, frame_index: int, name: str, object_index: int | None = None) -> None:
        name = normalize_class_name(name)
        if not 0 <= frame_index < self.document.source.frame_count:
            raise ValueError("frame is outside the video")
        frame = self.frame(frame_index)
        if object_index is not None and not 0 <= object_index < len(frame.objects):
            raise ValueError("select an existing box before applying a tag")
        added = name not in self.document.classes
        changed = object_index is not None and frame.objects[object_index].label != name
        if not added and not changed:
            return
        updated = self.document.model_copy(deep=True)
        if added:
            updated.classes.append(name)
            for item in updated.frames:
                item.reviewed = False
        if changed:
            item = next(item for item in updated.frames if item.frame_index == frame_index)
            assert object_index is not None
            item.objects[object_index].label = name
            if object_index in item.box_links:
                item.box_links[object_index].generated = None
                item.box_links[object_index].edited = True
            item.reviewed = False
        self.replace_document(AnnotationDocument.model_validate(updated.model_dump()))

    def remove_unused_class(self, name: str) -> None:
        if name not in self.document.classes or len(self.document.classes) == 1:
            raise ValueError("select an existing class; at least one class must remain")
        if any(obj.label == name for frame in self.document.frames for obj in frame.objects):
            raise ValueError("this class still has boxes; correct those labels before removing it")
        payload = self.document.model_dump()
        payload["classes"].remove(name)
        self.replace_document(AnnotationDocument.model_validate(payload))

    def undo(self) -> bool:
        if not self._undo:
            return False
        self.document = self._undo.pop()
        self.dirty = True
        return True

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lock = self.path.with_name(f".{self.path.name}.lock")
        try:
            lock_stream = lock.open("x", encoding="utf-8")
        except FileExistsError as exc:
            raise ValueError(f"project save is locked by another writer: {lock}") from exc
        try:
            with lock_stream:
                self._save_locked()
        finally:
            lock.unlink(missing_ok=True)

    def _save_locked(self) -> None:
        current_hash = file_sha256(self.path) if self.path.exists() else None
        if current_hash != self.disk_hash:
            raise ValueError("project changed on disk; refusing to overwrite another edit")
        encoded = self.document.model_dump_json(indent=2) + "\n"
        temporary = self.path.with_name(f".{self.path.name}.{uuid4().hex}.tmp")
        try:
            with temporary.open("x", encoding="utf-8") as stream:
                stream.write(encoded)
                stream.flush()
                os.fsync(stream.fileno())
            if self.path.exists():
                backup = self.path.with_name(f"{self.path.stem}.backup-{uuid4().hex[:8]}.json")
                with backup.open("xb") as stream:
                    stream.write(self.path.read_bytes())
            os.replace(temporary, self.path)
        finally:
            temporary.unlink(missing_ok=True)
        self.disk_hash = file_sha256(self.path)
        self.dirty = False

    def export(self) -> Path:
        truth = self.document.to_truth()
        if not truth.frames:
            raise ValueError("mark at least one frame reviewed before exporting")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        output = self.path.with_name(f"{self.path.stem}.truth-{uuid4().hex[:8]}.json")
        with output.open("x", encoding="utf-8") as stream:
            json.dump(truth.model_dump(mode="json"), stream, indent=2, allow_nan=False)
            stream.write("\n")
        return output
