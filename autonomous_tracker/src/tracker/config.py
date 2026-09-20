"""Typed configuration loading and validation."""

from __future__ import annotations

import math
from itertools import pairwise
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    """Base configuration model that rejects unknown fields."""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class CameraConfig(StrictModel):
    """Camera acquisition and calibration settings."""

    backend: Literal["simulated", "opencv", "video"] = "simulated"
    device: int | str = 0
    width: int = Field(default=1280, gt=0)
    height: int = Field(default=720, gt=0)
    fps: float = Field(default=30.0, gt=0.0)
    exposure: float | None = None
    intrinsics_path: Path | None = None
    distortion_coefficients: list[float] = Field(default_factory=list)
    camera_to_platform: list[list[float]] = Field(
        default_factory=lambda: [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ]
    )

    @model_validator(mode="after")
    def validate_transform(self) -> CameraConfig:
        """Require a finite homogeneous 4 by 4 camera transform."""
        if len(self.camera_to_platform) != 4 or any(
            len(row) != 4 for row in self.camera_to_platform
        ):
            raise ValueError("camera_to_platform must be a 4 by 4 matrix")
        if not all(math.isfinite(value) for row in self.camera_to_platform for value in row):
            raise ValueError("camera_to_platform must be finite")
        return self


class TargetConfig(StrictModel):
    """Target geometry, detector, and association settings."""

    detector: Literal["color_blob", "aruco", "yolo", "simulated"] = "color_blob"
    width_m: float = Field(default=0.15, gt=0.0)
    height_m: float = Field(default=0.15, gt=0.0)
    class_dimensions_m: dict[str, tuple[float, float]] = Field(default_factory=dict)
    minimum_confidence: float = Field(default=0.6, ge=0.0, le=1.0)
    association_gate_m: float = Field(default=1.5, gt=0.0)
    hue_min: int = Field(default=35, ge=0, le=179)
    hue_max: int = Field(default=85, ge=0, le=179)
    yolo_model: str = "yolo26n.pt"
    yolo_device: str | None = None
    yolo_image_size: int = Field(default=640, ge=32)
    yolo_iou_threshold: float = Field(default=0.7, gt=0.0, le=1.0)
    yolo_max_detections: int = Field(default=100, ge=1)
    yolo_class_ids: list[int] = Field(default_factory=list)
    yolo_class_names: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_detector_settings(self) -> TargetConfig:
        """Validate geometry maps and YOLO selection settings."""
        if self.hue_min > self.hue_max:
            raise ValueError("hue_min cannot exceed hue_max")
        if not self.yolo_model.strip():
            raise ValueError("yolo_model cannot be empty")
        if any(class_id < 0 for class_id in self.yolo_class_ids):
            raise ValueError("YOLO class IDs cannot be negative")
        if len(set(self.yolo_class_ids)) != len(self.yolo_class_ids):
            raise ValueError("YOLO class IDs must be unique")
        normalized_names = [name.strip().casefold() for name in self.yolo_class_names]
        if any(not name for name in normalized_names):
            raise ValueError("YOLO class names cannot be empty")
        if len(set(normalized_names)) != len(normalized_names):
            raise ValueError("YOLO class names must be unique")
        if any(
            not name.strip() or width <= 0.0 or height <= 0.0
            for name, (width, height) in self.class_dimensions_m.items()
        ):
            raise ValueError("class dimensions require a name and positive width and height")
        return self

    def dimensions_for_label(self, class_label: str) -> tuple[float, float]:
        """Return configured dimensions for one class or the nominal fallback."""
        return self.class_dimensions_m.get(class_label, (self.width_m, self.height_m))


