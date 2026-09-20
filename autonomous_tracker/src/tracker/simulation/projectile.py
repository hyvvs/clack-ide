"""Simulation-facing exports for projectile integration and impact evaluation."""

from tracker.ballistics.impact import ImpactEvaluation, evaluate_closest_approach
from tracker.ballistics.integrator import ProjectileTrajectory, integrate_projectile

__all__ = [
    "ImpactEvaluation",
    "ProjectileTrajectory",
    "evaluate_closest_approach",
    "integrate_projectile",
]
