from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from threading import Event
from uuid import uuid4

import cv2

from tracker.rescue.annotations import AnnotationDocument
from tracker.rescue.media import FrameReader
from tracker.rescue.project_tools import frame_range


def export_clip(
    document: AnnotationDocument,
    output_root: Path,
    start: int,
    end: int,
    *,
    cancel: Event | None = None,
    progress: Callable[[str], None] = lambda _: None,
) -> Path:
    """Export a verified lossless, video-only clip and a rebased label snapshot."""
    indices = frame_range(document, start, end)
    if len(indices) > 100000:
        raise ValueError("Export at most 100,000 frames per clip.")
    if document.source.width % 2 or document.source.height % 2:
        raise ValueError("Lossless clip export currently requires even video dimensions.")

    def check_cancel() -> None:
        if cancel is not None and cancel.is_set():
            raise ValueError("Clip export cancelled; the original project is unchanged.")

    check_cancel()
    reader = FrameReader(Path(document.source.path))
    directory: Path | None = None
    writer = None
    created: list[Path] = []
    try:
        actual = reader.source.model_dump(exclude={"path"})
        expected = document.source.model_dump(exclude={"path"})
        if actual != expected:
            raise ValueError("Source video no longer matches this annotation project.")
        check_cancel()
        candidate = output_root.resolve() / (
            f"clip-{start}-{end}-{datetime.now(UTC):%Y%m%d-%H%M%S}-{uuid4().hex[:8]}"
        )
        candidate.mkdir(parents=True, exist_ok=False)
        directory = candidate
        video = directory / "clip.avi"
        created.append(video)
        writer = cv2.VideoWriter(
            str(video),
            cv2.VideoWriter.fourcc(*"FFV1"),
            document.source.nominal_fps,
            (document.source.width, document.source.height),
        )
        if not writer.isOpened():
            raise ValueError("This video runtime cannot encode lossless FFV1 clips.")
        hashes: list[bytes] = []
        for offset, index in enumerate(indices):
            check_cancel()
            image = reader.read(index)
            hashes.append(hashlib.sha256(image.tobytes()).digest())
            writer.write(image)
            if offset % 20 == 0:
                progress(f"Writing clip: {offset + 1}/{len(indices)} frames")
        writer.release()
        writer = None
        check_cancel()
        verification = FrameReader(video)
        try:
            source = verification.source
            if (
                source.frame_count != len(indices)
                or source.width != document.source.width
                or source.height != document.source.height
                or not math.isclose(source.nominal_fps, document.source.nominal_fps, rel_tol=1e-5)
            ):
                raise ValueError("Exported clip timing or dimensions failed verification.")
            for index, digest in enumerate(hashes):
                check_cancel()
                if hashlib.sha256(verification.read(index).tobytes()).digest() != digest:
                    raise ValueError("Exported clip failed pixel-exact verification.")
                if index % 20 == 0:
                    progress(f"Verifying clip: {index + 1}/{len(indices)} frames")
        finally:
            verification.close()
        check_cancel()
        payload = document.model_dump()
        payload["source"] = source.model_dump()
        payload["source_ancestors"] = sorted({*document.source_ancestors, document.source.sha256})
        payload["frames"] = [
            {**frame.model_dump(), "frame_index": frame.frame_index - start}
            for frame in document.frames
            if frame.frame_index in indices
        ]
        clipped = AnnotationDocument.model_validate(payload)
        project = directory / "clip.json"
        receipt = directory / "clip-origin.json"
        for path, content in (
            (project, clipped.model_dump(mode="json")),
            (
                receipt,
                {
                    "source": document.source.model_dump(mode="json"),
                    "source_annotation_sha256": hashlib.sha256(
                        document.model_dump_json().encode()
                    ).hexdigest(),
                    "inclusive_start_frame": start,
                    "inclusive_end_frame": end,
                    "clip_sha256": source.sha256,
                    "codec": "FFV1",
                    "pixel_exact_verified": True,
                    "audio_included": False,
                    "labels": "Snapshot at export start; frame indices rebased to zero.",
                },
            ),
        ):
            with path.open("x", encoding="utf-8") as stream:
                created.append(path)
                json.dump(content, stream, indent=2, allow_nan=False)
                stream.write("\n")
        check_cancel()
        return project
    except BaseException:
        if writer is not None:
            writer.release()
            writer = None
        for path in reversed(created):
            path.unlink(missing_ok=True)
        if directory is not None:
            directory.rmdir()
        raise
    finally:
        if writer is not None:
            writer.release()
        reader.close()
