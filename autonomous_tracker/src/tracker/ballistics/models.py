"""Parameters and differential equations for simulated projectiles."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import ArrayLike

from tracker.config import EnvironmentConfig, ProjectileConfig
from tracker.types import FloatArray


@dataclass(frozen=True, slots=True)
class ProjectileModel:
    """Immutable simulated projectile and environment parameters."""

    mass_kg: float
    reference_area_m2: float
    drag_coefficient: float
    air_density_kgpm3: float
    gravity_mps2: FloatArray
    wind_mps: FloatArray
    drag_enabled: bool = True
    drag_model: str = "constant"
    speed_of_sound_mps: float = 343.0
    mach_drag_table: tuple[tuple[float, float], ...] = ((0.0, 0.45), (3.0, 0.45))
    aerodynamic_lift_coefficient: float = 0.0
    lift_axis: tuple[float, float, float] = (0.0, 0.0, 1.0)

    def __post_init__(self) -> None:
        if self.mass_kg <= 0.0 or self.reference_area_m2 <= 0.0:
            raise ValueError("simulated projectile mass and area must be positive")
        if self.drag_coefficient < 0.0 or self.air_density_kgpm3 < 0.0:
            raise ValueError("drag coefficient and air density cannot be negative")
        if self.drag_model not in {"constant", "mach_curve"}:
            raise ValueError("unsupported projectile drag model")
        if self.speed_of_sound_mps <= 0.0:
            raise ValueError("speed of sound must be positive")
        gravity = np.asarray(self.gravity_mps2, dtype=np.float64).reshape(-1)
        wind = np.asarray(self.wind_mps, dtype=np.float64).reshape(-1)
        if gravity.shape != (3,) or wind.shape != (3,):
            raise ValueError("gravity and wind must contain three values")
        if not np.all(np.isfinite(gravity)) or not np.all(np.isfinite(wind)):
            raise ValueError("gravity and wind must be finite")
        object.__setattr__(self, "gravity_mps2", gravity.copy())
        object.__setattr__(self, "wind_mps", wind.copy())
        lift_axis = np.asarray(self.lift_axis, dtype=np.float64)
        if lift_axis.shape != (3,) or not np.all(np.isfinite(lift_axis)):
            raise ValueError("lift axis must contain three finite values")
        if self.aerodynamic_lift_coefficient > 0.0:
            magnitude = float(np.linalg.norm(lift_axis))
            if magnitude <= 1e-12:
                raise ValueError("nonzero lift requires a nonzero lift axis")
            object.__setattr__(
                self, "lift_axis", tuple(float(value) for value in lift_axis / magnitude)
            )

    @classmethod
    def from_config(
        cls, projectile: ProjectileConfig, environment: EnvironmentConfig
    ) -> ProjectileModel:
        """Build a model from validated application configuration."""
        return cls(
            projectile.mass_kg,
            projectile.reference_area_m2,
            projectile.drag_coefficient,
            environment.air_density_kgpm3,
            np.asarray(environment.gravity_mps2, dtype=np.float64),
            np.asarray(environment.wind_mps, dtype=np.float64),
            projectile.enable_drag,
            projectile.drag_model,
            projectile.speed_of_sound_mps,
            tuple(projectile.mach_drag_table),
            projectile.aerodynamic_lift_coefficient,
            projectile.lift_axis,
        )

    def drag_coefficient_at_speed(self, speed_mps: float) -> float:
        """Return constant or linearly interpolated Mach-dependent drag coefficient."""
        if self.drag_model == "constant":
            return self.drag_coefficient
        mach = speed_mps / self.speed_of_sound_mps
        mach_values = np.asarray([point[0] for point in self.mach_drag_table])
        coefficients = np.asarray([point[1] for point in self.mach_drag_table])
        return float(np.interp(mach, mach_values, coefficients))

    def acceleration(self, velocity_mps: ArrayLike) -> FloatArray:
        """Return gravity plus optional quadratic-drag acceleration."""
        velocity = np.asarray(velocity_mps, dtype=np.float64)
        acceleration = self.gravity_mps2.copy()
        relative = velocity - self.wind_mps
        speed = float(np.linalg.norm(relative))
        if speed <= 1e-12:
            return acceleration
        if self.drag_enabled:
            factor = (
                -0.5
                * self.air_density_kgpm3
                * self.drag_coefficient_at_speed(speed)
                * self.reference_area_m2
                / self.mass_kg
            )
            acceleration += factor * speed * relative
        if self.aerodynamic_lift_coefficient > 0.0:
            lift_direction = np.cross(np.asarray(self.lift_axis), relative)
            lift_norm = float(np.linalg.norm(lift_direction))
            if lift_norm > 1e-12:
                lift_acceleration = (
                    0.5
                    * self.air_density_kgpm3
                    * self.aerodynamic_lift_coefficient
                    * self.reference_area_m2
                    * speed**2
                    / self.mass_kg
                )
                acceleration += lift_acceleration * lift_direction / lift_norm
        return acceleration
