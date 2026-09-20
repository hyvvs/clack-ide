"""Centralized permissions and simulation-only shot generation."""

from __future__ import annotations

import asyncio
import math
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import numpy as np

from tracker.ballistics.impact import ImpactEvaluation
from tracker.config import AdaptiveCadenceConfig, SimulatedFireConfig
from tracker.state_machine import SystemState
from tracker.types import (
    AlignmentMetrics,
    BallisticSolution,
    ShotMode,
    SimulatedShot,
    SystemHealth,
)


@dataclass(frozen=True, slots=True)
class PermissionContext:
    """All inputs required to authorize one simulated shot."""

    system_state: SystemState
    tracking_confidence: float
    alignment: AlignmentMetrics
    solution: BallisticSolution | None
    target_age_s: float
    cooldown_complete: bool
    health: SystemHealth
    stability: float = 1.0
    alignment_tolerance_rad: float | None = None


@dataclass(frozen=True, slots=True)
class PermissionResult:
    """Detailed centralized simulated-shot permission decision."""

    allowed: bool
    rejection_reasons: tuple[str, ...]


def can_simulate_fire(context: PermissionContext, config: SimulatedFireConfig) -> PermissionResult:
    """Evaluate every required condition for a software-only projectile event."""
    reasons: list[str] = []
    if context.system_state != SystemState.READY:
        reasons.append("system_not_ready")
    if context.tracking_confidence < config.minimum_tracking_confidence:
        reasons.append("tracking_confidence_low")
    alignment_tolerance = (
        config.alignment_tolerance_rad
        if context.alignment_tolerance_rad is None
        else min(config.alignment_tolerance_rad, context.alignment_tolerance_rad)
    )
    if context.alignment.total_error_rad > alignment_tolerance:
        reasons.append("alignment_error_high")
    if context.alignment.confidence < config.minimum_alignment_confidence:
        reasons.append("alignment_confidence_low")
    if context.stability < config.minimum_stability:
        reasons.append("platform_unstable")
    if context.solution is None or not context.solution.valid:
        reasons.append("ballistic_solution_invalid")
    if context.target_age_s > config.maximum_target_age_s:
        reasons.append("target_state_stale")
    if not context.cooldown_complete:
        reasons.append("cooldown_active")
    if not context.health.healthy:
        reasons.append("system_health_fault")
    return PermissionResult(not reasons, tuple(reasons))


class SimulatedLauncher:
    """Record software-only projectile impacts with an internal cooldown.

    This class has no hardware handle, serial object, GPIO object, or callback that can
    actuate anything. Its only output is an immutable SimulatedShot data record.
    """

    def __init__(
        self,
        cooldown_s: float,
        hit_tolerance_m: float,
        clock_ns: Callable[[], int] = time.monotonic_ns,
    ) -> None:
        self._cooldown_ns = int(cooldown_s * 1e9)
        self._hit_tolerance_m = hit_tolerance_m
        self._clock_ns = clock_ns
        self._last_shot_ns: int | None = None
        self._shots: list[SimulatedShot] = []
        self.mode = ShotMode.SINGLE

    @property
    def shots(self) -> tuple[SimulatedShot, ...]:
        """Return all generated simulated shot records."""
        return tuple(self._shots)

    def cooldown_complete(self, minimum_interval_s: float | None = None) -> bool:
        """Return whether the internal simulated-shot cooldown has elapsed."""
        now = self._clock_ns()
        required_ns = (
            self._cooldown_ns
            if minimum_interval_s is None
            else int(max(0.0, minimum_interval_s) * 1e9)
        )
        return self._last_shot_ns is None or now - self._last_shot_ns >= required_ns

    def fire(
        self,
        solution: BallisticSolution,
        minimum_interval_s: float | None = None,
        impact: ImpactEvaluation | None = None,
    ) -> SimulatedShot:
        """Create one software-only impact record from a valid solution and optional truth."""
        if not solution.valid:
            raise ValueError("cannot simulate a shot from an invalid solution")
        now = self._clock_ns()
        required_ns = (
            self._cooldown_ns
            if minimum_interval_s is None
            else int(max(0.0, minimum_interval_s) * 1e9)
        )
        if self._last_shot_ns is not None and now - self._last_shot_ns < required_ns:
            raise RuntimeError("simulated launcher cooldown is active")
        if impact is None:
            miss = float(
                np.linalg.norm(
                    solution.predicted_impact_position.as_array()
                    - solution.predicted_target_position.as_array()
                )
            )
            impact_position = solution.predicted_impact_position
            target_position = solution.predicted_target_position
            hit = miss <= self._hit_tolerance_m
        else:
            miss = impact.center_distance_m
            impact_position = impact.projectile_position
            target_position = impact.target_position
            hit = impact.collided
        shot = SimulatedShot(
            len(self._shots) + 1,
            now,
            solution,
            impact_position,
            target_position,
            miss,
            hit,
            self.mode,
        )
        self._shots.append(shot)
        self._last_shot_ns = now
        return shot


async def simulate_burst(
    launcher: SimulatedLauncher,
    config: SimulatedFireConfig,
    context_provider: Callable[[], PermissionContext],
    solution_provider: Callable[[], BallisticSolution | None],
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> list[SimulatedShot]:
    """Generate a bounded burst, revalidating every simulated shot."""
    shots: list[SimulatedShot] = []
    launcher.mode = ShotMode.BURST
    for index in range(config.max_burst_count):
        context = context_provider()
        solution = solution_provider()
        context = PermissionContext(
            context.system_state,
            context.tracking_confidence,
            context.alignment,
            solution,
            context.target_age_s,
            launcher.cooldown_complete(config.burst_interval_s),
            context.health,
            context.stability,
            context.alignment_tolerance_rad,
        )
        if not can_simulate_fire(context, config).allowed or solution is None:
            break
        shots.append(launcher.fire(solution, config.burst_interval_s))
        if index + 1 < config.max_burst_count:
            await sleep(config.burst_interval_s)
    return shots


def adaptive_interval_s(
    target_angular_velocity_radps: float,
    estimator_confidence: float,
    predicted_miss_distance_m: float,
    platform_stability: float,
    config: AdaptiveCadenceConfig,
) -> float:
    """Return a slower interval as uncertainty, miss, or instability increases.

    Angular motion adds a small urgency term that shortens the interval. Uncertainty,
    predicted miss, and instability lengthen it because poor estimates should not produce
    rapid simulated events.
    """
    uncertainty = 1.0 - float(np.clip(estimator_confidence, 0.0, 1.0))
    instability = 1.0 - float(np.clip(platform_stability, 0.0, 1.0))
    span = config.maximum_interval_s - config.minimum_interval_s
    normalized = (
        config.uncertainty_gain * uncertainty
        + config.miss_distance_gain * min(1.0, max(0.0, predicted_miss_distance_m) / 0.2)
        + config.instability_gain * instability
        - config.angular_velocity_gain * min(1.0, abs(target_angular_velocity_radps) / math.pi)
    )
    return float(
        np.clip(
            config.minimum_interval_s + span * normalized,
            config.minimum_interval_s,
            config.maximum_interval_s,
        )
    )