class EstimatorConfig(StrictModel):
    """State-estimation model and uncertainty limits."""

    model: Literal["constant_position", "constant_velocity", "constant_acceleration"] = (
        "constant_acceleration"
    )
    process_noise: float = Field(default=0.5, gt=0.0)
    measurement_noise: float = Field(default=0.05, gt=0.0)
    maximum_prediction_horizon_s: float = Field(default=2.0, gt=0.0)
    track_timeout_s: float = Field(default=0.5, gt=0.0)
    max_missed_frames: int = Field(default=10, ge=0)
    maximum_covariance_trace: float = Field(default=25.0, gt=0.0)


class EnvironmentConfig(StrictModel):
    """Environment used by simulated projectile dynamics."""

    gravity_mps2: tuple[float, float, float] = (0.0, 0.0, -9.80665)
    wind_mps: tuple[float, float, float] = (0.0, 0.0, 0.0)
    air_density_kgpm3: float = Field(default=1.225, ge=0.0)


class ProjectileConfig(StrictModel):
    """Parameters for the simulated projectile only."""

    muzzle_velocity_mps: float = Field(default=18.0, gt=0.0)
    mass_kg: float = Field(default=0.002, gt=0.0)
    diameter_m: float = Field(default=0.013, gt=0.0)
    drag_coefficient: float = Field(default=0.45, ge=0.0)
    drag_model: Literal["constant", "mach_curve"] = "constant"
    speed_of_sound_mps: float = Field(default=343.0, gt=0.0)
    mach_drag_table: list[tuple[float, float]] = Field(
        default_factory=lambda: [
            (0.0, 0.30),
            (0.70, 0.31),
            (0.90, 0.38),
            (1.00, 0.52),
            (1.20, 0.42),
            (2.00, 0.34),
            (3.00, 0.30),
        ]
    )
    aerodynamic_lift_coefficient: float = Field(default=0.0, ge=0.0)
    lift_axis: tuple[float, float, float] = (0.0, 0.0, 1.0)
    enable_drag: bool = True
    integration_timestep_s: float = Field(default=0.002, gt=0.0)
    maximum_integration_time_s: float = Field(default=3.0, gt=0.0)
    maximum_solver_iterations: int = Field(default=80, gt=0)

    @property
    def reference_area_m2(self) -> float:
        """Return circular cross-sectional area in square meters."""
        return math.pi * (self.diameter_m * 0.5) ** 2

    @model_validator(mode="after")
    def validate_aerodynamics(self) -> ProjectileConfig:
        """Validate an ordered finite Mach drag curve and lift axis."""
        if len(self.mach_drag_table) < 2:
            raise ValueError("mach_drag_table requires at least two points")
        mach_values = [point[0] for point in self.mach_drag_table]
        coefficients = [point[1] for point in self.mach_drag_table]
        if any(not math.isfinite(value) or value < 0.0 for value in mach_values + coefficients):
            raise ValueError("Mach drag values must be finite and nonnegative")
        if any(right <= left for left, right in pairwise(mach_values)):
            raise ValueError("mach_drag_table Mach values must be strictly increasing")
        if not all(math.isfinite(value) for value in self.lift_axis):
            raise ValueError("lift_axis must be finite")
        if (
            self.aerodynamic_lift_coefficient > 0.0
            and math.sqrt(sum(value * value for value in self.lift_axis)) < 1e-12
        ):
            raise ValueError("nonzero lift requires a nonzero lift_axis")
        return self


class PIDConfig(StrictModel):
    """Controller gains and saturation limits."""

    kp: float = 5.0
    ki: float = 0.2
    kd: float = 0.4
    derivative_filter_hz: float = Field(default=12.0, gt=0.0)
    output_limit_radps: float = Field(default=2.0, gt=0.0)
    integral_limit: float = Field(default=0.5, ge=0.0)
    velocity_feedforward: float = 1.0
    acceleration_feedforward: float = 0.0


