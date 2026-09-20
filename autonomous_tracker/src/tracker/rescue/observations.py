from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Literal

type Point = tuple[float, float]
type Box = tuple[float, float, float, float]


@dataclass(frozen=True)
class Observation:
    model: str
    label: str
    confidence: float
    bbox_xyxy: Box
    tracker_id: int | None
    polygon: tuple[Point, ...] = ()

    @property
    def key(self) -> str | None:
        return None if self.tracker_id is None else f"{self.model}:{self.tracker_id}"


@dataclass
class ReviewTrack:
    key: str
    label: str
    bbox_xyxy: Box
    confidence: float
    first_seen_s: float
    last_seen_s: float
    state: Literal["tentative", "confirmed", "missing", "lost"] = "tentative"
    consecutive_observations: int = 1
    history: list[Point] = field(default_factory=list)


class ObservationHistory:
    """Retain measured image positions, without extrapolating missing observations."""

    def __init__(self, confirmation_frames: int, lost_after_s: float, history_length: int) -> None:
        self.confirmation_frames = confirmation_frames
        self.lost_after_s = lost_after_s
        self.history_length = history_length
        self.tracks: dict[str, ReviewTrack] = {}
        self.last_timestamp_s: float | None = None

    def update(self, observations: list[Observation], timestamp_s: float) -> list[ReviewTrack]:
        if self.last_timestamp_s is not None and timestamp_s <= self.last_timestamp_s:
            raise ValueError("review timestamps must increase")
        self.last_timestamp_s = timestamp_s
        observed: set[str] = set()
        for observation in observations:
            key = observation.key
            if key is None:
                continue
            observed.add(key)
            track = self.tracks.get(key)
            if track is None:
                track = ReviewTrack(
                    key,
                    observation.label,
                    observation.bbox_xyxy,
                    observation.confidence,
                    timestamp_s,
                    timestamp_s,
                )
                self.tracks[key] = track
            else:
                track.consecutive_observations = (
                    track.consecutive_observations + 1
                    if track.state in {"tentative", "confirmed"}
                    else 1
                )
                track.label = observation.label
                track.bbox_xyxy = observation.bbox_xyxy
                track.confidence = observation.confidence
                track.last_seen_s = timestamp_s
            track.state = (
                "confirmed"
                if track.consecutive_observations >= self.confirmation_frames
                else "tentative"
            )
            x1, y1, x2, y2 = observation.bbox_xyxy
            track.history.append(((x1 + x2) * 0.5, (y1 + y2) * 0.5))
            track.history = track.history[-self.history_length :]
        expired: list[str] = []
        for key, track in self.tracks.items():
            if key in observed:
                continue
            age_s = timestamp_s - track.last_seen_s
            track.state = "lost" if age_s >= self.lost_after_s else "missing"
            track.consecutive_observations = 0
            if track.state == "lost":
                expired.append(key)
        snapshots = [replace(track, history=list(track.history)) for track in self.tracks.values()]
        for key in expired:
            del self.tracks[key]
        return snapshots
