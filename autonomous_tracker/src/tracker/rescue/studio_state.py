from __future__ import annotations

import os
from pathlib import Path
from typing import Literal
from uuid import uuid4

from pydantic import Field

from tracker.rescue.config import ReviewModel
from tracker.rescue.media import VideoIdentity


class StudioPosition(ReviewModel):
    schema_version: int = Field(default=1, ge=1, le=1)
    video_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    frame_index: int = Field(ge=0, strict=True)
    label: str = ""
    auto_track: bool = False
    carry_mode: Literal["motion", "fixed"] = "motion"


def position_path(project: Path) -> Path:
    return project.parent / ".studio" / f"{project.name}.view.json"


def load_position(project: Path, source: VideoIdentity) -> StudioPosition:
    fallback = StudioPosition(video_sha256=source.sha256, frame_index=0)
    try:
        path = position_path(project)
        if path.stat().st_size > 16_384:
            return fallback
        position = StudioPosition.model_validate_json(path.read_bytes())
        if position.video_sha256 == source.sha256 and position.frame_index < source.frame_count:
            return position
    except (OSError, ValueError):
        pass
    return fallback


def save_position(
    project: Path,
    source: VideoIdentity,
    index: int,
    label: str,
    *,
    auto_track: bool = False,
    carry_mode: Literal["motion", "fixed"] = "motion",
) -> None:
    if not 0 <= index < source.frame_count:
        raise ValueError("resume frame is outside the video")
    position = StudioPosition(
        video_sha256=source.sha256,
        frame_index=index,
        label=label,
        auto_track=auto_track,
        carry_mode=carry_mode,
    )
    path = position_path(project)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        with temporary.open("x", encoding="utf-8") as stream:
            stream.write(position.model_dump_json(indent=2) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
