"""OpenCV debug overlay for detections, tracks, aim, solver, state, and timing."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from numpy.typing import NDArray

from tracker.state_machine import SystemState
from tracker.types import (
    AlignmentMetrics,
    BallisticSolution,
    MotorState,
    TargetDetection,
    Track,
)


@dataclass(frozen=True, slots=True)
class OverlayDiagnostics:
    """Per-frame values rendered beside detection and track geometry."""

    desired_pan_rad: float
    desired_tilt_rad: float
    alignment: AlignmentMetrics
    state: SystemState
    fps: float
    latency_ms: float
    selected_track_id: int | None = None


def draw_debug_overlay(
    image: NDArray[np.uint8],
    detections: list[TargetDetection],
    tracks: tuple[Track, ...],
    motor: MotorState,
    solution: BallisticSolution | None,
    diagnostics: OverlayDiagnostics,
) -> NDArray[np.uint8]:
    """Render a copy of the image with distinct detection, track, and prediction marks."""
    output = image.copy()
    for detection in detections:
        x, y, width, height = (round(value) for value in detection.bbox_xywh)
        cv2.rectangle(output, (x, y), (x + width, y + height), (0, 220, 0), 2)
        cv2.putText(
            output,
            f"{detection.class_label} {detection.confidence:.2f}",
            (x, max(14, y - 4)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.42,
            (0, 220, 0),
            1,
            cv2.LINE_AA,
        )
    lines = [
        f"state {diagnostics.state.value}  FPS {diagnostics.fps:.1f}  "
        f"latency {diagnostics.latency_ms:.1f} ms",
        f"pan {motor.azimuth_rad:.3f} -> {diagnostics.desired_pan_rad:.3f}  "
        f"tilt {motor.elevation_rad:.3f} -> {diagnostics.desired_tilt_rad:.3f}",
        f"alignment {diagnostics.alignment.total_error_rad:.4f} rad  "
        f"confidence {diagnostics.alignment.confidence:.2f}",
        f"tracks {len(tracks)}  selected {diagnostics.selected_track_id}",
    ]
    if solution is not None:
        lines.append(
            f"solver {solution.method}  flight {solution.flight_time_s:.3f} s  "
            f"miss {solution.miss_distance_m:.3f} m"
        )
    for index, line in enumerate(lines):
        y = 22 + index * 20
        cv2.putText(
            output,
            line,
            (10, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (245, 245, 245),
            1,
            cv2.LINE_AA,
        )
    return output
