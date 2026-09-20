"""Simulation-only projectile models and interception solvers."""

from tracker.ballistics.models import ProjectileModel
from tracker.ballistics.solver import SolverConstraints, solve_intercept

__all__ = ["ProjectileModel", "SolverConstraints", "solve_intercept"]
