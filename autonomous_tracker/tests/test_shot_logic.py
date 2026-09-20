import asyncio

import pytest

from tracker.autonomy.shot_logic import (
    PermissionContext,
    SimulatedLauncher,
    can_simulate_fire,
    simulate_burst,
)
from tracker.ballistics.impact import ImpactEvaluation
from tracker.config import SimulatedFireConfig
from tracker.state_machine import SystemState
from tracker.types import (
    AlignmentMetrics,
    BallisticSolution,
    SystemHealth,
    Vector3,
)


def valid_solution() -> BallisticSolution:
    target = Vector3(5.0, 0.0, 1.0)
    impact = Vector3(5.01, 0.0, 1.0)
    return BallisticSolution(True, 0.0, 0.1, 0.3, target, impact, 0.01, 4, 0.9, "test")


def test_permission_returns_detailed_reasons() -> None:
    config = SimulatedFireConfig()
    context = PermissionContext(
        SystemState.TRACKING,
        0.1,
        AlignmentMetrics(1.0, 1.0, 1.4, 0.1),
        None,
        1.0,
        False,
        SystemHealth(False),
        0.1,
    )
    result = can_simulate_fire(context, config)
    assert not result.allowed
    assert "system_not_ready" in result.rejection_reasons
    assert "ballistic_solution_invalid" in result.rejection_reasons


def test_simulated_burst_cooldown() -> None:
    now = 1_000_000_000

    def clock() -> int:
        return now

    launcher = SimulatedLauncher(1.0, 0.1, clock)
    shot = launcher.fire(valid_solution())
    assert shot.hit
    with pytest.raises(RuntimeError):
        launcher.fire(valid_solution())


def test_simulated_launcher_records_independent_truth_impact() -> None:
    launcher = SimulatedLauncher(0.1, 0.1, lambda: 1_000_000_000)
    impact = ImpactEvaluation(
        0.3,
        Vector3(5.0, 0.5, 1.0),
        Vector3(5.0, 0.0, 1.0),
        0.5,
        0.4,
        False,
    )

    shot = launcher.fire(valid_solution(), impact=impact)

    assert not shot.hit
    assert shot.miss_distance_m == pytest.approx(0.5)
    assert shot.impact_position == impact.projectile_position


def test_permission_can_apply_tighter_range_aware_alignment() -> None:
    solution = valid_solution()
    alignment = AlignmentMetrics(0.005, 0.0, 0.005, 1.0)
    context = PermissionContext(
        SystemState.READY,
        1.0,
        alignment,
        solution,
        0.0,
        True,
        SystemHealth(True),
        1.0,
        0.001,
    )

    result = can_simulate_fire(context, SimulatedFireConfig(alignment_tolerance_rad=0.01))

    assert not result.allowed
    assert "alignment_error_high" in result.rejection_reasons


def test_burst_revalidates_and_uses_burst_interval() -> None:
    now = 0

    def clock() -> int:
        return now

    async def sleep(interval_s: float) -> None:
        nonlocal now
        now += int(interval_s * 1e9)

    solution = valid_solution()
    config = SimulatedFireConfig(
        cooldown_s=1.0,
        burst_interval_s=0.2,
        max_burst_count=3,
    )
    alignment = AlignmentMetrics(0.0, 0.0, 0.0, 1.0)

    def context() -> PermissionContext:
        return PermissionContext(
            SystemState.READY,
            1.0,
            alignment,
            solution,
            0.0,
            True,
            SystemHealth(True),
            1.0,
        )

    launcher = SimulatedLauncher(config.cooldown_s, 0.1, clock)
    shots = asyncio.run(simulate_burst(launcher, config, context, lambda: solution, sleep))
    assert len(shots) == 3
    assert not launcher.cooldown_complete()
