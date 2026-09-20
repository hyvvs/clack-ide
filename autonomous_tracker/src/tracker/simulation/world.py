"""End-to-end deterministic tracking and simulated interception world."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from tracker.autonomy.confidence import alignment_confidence, range_aware_alignment_tolerance
from tracker.autonomy.selector import TargetSelector
from tracker.autonomy.shot_logic import PermissionContext, SimulatedLauncher, can_simulate_fire
from tracker.ballistics.impact import ImpactEvaluation, evaluate_sampled_closest_approach
from tracker.ballistics.integrator import (
    ProjectileTrajectory,
    integrate_projectile,
    launch_velocity,
)
from tracker.ballistics.models import ProjectileModel
from tracker.ballistics.solver import SolverConstraints, solve_with_fallback
from tracker.config import AppConfig
from tracker.control.aimer import PanTiltAimController, compute_angular_velocity
from tracker.estimation.prediction import predict_target
from tracker.estimation.track_state import track_to_target_state
from tracker.hardware.simulated import SimulatedPanTilt
from tracker.simulation.camera_sim import SimulatedCamera
from tracker.simulation.metrics import SimulationMetrics
from tracker.simulation.target import SyntheticTarget
from tracker.simulation.visualizer import FrameObserver, SimulationFrame
from tracker.state_machine import StateMachine, SystemState
from tracker.types import (
    AimCommand,
    AlignmentMetrics,
    BallisticSolution,
    MotorState,
    SystemHealth,
    Track,
    Vector3,
)
from tracker.vision.tracker import MultiTargetTracker


@dataclass(frozen=True, slots=True)
class SimulationResult:
    """Final state and metrics from a deterministic run."""

    summary: dict[str, float | int | None]
    final_state: SystemState
    solution: BallisticSolution | None
    selected_track_id: int | None


@dataclass(frozen=True, slots=True)
class _ActiveProjectile:
    launch_timestamp_ns: int
    trajectory: ProjectileTrajectory
    impact: ImpactEvaluation


class SimulationWorld:
    """Connect sensing, estimation, solving, control, and software-only impacts."""

    def __init__(self, config: AppConfig, frame_observer: FrameObserver | None = None) -> None:
        if config.system.mode != "simulation":
            raise ValueError("SimulationWorld requires system.mode=simulation")
        self.config = config
        self._frame_observer = frame_observer
        start_ns = 1_000_000_000
        self.targets = [
            SyntheticTarget(index + 1, target, start_ns, config.simulation.random_seed + index)
            for index, target in enumerate(config.simulation.targets)
        ]
        self.camera = SimulatedCamera(
            config.camera,
            config.simulation,
            config.target,
            self.targets,
            start_timestamp_ns=start_ns,
        )
        self.tracker = MultiTargetTracker(config.target, config.estimator)
        self.selector = TargetSelector(config.selection_weights)
        self.platform = SimulatedPanTilt(config.pan_tilt)
        self.controller = PanTiltAimController(config.pan_tilt)
        self.projectile_model = ProjectileModel.from_config(config.projectile, config.environment)
        self.constraints = SolverConstraints(
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
        self.state_machine = StateMachine()
        self.metrics = SimulationMetrics()
        self.launcher = SimulatedLauncher(
            config.simulated_fire.cooldown_s,
            config.simulated_fire.hit_tolerance_m,
            clock_ns=lambda: self._current_timestamp_ns,
        )
        self._current_timestamp_ns = start_ns
        self._active_projectiles: list[_ActiveProjectile] = []

    def run(self) -> SimulationResult:
        """Run faster than real time while preserving configured monotonic timing."""
        self.state_machine.transition(SystemState.TRACKING, "simulation started")
        dt = 1.0 / self.config.system.loop_hz
        total_steps = math.ceil(self.config.simulation.duration_s / dt)
        camera_interval_steps = max(1, round(self.config.system.loop_hz / self.config.camera.fps))
        controller_dt = camera_interval_steps * dt
        solution: BallisticSolution | None = None
        solution_timestamp_ns: int | None = None
        solution_angular_velocity = (0.0, 0.0)
        last_solve_step = -1000
        previous_had_track = False
        launcher_origin = Vector3(0.0, 0.0, 0.0)
        for step in range(total_steps):
            if step % camera_interval_steps != 0:
                self.platform.step(dt)
                continue
            frame = self.camera.read()
            if frame is None:
                self.platform.step(dt)
                continue
            self._current_timestamp_ns = frame.processing_timestamp_ns
            tracks = self.tracker.update(self.camera.last_detections, frame.capture_timestamp_ns)
            if previous_had_track and not tracks:
                self.metrics.track_losses += 1
            previous_had_track = bool(tracks)
            motor = self.platform.state()
            selected = self.selector.select(tracks, motor)
            if selected is None:
                self.platform.step(dt)
                continue
            target_state = track_to_target_state(selected)
            latency_s = max(0.0, (frame.processing_timestamp_ns - target_state.timestamp_ns) * 1e-9)
            latency_compensated = predict_target(
                target_state,
                latency_s,
                self.config.estimator.model,
                self.config.estimator.process_noise,
                self.config.estimator.maximum_prediction_horizon_s,
            ).state
            if step - last_solve_step >= max(
                1, int(self.config.system.loop_hz / self.config.system.solver_rate_hz)
            ):
                solution = solve_with_fallback(
                    launcher_origin,
                    latency_compensated,
                    self.config.projectile.muzzle_velocity_mps,
                    self.projectile_model,
                    self.constraints,
                )
                self.metrics.solver_attempts += 1
                if solution is not None and solution.valid:
                    self.metrics.solver_successes += 1
                    self.metrics.ballistic_miss_m.append(solution.miss_distance_m)
                    solution_timestamp_ns = self._current_timestamp_ns
                    solution_angular_velocity = compute_angular_velocity(
                        launcher_origin,
                        solution.predicted_target_position,
                        Vector3.from_array(
                            latency_compensated.velocity.as_array()
                            + latency_compensated.acceleration.as_array() * solution.flight_time_s
                        ),
                    )
                last_solve_step = step
            if solution is None or solution_timestamp_ns is None:
                self.platform.step(dt)
                continue
            solution_age_s = max(0.0, (self._current_timestamp_ns - solution_timestamp_ns) * 1e-9)
            aimed_azimuth = solution.azimuth_rad + solution_angular_velocity[0] * solution_age_s
            aimed_elevation = solution.elevation_rad + solution_angular_velocity[1] * solution_age_s
            desired = AimCommand(
                aimed_azimuth,
                aimed_elevation,
                *solution_angular_velocity,
                timestamp_ns=self._current_timestamp_ns,
            )
            command = self.controller.update(desired, motor, controller_dt)
            self.platform.command_velocity(
                command.azimuth_velocity_radps, command.elevation_velocity_radps
            )
            motor = self.platform.step(dt)
            pan_error = _angle_error(aimed_azimuth, motor.azimuth_rad)
            tilt_error = aimed_elevation - motor.elevation_rad
            alignment_tolerance = self._alignment_tolerance(
                launcher_origin, solution.predicted_target_position
            )
            alignment = alignment_confidence(
                pan_error,
                tilt_error,
                selected,
                solution,
                motor,
                latency_s,
                alignment_tolerance,
                self.config.simulated_fire.maximum_target_age_s,
                self.config.alignment_weights,
            )
            self._record_metrics(
                step,
                dt,
                selected.state,
                solution,
                pan_error,
                tilt_error,
                frame.capture_timestamp_ns,
            )
            aligned = alignment.total_error_rad <= alignment_tolerance
            self._update_state(aligned, selected.confidence, alignment.confidence)
            context = PermissionContext(
                self.state_machine.state,
                selected.confidence,
                alignment,
                solution,
                latency_s,
                self.launcher.cooldown_complete(),
                SystemHealth(True),
                math.exp(-math.hypot(motor.azimuth_velocity_radps, motor.elevation_velocity_radps)),
                alignment_tolerance,
            )
            if can_simulate_fire(context, self.config.simulated_fire).allowed:
                self.state_machine.transition(
                    SystemState.SIMULATED_FIRING, "simulated shot authorized"
                )
                truth_impact, truth_trajectory = self._simulate_truth_impact(
                    launcher_origin,
                    motor.azimuth_rad,
                    motor.elevation_rad,
                    selected.track_id,
                )
                shot = self.launcher.fire(solution, impact=truth_impact)
                self._active_projectiles.append(
                    _ActiveProjectile(
                        self._current_timestamp_ns,
                        truth_trajectory,
                        truth_impact,
                    )
                )
                self.metrics.simulated_shots += 1
                self.metrics.simulated_hits += int(shot.hit)
                self.metrics.truth_impact_miss_m.append(shot.miss_distance_m)
                self.state_machine.transition(SystemState.COOLDOWN, "simulated shot recorded")
            if not self._emit_frame(
                frame.image,
                tracks,
                motor,
                solution,
                desired,
                alignment,
                latency_s,
            ):
                break
        return SimulationResult(
            self.metrics.summary(),
            self.state_machine.state,
            solution,
            self.selector.selected_id,
        )

    def _simulate_truth_impact(
        self,
        launcher_origin: Vector3,
        actual_azimuth_rad: float,
        actual_elevation_rad: float,
        target_id: int,
    ) -> tuple[ImpactEvaluation, ProjectileTrajectory]:
        """Propagate an independently aimed projectile against exact target truth."""
        trajectory = integrate_projectile(
            launcher_origin.as_array(),
            launch_velocity(
                self.config.projectile.muzzle_velocity_mps,
                actual_azimuth_rad,
                actual_elevation_rad,
            ),
            self.projectile_model,
            self.config.projectile.maximum_integration_time_s,
            self.config.projectile.integration_timestep_s * 0.5,
        )
        exact_target = next(target for target in self.targets if target.target_id == target_id)
        target_positions = np.asarray(
            [
                exact_target.state_at(
                    self._current_timestamp_ns + int(float(time_s) * 1e9)
                ).position.as_array()
                for time_s in trajectory.times_s
            ]
        )
        impact = evaluate_sampled_closest_approach(
            trajectory,
            target_positions,
            launcher_origin.frame,
            self.config.projectile.diameter_m * 0.5,
            max(self.config.target.width_m, self.config.target.height_m) * 0.5,
        )
        return impact, trajectory

    def _emit_frame(
        self,
        image: NDArray[np.uint8],
        tracks: tuple[Track, ...],
        motor: MotorState,
        solution: BallisticSolution,
        desired: AimCommand,
        alignment: AlignmentMetrics,
        latency_s: float,
    ) -> bool:
        """Send one synchronized view to an optional visualization sink."""
        if self._frame_observer is None:
            return True
        exact_positions = tuple(
            target.state_at(self._current_timestamp_ns).position for target in self.targets
        )
        snapshot = SimulationFrame(
            image,
            tuple(self.camera.last_detections),
            tracks,
            motor,
            solution,
            desired,
            alignment,
            self.state_machine.state,
            self.selector.selected_id,
            exact_positions,
            self._active_projectile_positions(),
            self.config.camera.fps,
            latency_s * 1000.0,
            self.metrics.simulated_shots,
            self.metrics.simulated_hits,
        )
        return self._frame_observer(snapshot)

    def _active_projectile_positions(self) -> tuple[Vector3, ...]:
        active: list[_ActiveProjectile] = []
        positions: list[Vector3] = []
        for projectile in self._active_projectiles:
            elapsed_s = (self._current_timestamp_ns - projectile.launch_timestamp_ns) * 1e-9
            end_s = (
                projectile.impact.time_s
                if projectile.impact.collided
                else float(projectile.trajectory.times_s[-1])
            )
            if elapsed_s < 0.0 or elapsed_s > end_s:
                continue
            active.append(projectile)
            coordinates = np.asarray(
                [
                    np.interp(
                        elapsed_s,
                        projectile.trajectory.times_s,
                        projectile.trajectory.positions_m[:, axis],
                    )
                    for axis in range(3)
                ]
            )
            positions.append(Vector3.from_array(coordinates))
        self._active_projectiles = active
        return tuple(positions)

    def _alignment_tolerance(self, origin: Vector3, target: Vector3) -> float:
        """Return a range-aware tolerance inside the target collision footprint."""
        return range_aware_alignment_tolerance(
            origin,
            target,
            max(self.config.target.width_m, self.config.target.height_m) * 0.5,
            self.config.projectile.diameter_m * 0.5,
            self.config.simulated_fire.alignment_tolerance_rad,
            self.config.simulated_fire.alignment_radius_fraction,
        )

    def _update_state(
        self, aligned: bool, tracking_confidence: float, alignment_score: float
    ) -> None:
        state = self.state_machine.state
        if state == SystemState.COOLDOWN:
            if self.launcher.cooldown_complete():
                self.state_machine.transition(SystemState.TRACKING, "cooldown complete")
            return
        if state == SystemState.TRACKING and aligned:
            self.state_machine.transition(SystemState.ALIGNED, "angular tolerance reached")
            if self.metrics.first_alignment_s is None:
                self.metrics.first_alignment_s = (self._current_timestamp_ns - 1_000_000_000) * 1e-9
            state = SystemState.ALIGNED
        if state == SystemState.ALIGNED:
            if not aligned:
                self.state_machine.transition(SystemState.TRACKING, "alignment lost")
            elif (
                tracking_confidence >= self.config.simulated_fire.minimum_tracking_confidence
                and alignment_score >= self.config.simulated_fire.minimum_alignment_confidence
            ):
                self.state_machine.transition(SystemState.READY, "confidence gates satisfied")
        elif state == SystemState.READY and not aligned:
            self.state_machine.transition(SystemState.TRACKING, "alignment lost")

    def _record_metrics(
        self,
        step: int,
        dt: float,
        estimated_state: np.ndarray,
        solution: BallisticSolution,
        pan_error: float,
        tilt_error: float,
        capture_timestamp_ns: int,
    ) -> None:
        selected_id = self.selector.selected_id
        exact_target = next(
            (target for target in self.targets if target.target_id == selected_id), None
        )
        if exact_target is None:
            return
        exact = exact_target.state_at(capture_timestamp_ns)
        self.metrics.tracking_error_squared.append(
            float(np.sum((estimated_state[:3] - exact.position.as_array()) ** 2))
        )
        self.metrics.velocity_error_squared.append(
            float(np.sum((estimated_state[3:6] - exact.velocity.as_array()) ** 2))
        )
        future_exact = exact_target.state_at(
            capture_timestamp_ns + int(solution.flight_time_s * 1e9)
        )
        self.metrics.prediction_error_squared.append(
            float(
                np.sum(
                    (
                        solution.predicted_target_position.as_array()
                        - future_exact.position.as_array()
                    )
                    ** 2
                )
            )
        )
        self.metrics.pan_error_rad.append(pan_error)
        self.metrics.tilt_error_rad.append(tilt_error)
        if self.metrics.first_alignment_s is not None:
            self.metrics.post_alignment_prediction_error_squared.append(
                self.metrics.prediction_error_squared[-1]
            )
            self.metrics.post_alignment_pan_error_rad.append(pan_error)
            self.metrics.post_alignment_tilt_error_rad.append(tilt_error)


def _angle_error(target: float, current: float) -> float:
    return (target - current + math.pi) % (2.0 * math.pi) - math.pi
