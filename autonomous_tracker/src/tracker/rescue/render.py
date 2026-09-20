from __future__ import annotations

import cv2
import numpy as np
from numpy.typing import NDArray

from tracker.rescue.observations import Observation, ReviewTrack
from tracker.rescue.regions import ReviewRegion


def _draw_label(
    image: NDArray[np.uint8],
    text: str,
    x: int,
    y: int,
    color: tuple[int, int, int],
    header_height: int,
) -> None:
    height, width = image.shape[:2]
    (text_width, text_height), baseline = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
    x = max(3, min(x, width - text_width - 4))
    y = min(height - baseline - 4, max(header_height + text_height + 6, y))
    cv2.rectangle(
        image,
        (x - 3, y - text_height - 3),
        (min(width - 1, x + text_width + 3), y + baseline + 3),
        (22, 25, 29),
        -1,
    )
    cv2.putText(image, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)


def render_review(
    image: NDArray[np.uint8],
    observations: list[Observation],
    tracks: list[ReviewTrack],
    regions: list[ReviewRegion],
    frame_index: int,
    timestamp_s: float,
    warnings: list[str],
    unsupported: list[str],
) -> NDArray[np.uint8]:
    output = image.copy()
    height, width = image.shape[:2]
    lines = [f"RESCUE REVIEW | frame {frame_index} | source time {timestamp_s:.2f}s"]
    if unsupported:
        lines.append("Not modeled: " + ", ".join(unsupported))
    lines.extend(warnings)
    header_height = min(height, 12 + len(lines) * 23)
    for observation in observations:
        x1, y1, x2, y2 = map(round, observation.bbox_xyxy)
        color = (70, 210, 245) if observation.label == "person" else (80, 220, 100)
        if observation.polygon:
            cv2.polylines(output, [np.rint(observation.polygon).astype(np.int32)], True, color, 2)
        cv2.rectangle(output, (x1, y1), (x2, y2), color, 2)
        label = f"{observation.label} {observation.confidence:.2f} {observation.key or 'untracked'}"
        _draw_label(
            output,
            label,
            x1,
            y1 - 6,
            color,
            header_height,
        )
    for track in tracks:
        color = (190, 190, 190) if track.state in {"missing", "lost"} else (230, 180, 80)
        if len(track.history) > 1:
            cv2.polylines(output, [np.rint(track.history).astype(np.int32)], False, color, 1)
        x1, _, _, y2 = map(round, track.bbox_xyxy)
        age = timestamp_s - track.last_seen_s
        _draw_label(
            output,
            f"{track.key} {track.state} last seen {age:.2f}s ago",
            x1,
            y2 + 18,
            color,
            header_height,
        )
    for region in regions:
        if region.frame_index == frame_index:
            points = np.rint(
                np.asarray(region.polygon_normalized) * [width - 1, height - 1]
            ).astype(np.int32)
            cv2.polylines(output, [points], True, (0, 170, 255), 2)
            _draw_label(
                output,
                f"{region.name}: UNVERIFIED",
                int(points[0, 0]),
                int(points[0, 1]),
                (0, 170, 255),
                header_height,
            )
    cv2.rectangle(output, (0, 0), (width - 1, header_height - 1), (22, 25, 29), -1)
    for index, line in enumerate(lines):
        y = 24 + index * 23
        cv2.putText(
            output, line, (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (240, 240, 240), 1, cv2.LINE_AA
        )
    return output
