from tracker.control.pid import PIDController


def test_pid_saturation() -> None:
    pid = PIDController(10.0, 0.0, 0.0, output_limits=(-1.0, 1.0))
    assert pid.update(2.0, 0.01) == 1.0
    assert pid.update(-2.0, 0.01) == -1.0


def test_pid_anti_windup() -> None:
    pid = PIDController(
        2.0,
        4.0,
        0.0,
        output_limits=(-1.0, 1.0),
        integral_limits=(-10.0, 10.0),
    )
    for _ in range(100):
        pid.update(1.0, 0.01)
    output = pid.update(-0.1, 0.01)
    assert output < 0.0


def test_bumpless_restart() -> None:
    pid = PIDController(2.0, 1.0, 0.0, output_limits=(-5.0, 5.0))
    pid.restart_bumpless(error=0.5, desired_output=2.0)
    assert abs(pid.update(0.5, 0.001) - 2.0) < 0.01
