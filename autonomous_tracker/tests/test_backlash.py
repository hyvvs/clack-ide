from tracker.control.backlash import BacklashCompensator


def test_backlash_compensation() -> None:
    compensator = BacklashCompensator(backlash_rad=0.05, deadband_rad=0.001)
    assert compensator.compensate(0.0, 1.0) == 1.0
    compensated = compensator.compensate(1.0, 0.5)
    assert compensated == 0.45
