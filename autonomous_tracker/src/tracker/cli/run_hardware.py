"""Run a real camera and pan/tilt tracker with simulation-only shot records."""

from __future__ import annotations

import argparse
import dataclasses
import math
import time
from contextlib import suppress
from pathlib import Path

import cv2
import numpy as np

from tracker.autonomy.confidence import alignment_confidence, range_aware_alignment_tolerance
from tracker.autonomy.selector import TargetSelector
from tracker.autonomy.shot_logic import PermissionContext, SimulatedLauncher, can_simulate_fire
from tracker.ballistics.models import ProjectileModel
from tracker.ballistics.solver import SolverConstraints, solve_with_fallback
from tracker.calibration.intrinsic import IntrinsicCalibration
from tracker.config import AppConfig, load_config
from tracker.control.aimer import PanTiltAimController, compute_angular_velocity
from tracker.estimation.prediction import predict_target
from tracker.estimation.track_state import track_to_target_state
from tracker.hardware.serial_motor import SerialPanTilt
from tracker.hardware.simulated import SimulatedPanTilt
from tracker.hardware.watchdog import WatchdogManager
from tracker.simulation.visualizer import opencv_gui_available
from tracker.state_machine import StateMachine, SystemState
from tracker.telemetry.logger import JSONLLogger
from tracker.types import (
    AimCommand,
    AlignmentMetrics,
    BallisticSolution,
    Pose3D,
    TargetDetection,
    Vector3,
)
from tracker.vision.calibration import TransformGraph
from tracker.vision.camera import OpenCVCamera, VideoFileCamera
from tracker.vision.detector import ArucoDetector, TargetDetector, make_detector
from tracker.vision.overlay import OverlayDiagnostics, draw_debug_overlay
from tracker.vision.pose import estimate_aruco_pose, estimate_range_from_width
from tracker.vision.tracker import MultiTargetTracker


