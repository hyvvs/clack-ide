"""Animated camera and top-down views for deterministic simulation runs."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from numpy.typing import NDArray

from tracker.state_machine import SystemState
from tracker.types import (
    AimCommand,
    AlignmentMetrics,
    BallisticSolution,
    MotorState,
    TargetDetection,
    Track,
    Vector3,
)
from tracker.vision.overlay import OverlayDiagnostics, draw_debug_overlay


@dataclass(frozen=True, slots=True)
class SimulationFrame:
    """All state required to render one synchronized simulation frame."""

    image: NDArray[np.uint8]
    detections: tuple[TargetDetection, ...]
    tracks: tuple[Track, ...]
    motor: MotorState
    solution: BallisticSolution | None
    desired: AimCommand
    alignment: AlignmentMetrics
    state: SystemState
    selected_track_id: int | None
    exact_target_positions: tuple[Vector3, ...]
    projectile_positions: tuple[Vector3, ...]
    camera_fps: float
    latency_ms: float
    simulated_shots: int
    simulated_hits: int


FrameObserver = Callable[[SimulationFrame], bool]


class SimulationVisualizer:
    """Render simulation frames to an optional MP4 and OpenCV window."""

    def __init__(
        self,
        output_path: Path | None = None,
        show: bool = False,
        playback_fps: float = 60.0,
        window_name: str = "Autonomous Tracker Simulation",
    ) -> None:
        if playback_fps <= 0.0:
            raise ValueError("playback FPS must be positive")
        if output_path is None and not show:
            raise ValueError("visualizer requires an output path or visible window")
        if show and not opencv_gui_available():
            raise RuntimeError(
                "--show requires the GUI-capable opencv-python package. "
                "Uninstall opencv-python-headless, install opencv-python, or use "
                "--video-dir to create an MP4 without a window."
            )
        self._output_path = output_path
        self._show = show
        self._playback_fps = playback_fps
        self._window_name = window_name
        self._writer: cv2.VideoWriter | None = None
        self._window_created = False
        self._closed = False

    def __call__(self, snapshot: SimulationFrame) -> bool:
        """Render one frame and return false when the user presses Escape or Q."""
        if self._closed:
            return False
        rendered = render_simulation_frame(snapshot)
        if self._output_path is not None:
            self._write(rendered)
        if self._show:
            try:
                cv2.imshow(self._window_name, rendered)
                self._window_created = True
            except cv2.error as exc:
                self._show = False
                raise RuntimeError(
                    "OpenCV could not create a GUI window. Install opencv-python instead "
                    "of opencv-python-headless, or record with --video-dir."
                ) from exc
            delay_ms = max(1, round(1000.0 / self._playback_fps))
            key = cv2.waitKey(delay_ms) & 0xFF
            if key in {27, ord("q")}:
                self.close()
                return False
        return True

    def close(self) -> None:
        """Flush video output and close only this visualizer's window."""
        if self._closed:
            return
        if self._writer is not None:
            self._writer.release()
            self._writer = None
        if self._window_created:
            with suppress(cv2.error):
                cv2.destroyWindow(self._window_name)
            self._window_created = False
        self._closed = True

    def _write(self, frame: NDArray[np.uint8]) -> None:
        if self._writer is None:
            assert self._output_path is not None
            self._output_path.parent.mkdir(parents=True, exist_ok=True)
            height, width = frame.shape[:2]
            writer = cv2.VideoWriter(
                str(self._output_path),
                cv2.VideoWriter.fourcc(*"mp4v"),
                self._playback_fps,
                (width, height),
            )
            if not writer.isOpened():
                raise RuntimeError(f"unable to create simulation video: {self._output_path}")
            self._writer = writer
        self._writer.write(frame)


def render_simulation_frame(snapshot: SimulationFrame) -> NDArray[np.uint8]:
    """Render camera overlay and a top-down physical scene side by side."""
    camera = draw_debug_overlay(
        snapshot.image,
        list(snapshot.detections),
        snapshot.tracks,
        snapshot.motor,
        snapshot.solution,
        OverlayDiagnostics(
            snapshot.desired.azimuth_rad,
            snapshot.desired.elevation_rad,
            snapshot.alignment,
            snapshot.state,
            snapshot.camera_fps,
            snapshot.latency_ms,
            snapshot.selected_track_id,
        ),
    )
    scene = _render_top_down(snapshot, camera.shape[1], camera.shape[0])
    return np.hstack((camera, scene))


