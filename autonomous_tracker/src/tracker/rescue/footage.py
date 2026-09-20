"""Small, attributed disaster footage collection for human-reviewed observation datasets."""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from urllib.request import Request, urlopen
from uuid import uuid4

import cv2

from tracker.rescue.annotations import AnnotationDocument, AnnotationSession
from tracker.rescue.media import FrameReader, file_sha256


@dataclass(frozen=True)
class FootageSource:
    filename: str
    title: str
    category: str
    location: str
    incident: str
    author: str
    source_page: str
    media_url: str
    license: str
    license_url: str
    sha1: str | None = None


SOURCES = (
    FootageSource(
        "cedar-rapids-flood-2008.mp4",
        "Cedar Rapids | Deep floodwater",
        "Flood",
        "Cedar Rapids, Iowa, USA",
        "iowa-floods-2008",
        "U.S. Geological Survey",
        "https://www.usgs.gov/media/videos/traversing-deep-water-cedar-rapids",
        "https://usgs-ocapsv2-public-input-media.s3.us-west-2.amazonaws.com/"
        "assets/palladium/production/s3fs-public/CedarRapids2.mp4",
        "Public Domain (publisher statement)",
        "https://www.usgs.gov/media/videos/traversing-deep-water-cedar-rapids",
    ),
    FootageSource(
        "chalk-cliffs-debris-2017.mp4",
        "Chalk Cliffs | Debris flow",
        "Debris flow",
        "Chalk Cliffs, Colorado, USA",
        "chalk-cliffs-2017-07-19",
        "U.S. Geological Survey; Steven Sobieszczyk, video editing",
        "https://www.usgs.gov/media/videos/debris-flow-monitoring-chalk-cliffs-co-2017",
        "https://usgs-ocapsv2-public-input-media.s3.us-west-2.amazonaws.com/"
        "assets/palladium/production/s3fs-public/chalkcliffs2017.mp4",
        "Public Domain (publisher statement)",
        "https://www.usgs.gov/media/videos/debris-flow-monitoring-chalk-cliffs-co-2017",
    ),
    FootageSource(
        "bondo-debris-2017.webm",
        "Bondo | Debris flow",
        "Debris flow",
        "Bondo, Switzerland",
        "bondo-2017-08-23",
        "Swiss Force One",
        "https://commons.wikimedia.org/wiki/File:Bondo_Aug_2017.webm",
        "https://upload.wikimedia.org/wikipedia/commons/c/c1/Bondo_Aug_2017.webm",
        "CC0 1.0",
        "https://creativecommons.org/publicdomain/zero/1.0/",
        "3bbd34eacfa2ccf362528e2b2e1dd84789605590",
    ),
)
MAX_BYTES = 300 * 1024 * 1024