def build_parser() -> argparse.ArgumentParser:
    """Build the hardware CLI parser."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("configs/hardware.yaml"))
    parser.add_argument("--max-frames", type=int, default=0)
    parser.add_argument("--debug-video", type=Path)
    parser.add_argument("--show", action="store_true", help="show the live annotated camera")
    return parser


def run(args: argparse.Namespace) -> int:
    """Track and point a physical pan/tilt rig without any projectile actuation."""
    config = load_config(args.config)
    if config.system.mode != "hardware":
        raise ValueError("hardware CLI requires system.mode=hardware")
    calibration = _load_intrinsic_calibration(config)
    camera = _make_camera(config)
    platform = (
        SerialPanTilt(config.pan_tilt)
        if config.pan_tilt.backend == "serial"
        else SimulatedPanTilt(config.pan_tilt)
    )
    detector = make_detector(config.target)
    tracker = MultiTargetTracker(config.target, config.estimator)
    selector = TargetSelector(config.selection_weights)
    controller = PanTiltAimController(config.pan_tilt)
    machine = StateMachine()
    machine.transition(SystemState.TRACKING, "hardware tracking started")
    watchdog = WatchdogManager(platform, machine)
    watchdog.set_required("firmware", config.pan_tilt.backend == "serial")
    watchdog.set_required("serial", config.pan_tilt.backend == "serial")
    logger = JSONLLogger(config.logging.path, "hardware") if config.logging.enabled else None
    launcher = SimulatedLauncher(
        config.simulated_fire.cooldown_s, config.simulated_fire.hit_tolerance_m
    )
    transform_graph = TransformGraph()
    transform_graph.add(
        Pose3D(
            np.asarray(config.camera.camera_to_platform, dtype=np.float64),
            "camera",
            "platform",
        )
    )
    projectile = ProjectileModel.from_config(config.projectile, config.environment)
    constraints = SolverConstraints(
        maximum_flight_time_s=config.projectile.maximum_integration_time_s,
        minimum_azimuth_rad=config.pan_tilt.pan.minimum_rad,
        maximum_azimuth_rad=config.pan_tilt.pan.maximum_rad,
        minimum_elevation_rad=config.pan_tilt.tilt.minimum_rad,
        maximum_elevation_rad=config.pan_tilt.tilt.maximum_rad,
        maximum_iterations=config.projectile.maximum_solver_iterations,
        valid_miss_distance_m=config.simulated_fire.hit_tolerance_m,
        integration_timestep_s=config.projectile.integration_timestep_s,
        projectile_radius_m=config.projectile.diameter_m * 0.5,
        target_radius_m=max(config.target.width_m, config.target.height_m) * 0.5,
    )
    previous_ns = time.monotonic_ns()
    last_solver_ns = 0
    solution_timestamp_ns: int | None = None
    solution_track_id: int | None = None
    solution_angular_velocity = (0.0, 0.0)
    solution: BallisticSolution | None = None
    frame_count = 0
    debug_video = getattr(args, "debug_video", None)
    writer = _make_debug_writer(debug_video, config) if debug_video is not None else None
    show = bool(getattr(args, "show", False))
    if show and not opencv_gui_available():
        raise RuntimeError(
            "--show requires opencv-python with a GUI backend; "
            "use --debug-video on headless systems"
        )
    window_name = "Autonomous YOLO Tracker"
    try:
        while args.max_frames <= 0 or frame_count < args.max_frames:
            watchdog.heartbeat("host")
            frame = camera.read()
            if frame is None:
                if not watchdog.check().healthy:
                    break
                continue
            frame_count += 1
            watchdog.heartbeat("camera")
            raw_detections = detector.detect(frame)
            detections = _estimate_positions(
                raw_detections, detector, calibration, config, transform_graph
            )
            tracks = tracker.update(detections, frame.capture_timestamp_ns)
            watchdog.heartbeat("tracker")
            processing_ns = time.monotonic_ns()
            motor_state = platform.state()
            selected = selector.select(tracks, motor_state)
            command = AimCommand(motor_state.azimuth_rad, motor_state.elevation_rad)
            alignment = AlignmentMetrics(0.0, 0.0, 0.0, 0.0)
            latency_s = 0.0
            if machine.state == SystemState.COOLDOWN and launcher.cooldown_complete():
                machine.transition(SystemState.TRACKING, "simulated shot cooldown complete")
            if selected is not None:
                state = track_to_target_state(selected)
                latency_s = max(0.0, (processing_ns - state.timestamp_ns) * 1e-9)
                predicted = predict_target(
                    state,
                    latency_s,
                    config.estimator.model,
                    config.estimator.process_noise,
                    config.estimator.maximum_prediction_horizon_s,
                ).state
                solve_interval_ns = int(1e9 / config.system.solver_rate_hz)
                if (
                    solution is None
                    or solution_track_id != selected.track_id
                    or processing_ns - last_solver_ns >= solve_interval_ns
                ):
                    solution = solve_with_fallback(
                        Vector3(0.0, 0.0, 0.0),
                        predicted,
                        config.projectile.muzzle_velocity_mps,
                        projectile,
                        constraints,
                    )
                    last_solver_ns = processing_ns
                    solution_track_id = selected.track_id
                    if solution is not None and solution.valid:
                        solution_timestamp_ns = processing_ns
                        solution_angular_velocity = compute_angular_velocity(
                            Vector3(0.0, 0.0, 0.0),
                            solution.predicted_target_position,
                            Vector3.from_array(
                                predicted.velocity.as_array()
                                + predicted.acceleration.as_array() * solution.flight_time_s
                            ),
                        )
                    else:
                        solution_timestamp_ns = None
                if solution is not None and solution_timestamp_ns is not None:
                    solution_age_s = max(0.0, (processing_ns - solution_timestamp_ns) * 1e-9)
                    aimed_azimuth = (
                        solution.azimuth_rad + solution_angular_velocity[0] * solution_age_s
                    )
                    aimed_elevation = (
                        solution.elevation_rad + solution_angular_velocity[1] * solution_age_s
                    )
                    now = processing_ns
                    dt = max(1e-4, (now - previous_ns) * 1e-9)
                    previous_ns = now
                    command = controller.update(
                        AimCommand(
                            aimed_azimuth,
                            aimed_elevation,
                            *solution_angular_velocity,
                            timestamp_ns=now,
                        ),
                        motor_state,
                        dt,
                    )
                    platform.command_velocity(
                        command.azimuth_velocity_radps, command.elevation_velocity_radps
                    )
                    pan_error = (aimed_azimuth - motor_state.azimuth_rad + math.pi) % (
                        2.0 * math.pi
                    ) - math.pi
                    tilt_error = aimed_elevation - motor_state.elevation_rad
                    target_dimensions = config.target.dimensions_for_label(selected.class_label)
                    alignment_tolerance = range_aware_alignment_tolerance(
                        Vector3(0.0, 0.0, 0.0),
                        solution.predicted_target_position,
                        max(target_dimensions) * 0.5,
                        config.projectile.diameter_m * 0.5,
                        config.simulated_fire.alignment_tolerance_rad,
                        config.simulated_fire.alignment_radius_fraction,
                    )
                    alignment = alignment_confidence(
                        pan_error,
                        tilt_error,
                        selected,
                        solution,
                        motor_state,
                        latency_s,
                        alignment_tolerance,
                        config.simulated_fire.maximum_target_age_s,
                        config.alignment_weights,
                    )
                    aligned = alignment.total_error_rad <= alignment_tolerance
                    _update_autonomy_state(
                        machine,
                        aligned,
                        selected.confidence,
                        alignment.confidence,
                        config,
                    )
                    health = watchdog.check()
                    stability = math.exp(
                        -math.hypot(
                            motor_state.azimuth_velocity_radps,
                            motor_state.elevation_velocity_radps,
                        )
                    )
                    permission = can_simulate_fire(
                        PermissionContext(
                            machine.state,
                            selected.confidence,
                            alignment,
                            solution,
                            latency_s,
                            launcher.cooldown_complete(),
                            health,
                            stability,
                            alignment_tolerance,
                        ),
                        config.simulated_fire,
                    )
                    if permission.allowed:
                        machine.transition(
                            SystemState.SIMULATED_FIRING,
                            "software-only shot authorized",
                        )
                        shot = launcher.fire(solution)
                        if logger is not None:
                            logger.log("simulated_shot", shot, processing_ns)
                        machine.transition(
                            SystemState.COOLDOWN,
                            "software-only shot recorded",
                        )
                    if logger is not None:
                        logger.log(
                            "tracking_frame",
                            {
                                "detections": detections,
                                "tracks": tracks,
                                "selected_track": selected.track_id,
                                "estimated_state": state,
                                "ballistic_solution": solution,
                                "motor_command": command,
                                "motor_state": motor_state,
                                "system_state": machine.state,
                                "latency_s": latency_s,
                                "simulated_shot_count": len(launcher.shots),
                            },
                            frame.capture_timestamp_ns,
                        )
                else:
                    platform.command_velocity(0.0, 0.0)
                    if machine.state in {SystemState.ALIGNED, SystemState.READY}:
                        machine.transition(SystemState.TRACKING, "intercept solution unavailable")
            else:
                platform.command_velocity(0.0, 0.0)
                solution = None
                solution_timestamp_ns = None
                solution_track_id = None
                if machine.state in {SystemState.ALIGNED, SystemState.READY}:
                    machine.transition(SystemState.TRACKING, "selected target lost")
            if writer is not None or show:
                diagnostics = OverlayDiagnostics(
                    command.azimuth_rad,
                    command.elevation_rad,
                    alignment,
                    machine.state,
                    config.camera.fps,
                    latency_s * 1000.0,
                    selected.track_id if selected is not None else None,
                )
                rendered = draw_debug_overlay(
                    frame.image,
                    raw_detections,
                    tracks,
                    motor_state,
                    solution,
                    diagnostics,
                )
                cv2.putText(
                    rendered,
                    f"SIMULATED SHOTS {len(launcher.shots)}",
                    (10, rendered.shape[0] - 12),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.55,
                    (80, 220, 255),
                    2,
                    cv2.LINE_AA,
                )
                if writer is not None:
                    writer.write(rendered)
                if show:
                    cv2.imshow(window_name, rendered)
                    if cv2.waitKey(1) & 0xFF in {27, ord("q")}:
                        break
            if config.pan_tilt.backend == "serial":
                assert isinstance(platform, SerialPanTilt)
                frames = platform.poll()
                if frames:
                    watchdog.heartbeat("serial")
                    watchdog.heartbeat("firmware")
                platform.ping()
            elif isinstance(platform, SimulatedPanTilt):
                platform.step(1.0 / config.system.loop_hz)
            if not watchdog.check().healthy:
                break
    except KeyboardInterrupt:
        pass
    finally:
        platform.stop()
        camera.close()
        if writer is not None:
            writer.release()
        if show:
            with suppress(cv2.error):
                cv2.destroyWindow(window_name)
        if isinstance(platform, SerialPanTilt):
            platform.close()
    return 0 if machine.state != SystemState.FAULT else 2


def _update_autonomy_state(
    machine: StateMachine,
    aligned: bool,
    tracking_confidence: float,
    alignment_score: float,
    config: AppConfig,
) -> None:
    """Advance hardware tracking through simulation-only authorization states."""
    if machine.state == SystemState.TRACKING and aligned:
        machine.transition(SystemState.ALIGNED, "range-aware alignment reached")
    if machine.state == SystemState.ALIGNED:
        if not aligned:
            machine.transition(SystemState.TRACKING, "alignment lost")
        elif (
            tracking_confidence >= config.simulated_fire.minimum_tracking_confidence
            and alignment_score >= config.simulated_fire.minimum_alignment_confidence
        ):
            machine.transition(SystemState.READY, "simulation-only confidence gates satisfied")
    elif machine.state == SystemState.READY and not aligned:
        machine.transition(SystemState.TRACKING, "alignment lost")


def _make_debug_writer(path: Path, config: AppConfig) -> cv2.VideoWriter:
    path.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(
        str(path),
        cv2.VideoWriter.fourcc(*"mp4v"),
        config.camera.fps,
        (config.camera.width, config.camera.height),
    )
    if not writer.isOpened():
        raise RuntimeError(f"unable to create debug video: {path}")
    return writer


def _load_intrinsic_calibration(config: AppConfig) -> IntrinsicCalibration | None:
    """Load camera intrinsics with actionable errors and resolution validation."""
    path = config.camera.intrinsics_path
    if path is None:
        return None
    if not path.is_file():
        raise FileNotFoundError(
            f"camera calibration not found at {path.resolve()}. Run: "
            f"python -m tracker.cli.calibrate camera --device {config.camera.device} "
            "--checkerboard 9x6 --square-size 0.024 --frames 20 "
            f"--output {path} --show"
        )
    calibration = IntrinsicCalibration.load(path)
    configured_size = (config.camera.width, config.camera.height)
    calibrated_size = (calibration.image_width, calibration.image_height)
    if calibrated_size != configured_size:
        raise ValueError(
            f"camera calibration resolution is {calibrated_size[0]}x{calibrated_size[1]}, "
            f"but the camera is configured for {configured_size[0]}x{configured_size[1]}"
        )
    return calibration


def _make_camera(config: AppConfig) -> OpenCVCamera:
    if config.camera.backend == "video":
        return VideoFileCamera(str(config.camera.device))
    if config.camera.backend != "opencv":
        raise ValueError("hardware mode camera must use opencv or video backend")
    return OpenCVCamera(
        config.camera.device,
        config.camera.width,
        config.camera.height,
        config.camera.fps,
        config.camera.exposure,
    )


def _estimate_positions(
    detections: list[TargetDetection],
    detector: TargetDetector,
    calibration: IntrinsicCalibration | None,
    config: AppConfig,
    transforms: TransformGraph,
) -> list[TargetDetection]:
    if calibration is None:
        return []
    positioned: list[TargetDetection] = []
    for detection in detections:
        if isinstance(detector, ArucoDetector) and detection.marker_id is not None:
            corners = detector.last_corners[detection.marker_id]
            position, covariance = estimate_aruco_pose(
                corners,
                config.target.width_m,
                calibration.camera_matrix,
                calibration.distortion_coefficients,
            )
        else:
            target_width_m, _ = config.target.dimensions_for_label(detection.class_label)
            position, covariance = estimate_range_from_width(
                detection,
                target_width_m,
                float(calibration.camera_matrix[0, 0]),
                (
                    float(calibration.camera_matrix[0, 2]),
                    float(calibration.camera_matrix[1, 2]),
                ),
            )
        platform_position = transforms.transform_point("camera", "platform", position)
        platform_covariance = transforms.transform_covariance("camera", "platform", covariance)
        positioned.append(
            dataclasses.replace(
                detection,
                position=platform_position,
                position_covariance=platform_covariance,
            )
        )
    return positioned


def main() -> None:
    """CLI entry point."""
    parser = build_parser()
    try:
        exit_code = run(parser.parse_args())
    except (FileNotFoundError, RuntimeError, ValueError) as exc:
        parser.error(str(exc))
    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
