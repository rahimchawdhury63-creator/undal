"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Choosing the drop order (`12 §4.2`).

Two orders have two orderings and three have six, so the engine can afford to be honest and evaluate
every one of them. The cost function squares each detour:

    cost = Σ detour(X)² + λ × total_route_m

The square is the point. One customer waiting seven minutes is much worse than two waiting three and a
half each, and a linear sum cannot tell those apart — it would happily concentrate the delay on
whoever is furthest along the route. This is the same fairness argument as the dispatch factor, applied
one level down.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import permutations

from batch.constraints import MAX_BUNDLE_ORDERS, MAX_PERMUTATIONS, ROUTE_PENALTY_PER_M, BundleOrder, Legs, RiderFacts
from batch.feasibility import Timings, evaluate_order


@dataclass(frozen=True)
class BestOrdering:
    """The chosen order of drops, its cost, and the timings it produces."""

    order_ids: tuple[str, ...]
    cost: float
    timings: Timings


def cost_of(timings: Timings) -> float:
    """`Σ detour² + λ × metres` — the document's cost, in seconds-squared plus metres."""
    return sum(detour * detour for detour in timings.detours.values()) + ROUTE_PENALTY_PER_M * timings.total_route_m


def best_ordering(orders: list[BundleOrder], legs: Legs, rider: RiderFacts) -> BestOrdering:
    """Evaluate every ordering and return the cheapest.

    Ties break on the order ids in sequence, lexicographically, for the same reason dispatch's ties
    do: a replay must reproduce the choice, and "whichever the sort happened to put first" is not a
    decision anybody can audit.
    """
    if not 2 <= len(orders) <= MAX_BUNDLE_ORDERS:
        raise ValueError(f"a bundle holds 2..{MAX_BUNDLE_ORDERS} orders, got {len(orders)}")

    candidates = list(permutations(orders))
    if len(candidates) > MAX_PERMUTATIONS:
        raise ValueError("refusing to brute-force more than six orderings")

    best: BestOrdering | None = None
    for ordering in candidates:
        seq = list(ordering)
        timings = evaluate_order(seq, legs, rider.handover_s)
        candidate = BestOrdering(
            order_ids=tuple(order.order_id for order in seq),
            cost=cost_of(timings),
            timings=timings,
        )
        if best is None or (candidate.cost, candidate.order_ids) < (best.cost, best.order_ids):
            best = candidate

    assert best is not None  # the range check above guarantees at least one ordering
    return best
