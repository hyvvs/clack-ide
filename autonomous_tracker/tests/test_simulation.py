import copy

from tracker.config import AppConfig, TargetSimulationConfig
from tracker.simulation.world import SimulationWorld


def scenario(trajectory: str) -> AppConfig:
    config = AppConfig()
    config.camera.width = 320
    config.camera.height = 240
    config.camera.fps = 30.0
    config.system.loop_hz = 30.0
    config.simulation.duration_s = 2.0
    config.simulation.measurement_noise_m = 0.005
    config.projectile.enable_drag = False
    config.projectile.integration_timestep_s = 0.01
    target = TargetSimulationConfig.model_validate(
        {
            "trajectory": trajectory,
            "initial_position_m": [6.0, 0.0, 1.0],
            "velocity_mps": [0.0, 0.5, 0.0],
            "acceleration_mps2": [0.0, 0.1, 0.0],
            "radius_m": 0.5,
            "speed_mps": 0.5,
        }
    )
    config.simulation.targets = [target]
    return config


def test_end_to_end_constant_velocity_intercept() -> None:
    result = SimulationWorld(scenario("constant_velocity")).run()
    assert result.selected_track_id == 1
    assert result.solution is not None
    assert (
        result.solution.predicted_target_position.y
        > result.solution.predicted_impact_position.y - 0.1
    )
    assert result.summary["solver_success_rate"] > 0.8
    assert result.summary["tracking_rms_error_m"] < 0.1


def test_validation_scenarios_produce_solutions() -> None:
    for trajectory in ("stationary", "accelerating", "circular"):
        result = SimulationWorld(copy.deepcopy(scenario(trajectory))).run()
        assert result.solution is not None, trajectory
        assert result.summary["solver_success_rate"] > 0.5, trajectory