class AxisConfig(StrictModel):
    """Mechanical and controller settings for one pan or tilt axis."""

    minimum_rad: float
    maximum_rad: float
    home_rad: float = 0.0
    zero_offset_rad: float = 0.0
    direction: Literal[-1, 1] = 1
    scale: float = Field(default=1.0, gt=0.0)
    maximum_velocity_radps: float = Field(default=2.0, gt=0.0)
    maximum_acceleration_radps2: float = Field(default=8.0, gt=0.0)
    maximum_jerk_radps3: float | None = Field(default=40.0, gt=0.0)
    deadband_rad: float = Field(default=0.002, ge=0.0)
    backlash_rad: float = Field(default=0.004, ge=0.0)
    pid: PIDConfig = Field(default_factory=PIDConfig)

    @model_validator(mode="after")
    def validate_limits(self) -> AxisConfig:
        """Validate ordered limits and a home position within them."""
        if self.minimum_rad >= self.maximum_rad:
            raise ValueError("minimum_rad must be below maximum_rad")
        if not self.minimum_rad <= self.home_rad <= self.maximum_rad:
            raise ValueError("home_rad must be within axis limits")
        return self


class PanTiltConfig(StrictModel):
    """Pan and tilt actuator configuration."""

    backend: Literal["simulated", "serial"] = "simulated"
    pan: AxisConfig = Field(
        default_factory=lambda: AxisConfig(minimum_rad=-math.pi, maximum_rad=math.pi)
    )
    tilt: AxisConfig = Field(
        default_factory=lambda: AxisConfig(
            minimum_rad=math.radians(-20), maximum_rad=math.radians(80)
        )
    )
    update_rate_hz: float = Field(default=60.0, gt=0.0)
    serial_port: str | None = None
    serial_baud: int = Field(default=115200, gt=0)
    safe_behavior: Literal["hold", "home"] = "hold"


class AdaptiveCadenceConfig(StrictModel):
    """Bounds and gains for simulated adaptive shot cadence."""

    minimum_interval_s: float = Field(default=0.15, gt=0.0)
    maximum_interval_s: float = Field(default=1.0, gt=0.0)
    angular_velocity_gain: float = Field(default=0.2, ge=0.0)
    uncertainty_gain: float = Field(default=0.4, ge=0.0)
    miss_distance_gain: float = Field(default=0.4, ge=0.0)
    instability_gain: float = Field(default=0.3, ge=0.0)


class SimulatedFireConfig(StrictModel):
    """Permission and cadence settings for simulated shots."""

    alignment_tolerance_rad: float = Field(default=math.radians(1.0), gt=0.0)
    alignment_radius_fraction: float = Field(default=0.5, gt=0.0, le=1.0)
    minimum_tracking_confidence: float = Field(default=0.75, ge=0.0, le=1.0)
    minimum_alignment_confidence: float = Field(default=0.75, ge=0.0, le=1.0)
    minimum_stability: float = Field(default=0.6, ge=0.0, le=1.0)
    maximum_target_age_s: float = Field(default=0.2, gt=0.0)
    cooldown_s: float = Field(default=1.0, ge=0.0)
    burst_interval_s: float = Field(default=0.25, gt=0.0)
    max_burst_count: int = Field(default=3, ge=1)
    hit_tolerance_m: float = Field(default=0.1, gt=0.0)
    adaptive: AdaptiveCadenceConfig = Field(default_factory=AdaptiveCadenceConfig)


class AlignmentWeightConfig(StrictModel):
    """Weights for normalized alignment confidence factors."""

    angular_error: float = Field(default=0.25, ge=0.0)
    covariance: float = Field(default=0.15, ge=0.0)
    detector_confidence: float = Field(default=0.15, ge=0.0)
    miss_distance: float = Field(default=0.15, ge=0.0)
    platform_velocity: float = Field(default=0.1, ge=0.0)
    solver_validity: float = Field(default=0.1, ge=0.0)
    freshness: float = Field(default=0.1, ge=0.0)


class SelectionWeightConfig(StrictModel):
    """Robotics-only target selection weights."""

    confidence: float = 0.25
    stability: float = 0.2
    visibility: float = 0.15
    age: float = 0.1
    distance: float = 0.1
    uncertainty: float = 0.1
    slew: float = 0.1
    switch_margin: float = Field(default=0.12, ge=0.0)


