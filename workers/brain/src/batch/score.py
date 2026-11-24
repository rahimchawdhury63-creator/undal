"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The batch score (`12 §6`): is this bundle actually better than running the two orders separately?

Feasibility is binary and answers "may we". The score answers "should we", and it is the number that
feeds dispatch factor 9. Below `0.45` the saving does not justify the added complexity and risk, and
the orders run separately — a decision that costs a little efficiency and protects the thing that is
hard to rebuild, which is a rider's belief that a bundle will not make their evening worse.
"""

from __future__ import annotations

from dataclasses import dataclass

from batch.constraints import BATCH_SCORE_MIN, MAX_DETOUR_S, READY_WINDOW_S, ZonePressure

#: The five weights of `12 §6`. They sum to 1.0, and the test suite asserts it.
WEIGHTS = {
    "efficiency": 0.32,
    "detour_quality": 0.26,
    "ready_sync": 0.18,
    "rider_fit": 0.14,
    "pressure": 0.10,
}


@dataclass(frozen=True)
class ScoreInput:
    """The five measurements a score is made of, each already in `[0, 1]` except where noted."""

    solo_total_m: int
    bundle_total_m: int
    max_detour_s: float
    ready_window_s: float
    batch_success_rate: float
    zone: ZonePressure


@dataclass(frozen=True)
class ScoreBreakdown:
    """The terms, their weights, and the total — everything the admin panel needs to argue with."""

    terms: dict[str, float]
    total: float

    @property
    def offered(self) -> bool:
        return self.total >= BATCH_SCORE_MIN


def batch_score(measurements: ScoreInput) -> ScoreBreakdown:
    """Compute the five terms and the weighted total, clamped into `[0, 1]`."""
    if measurements.solo_total_m < 0 or measurements.bundle_total_m < 0:
        raise ValueError("distances cannot be negative")
    if measurements.max_detour_s < 0:
        raise ValueError("a detour cannot be negative")

    efficiency = (measurements.solo_total_m - measurements.bundle_total_m) / max(measurements.solo_total_m, 1)
    detour_quality = 1.0 - (measurements.max_detour_s / MAX_DETOUR_S)
    ready_sync = 1.0 - (measurements.ready_window_s / READY_WINDOW_S)
    rider_fit = measurements.batch_success_rate
    pressure = min(1.0, measurements.zone.active_orders / max(measurements.zone.active_riders, 1) / 2.0)

    terms = {
        # Efficiency is the only term that may be negative in principle: a "bundle" longer than the
        # two solo trips is a worse idea than not bundling, and the score should say so plainly.
        "efficiency": efficiency,
        "detour_quality": max(0.0, min(1.0, detour_quality)),
        "ready_sync": max(0.0, min(1.0, ready_sync)),
        "rider_fit": max(0.0, min(1.0, rider_fit)),
        "pressure": max(0.0, min(1.0, pressure)),
    }
    total = sum(WEIGHTS[name] * value for name, value in terms.items())
    return ScoreBreakdown(terms=terms, total=max(0.0, min(1.0, total)))
