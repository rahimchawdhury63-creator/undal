"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Feasibility: the ten constraints of `12 §4`, evaluated for one ordering of one bundle.

The detour arithmetic is the document's, term for term:

    solo_eta(X)   = ready_at(X) + travel(vendor → drop_X)
    bundle_eta(A) = ready_at(latest in bundle) + travel(vendor → drop_A)
    bundle_eta(B) = bundle_eta(A) + handover + travel(drop_A → drop_B)
    detour(X)     = bundle_eta(X) − solo_eta(X)

Note that the second order's detour carries the *whole* of the first order's handover, because that is
where the time actually goes. A model that priced the hop and forgot the doorstep would promise seven
minutes and deliver eleven, which is how bundling gets a reputation.

`C3` is the constraint that makes this defensible at all: the customer was promised an ETA range at
checkout, and a bundle may spend the slack inside it and not one second more.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import permutations

from batch.constraints import (
    CAPACITY,
    UNBUNDLEABLE_STATES,
    MAX_BUNDLE_ORDERS,
    MAX_BUNDLE_SPAN_M,
    MAX_DETOUR_S,
    MAX_LEG_M,
    MAX_PERMUTATIONS,
    READY_WINDOW_S,
    TEMPERATURE_DETOUR_S,
    BundleOrder,
    ConstraintReport,
    Legs,
    RiderFacts,
    clamp_handover,
)


@dataclass(frozen=True)
class Timings:
    """The four numbers a bundle evaluation turns on, for one ordering."""

    detours: dict[str, int]
    bundle_eta: dict[str, int]
    total_route_m: int
    handover_s: int

    @property
    def worst_detour_s(self) -> int:
        return max(self.detours.values(), default=0)


def _latest_ready(orders: list[BundleOrder]) -> int:
    return max(order.ready_at_s for order in orders)


def evaluate_order(orders: list[BundleOrder], legs: Legs, handover_s: int) -> Timings:
    """Compute the detours and ETAs for one ordering of a bundle.

    The first order's ETA starts at the *latest* ready time in the bundle, because the rider must not
    leave before the last bag is bagged; the rest of the sequence adds a handover and a hop each.
    """
    if not 2 <= len(orders) <= MAX_BUNDLE_ORDERS:
        raise ValueError(f"a bundle holds 2..{MAX_BUNDLE_ORDERS} orders, got {len(orders)}")
    handover = clamp_handover(handover_s)
    start = _latest_ready(orders)

    detours: dict[str, int] = {}
    bundle_eta: dict[str, int] = {}
    previous: str | None = None
    eta = 0
    total_route_m = 0
    for order in orders:
        hop = legs.to_drop(order.order_id) if previous is None else legs.between_drops(previous, order.order_id)
        eta = start + legs.to_drop(order.order_id) if previous is None else eta + handover + hop
        solo = order.ready_at_s + legs.to_drop(order.order_id)
        detours[order.order_id] = eta - solo
        bundle_eta[order.order_id] = eta
        total_route_m += hop
        previous = order.order_id

    return Timings(detours=detours, bundle_eta=bundle_eta, total_route_m=total_route_m, handover_s=handover)


def evaluate(
    orders: list[BundleOrder],
    legs: Legs,
    rider: RiderFacts,
    unrelated_state: bool = False,
) -> ConstraintReport:
    """Evaluate C1–C10 for one ordering.

    Every verdict is `True`, `False`, or `None` when the constraint does not apply to this bundle —
    `C2` is `None` when nothing in the bundle is fragile, which is different from "passed".
    """
    timings = evaluate_order(orders, legs, rider.handover_s)
    verdicts: dict[str, bool | None] = {}

    verdicts["C1"] = timings.worst_detour_s <= MAX_DETOUR_S

    fragile = [order for order in orders if order.fragile]
    if fragile:
        # The budget is tightened for the fragile order itself, not for the bundle as a whole: the
        # customer with the ice cream is the one who pays for a detour.
        verdicts["C2"] = all(timings.detours[order.order_id] <= TEMPERATURE_DETOUR_S for order in fragile)
    else:
        verdicts["C2"] = None

    verdicts["C3"] = all(timings.bundle_eta[order.order_id] <= order.promised_eta_max_s for order in orders)

    ready_times = [order.ready_at_s for order in orders]
    verdicts["C4"] = (max(ready_times) - min(ready_times)) <= READY_WINDOW_S

    max_leg = MAX_LEG_M.get(rider.vehicle)
    if max_leg is None:
        raise ValueError(f"unknown vehicle {rider.vehicle!r}")
    hops = [
        legs.between_drops(orders[index].order_id, orders[index + 1].order_id)
        for index in range(len(orders) - 1)
    ]
    verdicts["C5"] = all(hop <= max_leg for hop in hops)

    verdicts["C6"] = timings.total_route_m <= MAX_BUNDLE_SPAN_M[rider.vehicle]

    # A fragile item costs one bag of capacity, because it cannot be stacked under anything.
    effective_capacity = CAPACITY[rider.vehicle] - sum(1 for order in orders if order.fragile)
    verdicts["C7"] = sum(order.item_count for order in orders) <= effective_capacity

    verdicts["C8"] = rider.cash_in_hand_paisa + sum(order.total_paisa for order in orders) <= rider.cash_limit_paisa

    verdicts["C9"] = not unrelated_state and all(order.state not in UNBUNDLEABLE_STATES for order in orders)

    verdicts["C10"] = rider.payout_paisa >= sum(order.min_payout_paisa for order in orders)

    return ConstraintReport(verdicts=verdicts)


def feasible_orderings(orders: list[BundleOrder], legs: Legs, rider: RiderFacts) -> list[tuple[BundleOrder, ...]]:
    """Every ordering that satisfies all ten constraints, at most six of them.

    All orderings are evaluated rather than a greedy first choice, because the cheapest-looking
    ordering is often the one that breaks `C3` for the second customer.
    """
    if len(orders) > MAX_BUNDLE_ORDERS:
        raise ValueError(f"a bundle holds at most {MAX_BUNDLE_ORDERS} orders")
    candidates = list(permutations(orders))
    if len(candidates) > MAX_PERMUTATIONS:
        raise ValueError("refusing to brute-force more than six orderings")
    return [ordering for ordering in candidates if evaluate(list(ordering), legs, rider).feasible]