class TargetSimulationConfig(StrictModel):
    """Synthetic target trajectory parameters."""

    trajectory: Literal[
        "stationary",
        "constant_velocity",
        "accelerating",
        "circular",
        "sinusoidal",
        "random_waypoint",
    ] = "circular"
    initial_position_m: tuple[float, float, float] = (8.0, 0.0, 1.0)
    velocity_mps: tuple[float, float, float] = (0.0, 1.5, 0.0)
    acceleration_mps2: tuple[float, float, float] = (0.0, 0.0, 0.0)
    radius_m: float = Field(default=3.0, gt=0.0)
    speed_mps: float = Field(default=1.5, ge=0.0)


class SimulationConfig(StrictModel):
    """Synthetic sensor and world settings."""

    duration_s: float = Field(default=8.0, gt=0.0)
    random_seed: int = 7
    measurement_noise_m: float = Field(default=0.02, ge=0.0)
    dropped_frame_probability: float = Field(default=0.0, ge=0.0, le=1.0)
    camera_latency_s: float = Field(default=0.02, ge=0.0)
    camera_latency_jitter_s: float = Field(default=0.0, ge=0.0)
    capture_timestamp_jitter_s: float = Field(default=0.0, ge=0.0)
    exposure_time_s: float = Field(default=0.001, gt=0.0)
    target_occlusion_probability: float = Field(default=0.0, ge=0.0, le=1.0)
    targets: list[TargetSimulationConfig] = Field(
        default_factory=lambda: [TargetSimulationConfig()]
    )


class TelemetryConfig(StrictModel):
    """Optional local telemetry endpoint settings."""

    enabled: bool = False
    host: str = "127.0.0.1"
    port: int = Field(default=8765, ge=1, le=65535)
    publish_rate_hz: float = Field(default=10.0, gt=0.0)


class LoggingConfig(StrictModel):
    """Structured event logging settings."""

    enabled: bool = True
    path: Path = Path("logs/session.jsonl")


class SystemConfig(StrictModel):
    """Runtime ownership and loop settings."""

    mode: Literal["simulation", "hardware"] = "simulation"
    loop_hz: float = Field(default=60.0, gt=0.0)
    solver_rate_hz: float = Field(default=15.0, gt=0.0)
    bounded_queue_size: int = Field(default=2, ge=1)
    replay_path: Path | None = None


class AppConfig(StrictModel):
    """Complete application configuration."""

    system: SystemConfig = Field(default_factory=SystemConfig)
    camera: CameraConfig = Field(default_factory=CameraConfig)
    target: TargetConfig = Field(default_factory=TargetConfig)
    estimator: EstimatorConfig = Field(default_factory=EstimatorConfig)
    environment: EnvironmentConfig = Field(default_factory=EnvironmentConfig)
    projectile: ProjectileConfig = Field(default_factory=ProjectileConfig)
    pan_tilt: PanTiltConfig = Field(default_factory=PanTiltConfig)
    simulated_fire: SimulatedFireConfig = Field(default_factory=SimulatedFireConfig)
    alignment_weights: AlignmentWeightConfig = Field(default_factory=AlignmentWeightConfig)
    selection_weights: SelectionWeightConfig = Field(default_factory=SelectionWeightConfig)
    simulation: SimulationConfig = Field(default_factory=SimulationConfig)
    telemetry: TelemetryConfig = Field(default_factory=TelemetryConfig)
    logging: LoggingConfig = Field(default_factory=LoggingConfig)


def load_config(path: str | Path) -> AppConfig:
    """Load and validate a YAML configuration file."""
    config_path = Path(path)
    try:
        raw = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    except OSError as exc:
        raise ValueError(f"unable to read configuration: {config_path}") from exc
    if not isinstance(raw, dict):
        raise ValueError("configuration root must be a mapping")
    return AppConfig.model_validate(raw)
