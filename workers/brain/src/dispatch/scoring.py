"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Scoring a candidate, and explaining the rank (`11 §5.3`, `§6`).

One pass, no allocation inside the loop, fully deterministic. The tie-breaks exist because a replay
test asserts equality: two riders with the same score must be ordered the same way every time, or the
"why did B get it and not A" question has no answer that survives a second run. Ties break on higher
acceptance first, then on the rider id — arbitrary, but stable, which is the only property that
matters.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from dispatch import factors as f
from dispatch.filters import Candidate, OrderContext


@dataclass(frozen=True)
class Scored:
    """A candidate, their weighted total, and each factor that produced it."""

    rider_id: str
    total: float
    factors: tuple[float, ...]

    def factor(self, name: str) -> float:
        return self.factors[f.FACTORS.index(name)]


@dataclass(frozen=True)
class ZoneFeatures:
    """The per-zone context a score depends on, resolved once per dispatch rather than per rider."""

    median_pickup_m: float = 1_100.0
    median_deliveries_today: float = 6.0
    riders_in_drop_cell: float = 3.0
    forecast_drop_cell: float = 3.0


@dataclass(frozen=True)
class RiderHistory:
    """The per-rider facts the factors need beyond the candidate row itself."""

    completion_rate: float = 0.95
    on_time_rate: float = 0.9
    rating_positives: int = 0
    rating_total: int = 0
    deliveries_from_vendor: int = 0
    deliveries_into_cell: int = 0
    idle_s: int = 0
    deliveries_today: int = 0
    acceptance_probability: float = 0.5
    batch_feasibility: float | None = None
    eta_to_vendor_s: int = 300


def score_candidates(
    order: OrderContext,
    candidates: list[Candidate],
    weights: f.Weights,
    zone: ZoneFeatures,
    histories: Mapping[str, RiderHistory],
    ready_in_s: int = 540,
) -> list[Scored]:
    """Score every surviving candidate and return them best-first."""
    scored: list[Scored] = []
    for candidate in candidates:
        history = histories.get(candidate.rider_id, RiderHistory())
        values = (
            f.proximity(candidate.routed_to_vendor_m, zone.median_pickup_m),
            f.eta_fit(history.eta_to_vendor_s, ready_in_s),
            f.acceptance(history.acceptance_probability),
            f.reliability(history.completion_rate, history.on_time_rate),
            f.fairness(history.idle_s, history.deliveries_today, zone.median_deliveries_today),
            f.wilson_lower(history.rating_positives, history.rating_total),
            f.vendor_familiarity(history.deliveries_from_vendor),
            f.area_familiarity(history.deliveries_into_cell),
            f.batch_fit(history.batch_feasibility),
            f.load_balance(candidate.current_load, candidate.max_concurrent),
            f.cash_headroom(candidate.cash_in_hand_paisa, order.total_paisa, candidate.cash_limit_paisa),
            f.zone_coverage(zone.riders_in_drop_cell, zone.forecast_drop_cell),
            f.freshness(candidate.fix_age_s, candidate.stale_after_s),
            f.vehicle_fit(candidate.vehicle, candidate.routed_to_vendor_m, candidate.vehicle_max_radius_m),
        )
        total = sum(weights[name] * value for name, value in zip(f.FACTORS, values))
        scored.append(Scored(rider_id=candidate.rider_id, total=total, factors=values))

    # Higher total first; then higher acceptance; then the rider id, so the order is total.
    scored.sort(key=lambda entry: (-entry.total, -entry.factor("acceptance"), entry.rider_id))
    return scored


def explain_row(scored: Scored, weights: f.Weights) -> dict[str, float | str]:
    """One row of the admin panel's stacked bar: the weighted contribution of each factor.

    The panel shows contributions rather than raw factor values because the question an operator asks
    is "why did this rider win", and the answer is in the weighted column — a factor of 1.0 with a
    weight of 0.01 did not decide anything.
    """
    return {"riderId": scored.rider_id, "total": scored.total, **_contributions(scored, weights)}


def _contributions(scored: Scored, weights: f.Weights) -> dict[str, float]:
    return {name: weights[name] * value for name, value in zip(f.FACTORS, scored.factors)}