def opencv_gui_available() -> bool:
    """Return whether the installed OpenCV build contains a window backend."""
    for line in cv2.getBuildInformation().splitlines():
        stripped = line.strip()
        if stripped.startswith("GUI:"):
            return stripped.partition(":")[2].strip().upper() not in {"", "NONE"}
    return False


def _render_top_down(snapshot: SimulationFrame, width: int, height: int) -> NDArray[np.uint8]:
    scene = np.full((height, width, 3), (22, 24, 28), dtype=np.uint8)
    points = [position.as_array() for position in snapshot.exact_target_positions]
    points.extend(track.state[:3] for track in snapshot.tracks)
    if snapshot.solution is not None:
        points.extend(point.as_array() for point in snapshot.solution.trajectory)
        points.append(snapshot.solution.predicted_target_position.as_array())
    maximum_forward = max(10.0, *(float(point[0]) for point in points)) * 1.08
    maximum_lateral = max(2.0, *(abs(float(point[1])) for point in points)) * 1.18
    horizontal_scale = (width * 0.5 - 34.0) / maximum_lateral
    vertical_scale = (height - 58.0) / maximum_forward
    scale = min(horizontal_scale, vertical_scale)
    origin = (width // 2, height - 28)

    def project(point: NDArray[np.float64]) -> tuple[int, int]:
        return (
            round(origin[0] - float(point[1]) * scale),
            round(origin[1] - float(point[0]) * scale),
        )

    grid_step = _nice_grid_step(maximum_forward)
    for forward in np.arange(0.0, maximum_forward + grid_step, grid_step):
        y = project(np.array([forward, 0.0, 0.0]))[1]
        cv2.line(scene, (12, y), (width - 12, y), (47, 51, 57), 1)
        cv2.putText(
            scene,
            f"{forward:g} m",
            (14, max(14, y - 3)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.38,
            (155, 160, 168),
            1,
            cv2.LINE_AA,
        )
    cv2.line(scene, (origin[0], 12), origin, (75, 80, 88), 1)

    aim_length = maximum_forward
    aim_endpoint = np.array(
        [
            aim_length * np.cos(snapshot.motor.azimuth_rad),
            aim_length * np.sin(snapshot.motor.azimuth_rad),
            0.0,
        ]
    )
    cv2.line(scene, origin, project(aim_endpoint), (255, 180, 40), 2, cv2.LINE_AA)

    if snapshot.solution is not None and snapshot.solution.trajectory:
        path = np.asarray(
            [project(point.as_array()) for point in snapshot.solution.trajectory],
            dtype=np.int32,
        )
        if len(path) >= 2:
            cv2.polylines(scene, [path], False, (185, 80, 230), 2, cv2.LINE_AA)
        predicted = project(snapshot.solution.predicted_target_position.as_array())
        cv2.drawMarker(scene, predicted, (185, 80, 230), cv2.MARKER_CROSS, 14, 2)

    for track in snapshot.tracks:
        center = project(track.state[:3])
        cv2.drawMarker(scene, center, (30, 220, 245), cv2.MARKER_DIAMOND, 13, 2)
        cv2.putText(
            scene,
            f"T{track.track_id}",
            (center[0] + 7, center[1] - 7),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.4,
            (30, 220, 245),
            1,
            cv2.LINE_AA,
        )
    for position in snapshot.exact_target_positions:
        cv2.circle(scene, project(position.as_array()), 6, (55, 80, 245), -1, cv2.LINE_AA)
    for position in snapshot.projectile_positions:
        cv2.circle(scene, project(position.as_array()), 5, (255, 235, 80), -1, cv2.LINE_AA)
        cv2.circle(scene, project(position.as_array()), 8, (255, 235, 80), 1, cv2.LINE_AA)

    cv2.circle(scene, origin, 7, (220, 220, 225), -1, cv2.LINE_AA)
    cv2.putText(
        scene,
        "TOP-DOWN WORLD  x forward / y lateral",
        (12, 19),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.48,
        (235, 235, 240),
        1,
        cv2.LINE_AA,
    )
    cv2.putText(
        scene,
        f"simulated shots {snapshot.simulated_shots}  hits {snapshot.simulated_hits}",
        (12, height - 8),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.45,
        (235, 235, 240),
        1,
        cv2.LINE_AA,
    )
    return scene


def _nice_grid_step(maximum_forward_m: float) -> float:
    if maximum_forward_m <= 25.0:
        return 5.0
    if maximum_forward_m <= 60.0:
        return 10.0
    return 20.0
