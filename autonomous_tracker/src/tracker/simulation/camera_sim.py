"""Deterministic synthetic camera with noise, latency, drops, and occlusion."""

from __future__ import annotations

import time

import cv2
import numpy as np

from tracker.config import CameraConfig, SimulationConfig, TargetConfig
from tracker.simulation.target import SyntheticTarget
from tracker.types import Frame, TargetDetection, Vector3


class SimulatedCamera:
    """Render simple color targets and expose exact noisy measurements for tests."""

    def __init__(
        self,
        camera: CameraConfig,
        simulation: SimulationConfig,
        target_config: TargetConfig,
        targets: list[SyntheticTarget],
        start_timestamp_ns: int | None = None,
    ) -> None:
        self._camera = camera
        self._simulation = simulation
        self._target_config = target_config
        self._targets = targets
        self._start_ns = start_timestamp_ns or time.monotonic_ns()
        self._frame_id = 0
        self._rng = np.random.default_rng(simulation.random_seed)
        self._last_capture_ns = self._start_ns - 1
        self.last_detections: list[TargetDetection] = []

    def read(self) -> Frame | None:
        """Advance one frame and return a rendered image or a configured drop."""
        nominal_frame_time_ns = self._start_ns + int(self._frame_id * 1e9 / self._camera.fps)
        timestamp_jitter_ns = int(
            self._rng.normal(0.0, self._simulation.capture_timestamp_jitter_s) * 1e9
        )
        frame_time_ns = max(
            self._last_capture_ns + 1,
            nominal_frame_time_ns + timestamp_jitter_ns,
        )
        self._last_capture_ns = frame_time_ns
        frame_id = self._frame_id
        self._frame_id += 1
        if self._rng.random() < self._simulation.dropped_frame_probability:
            self.last_detections = []
            return None
        image = np.zeros((self._camera.height, self._camera.width, 3), dtype=np.uint8)
        self.last_detections = []
        focal = float(self._camera.width)
        for target in self._targets:
            if self._rng.random() < self._simulation.target_occlusion_probability:
                continue
            state = target.state_at(frame_time_ns)
            position = state.position.as_array()
            if position[0] <= 0.05:
                continue
            u = self._camera.width * 0.5 - focal * position[1] / position[0]
            v = self._camera.height * 0.5 - focal * position[2] / position[0]
            radius = max(3, int(focal * self._target_config.width_m * 0.5 / position[0]))
            if not (-radius <= u < self._camera.width + radius):
                continue
            if not (-radius <= v < self._camera.height + radius):
                continue
            exposure_half_ns = int(self._simulation.exposure_time_s * 0.5e9)
            exposure_start = target.state_at(frame_time_ns - exposure_half_ns).position.as_array()
            exposure_end = target.state_at(frame_time_ns + exposure_half_ns).position.as_array()
            start_px = self._project(exposure_start, focal)
            end_px = self._project(exposure_end, focal)
            if start_px is not None and end_px is not None:
                cv2.line(
                    image,
                    (int(start_px[0]), int(start_px[1])),
                    (int(end_px[0]), int(end_px[1])),
                    (0, 180, 0),
                    radius * 2,
                )
            cv2.circle(image, (int(u), int(v)), radius, (0, 255, 0), -1)
            noise = self._rng.normal(0.0, self._simulation.measurement_noise_m, 3)
            exposure_offset_s = self._rng.uniform(-0.5, 0.5) * self._simulation.exposure_time_s
            measured = position + state.velocity.as_array() * exposure_offset_s + noise
            covariance = np.eye(3, dtype=np.float64) * self._simulation.measurement_noise_m**2
            velocity = state.velocity.as_array()
            speed = float(np.linalg.norm(velocity))
            if speed > 1e-12:
                direction = velocity / speed
                blur_variance = (speed * self._simulation.exposure_time_s) ** 2 / 12.0
                covariance += blur_variance * np.outer(direction, direction)
            blur_pixels = (
                0.0
                if start_px is None or end_px is None
                else float(np.linalg.norm(np.asarray(end_px) - np.asarray(start_px)))
            )
            confidence = float(np.clip(0.98 * np.exp(-blur_pixels / 30.0), 0.5, 0.98))
            self.last_detections.append(
                TargetDetection(
                    (u - radius, v - radius, radius * 2.0, radius * 2.0),
                    (u, v),
                    confidence,
                    "synthetic_target",
                    frame_time_ns,
                    target.target_id,
                    Vector3.from_array(measured),
                    covariance,
                )
            )
        latency_s = max(
            0.0,
            self._simulation.camera_latency_s
            + self._rng.normal(0.0, self._simulation.camera_latency_jitter_s),
        )
        processing_ns = frame_time_ns + int(latency_s * 1e9)
        return Frame(image, frame_time_ns, processing_ns, frame_id)

    def close(self) -> None:
        """Release no-op simulated resources."""

    def _project(self, position: np.ndarray, focal: float) -> tuple[float, float] | None:
        if position[0] <= 0.05:
            return None
        return (
            self._camera.width * 0.5 - focal * float(position[1]) / float(position[0]),
            self._camera.height * 0.5 - focal * float(position[2]) / float(position[0]),
        )