def fetch_source(root: Path, source: FootageSource, stop_file: Path | None = None) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    target = root / source.filename
    record = target.with_suffix(target.suffix + ".source.json")
    project = root / "projects" / (target.stem + ".json")
    if target.suffix == ".webm" and target.is_file() and not record.exists():
        with target.open("rb") as stream:
            actual = hashlib.file_digest(stream, "sha1").hexdigest()
        if source.sha1 is None or actual != source.sha1:
            raise ValueError("Existing WebM does not match the pinned publisher hash")
        return prepare_webm(target, source, stop_file)
    if target.exists() or record.exists():
        if not target.is_file() or not record.is_file():
            raise ValueError(f"Incomplete existing asset retained for inspection: {target}")
        previous = json.loads(record.read_text(encoding="utf-8"))
        if previous["sha256"] != file_sha256(target):
            raise ValueError(f"Existing video has changed: {target}")
        if previous["media_url"] != source.media_url:
            raise ValueError(f"Existing asset has a different source: {target}")
        print(f"Already downloaded and verified: {target.name}", flush=True)
        if previous.get("annotation_copy"):
            copy = target.parent / str(previous["annotation_copy"])
            if copy.parent.resolve() != target.parent.resolve():
                raise ValueError("Annotation copy must be next to the original video")
            if file_sha256(copy) != previous["annotation_copy_sha256"]:
                raise ValueError("Annotation copy has changed")
            return copy
        return target
    partial = target.with_name(f".{target.name}.{uuid4().hex[:8]}.part")
    request = Request(source.media_url, headers={"User-Agent": "RescueStudio/0.1 (research)"})
    start = time.monotonic()
    digest, sha1, count = hashlib.sha256(), hashlib.sha1(), 0
    with urlopen(request, timeout=30) as response, partial.open("xb") as output:
        size = response.headers.get("Content-Length")
        if size is not None and int(size) > MAX_BYTES:
            raise ValueError("Video exceeds the 300 MiB per-file download limit")
        while chunk := response.read(1024 * 1024):
            if stop_file is not None and stop_file.exists():
                raise InterruptedError(f"Download stopped; partial retained: {partial}")
            if time.monotonic() - start > 600:
                raise TimeoutError("Download exceeded ten minutes; partial retained")
            count += len(chunk)
            if count > MAX_BYTES:
                raise ValueError("Download exceeds the 300 MiB per-file limit")
            digest.update(chunk)
            sha1.update(chunk)
            output.write(chunk)
        if size is not None and count != int(size):
            raise ValueError("Download length does not match publisher response")
    if source.sha1 is not None and sha1.hexdigest() != source.sha1:
        raise ValueError("Download does not match the publisher's SHA-1")
    partial.rename(target)
    if target.suffix == ".webm":
        return prepare_webm(target, source, stop_file)
    reader = FrameReader(target)
    try:
        for index in {0, reader.source.frame_count // 2, reader.source.frame_count - 1}:
            reader.read(index)
        payload = {
            **asdict(source),
            "sha256": digest.hexdigest(),
            "size_bytes": count,
            "downloaded_at": datetime.now(UTC).isoformat(),
            "video": reader.source.model_dump(),
            "annotation_status": "No publisher box labels. Human review required.",
            "rights_note": "Publisher-stated license recorded, not an independent rights audit.",
        }
        with record.open("x", encoding="utf-8") as stream:
            stream.write(json.dumps(payload, indent=2) + "\n")
        if project.exists():
            raise FileExistsError(f"Will not overwrite existing annotations: {project}")
        document = AnnotationDocument(
            source=reader.source,
            classes=["person", "floodwater", "debris"],
            incident_id=source.incident,
        )
        AnnotationSession(document, project).save()
    finally:
        reader.close()
    print(f"Ready for labeling: {target.name} ({count / 1_000_000:.1f} MB)", flush=True)
    return target


def prepare_webm(target: Path, source: FootageSource, stop_file: Path | None) -> Path:
    """Keep the publisher WebM; produce an explicitly retimed, frame-indexable label copy."""
    derived = target.with_name(target.stem + "-label-copy.mp4")
    if derived.exists():
        raise ValueError(f"Unfinished existing label copy retained: {derived}")
    temporary = target.with_name(f".{target.stem}-{uuid4().hex[:8]}.mp4")
    capture = cv2.VideoCapture(str(target))
    writer = None
    count = 0
    try:
        fps = float(capture.get(cv2.CAP_PROP_FPS))
        width, height = int(capture.get(3)), int(capture.get(4))
        if not capture.isOpened() or not 1 <= fps <= 120 or not 1 <= width * height <= 4096**2:
            raise ValueError("Unsupported WebM geometry or frame rate")
        writer = cv2.VideoWriter(
            str(temporary), cv2.VideoWriter.fourcc(*"mp4v"), fps, (width, height)
        )
        if not writer.isOpened():
            raise ValueError("Could not create an annotation copy")
        while True:
            if stop_file is not None and stop_file.exists():
                raise InterruptedError("Copy preparation stopped; partial retained")
            ok, frame = capture.read()
            if not ok:
                break
            writer.write(frame)
            count += 1
            if count > 18_000 or temporary.stat().st_size > MAX_BYTES:
                raise ValueError("Annotation copy exceeds its size/frame limit")
    finally:
        capture.release()
        if writer is not None:
            writer.release()
    temporary.rename(derived)
    reader = FrameReader(derived)
    try:
        if count != reader.source.frame_count:
            raise ValueError("Annotation copy frame count did not round-trip")
        for index in {0, count // 2, count - 1}:
            reader.read(index)
        payload = {
            **asdict(source),
            "sha256": reader.source.sha256,
            "size_bytes": derived.stat().st_size,
            "video": reader.source.model_dump(),
            "original_file": target.name,
            "original_sha256": file_sha256(target),
            "downloaded_at": datetime.now(UTC).isoformat(),
            "transformation": f"OpenCV mp4v lossy label copy, {count} decoded frames at {fps} CFR; "
            "audio omitted and original timestamps not preserved. Not for timing evaluation.",
            "annotation_status": "No publisher box labels. Human review required.",
        }
        with derived.with_suffix(".mp4.source.json").open("x", encoding="utf-8") as stream:
            stream.write(json.dumps(payload, indent=2) + "\n")
        original_record = {
            **asdict(source),
            "sha256": payload["original_sha256"],
            "annotation_copy": derived.name,
            "annotation_copy_sha256": reader.source.sha256,
        }
        with target.with_suffix(".webm.source.json").open("x", encoding="utf-8") as stream:
            stream.write(json.dumps(original_record, indent=2) + "\n")
        project = target.parent / "projects" / f"{derived.stem}.json"
        if project.exists():
            raise FileExistsError(f"Will not overwrite annotations: {project}")
        AnnotationSession(
            AnnotationDocument(
                source=reader.source,
                classes=["person", "floodwater", "debris"],
                incident_id=source.incident,
            ),
            project,
        ).save()
    finally:
        reader.close()
    print(f"Ready for labeling: {derived.name}; original WebM preserved", flush=True)
    return derived
