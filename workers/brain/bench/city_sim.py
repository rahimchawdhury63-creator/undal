"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The dispatch benchmark's simulation: a generated city, two policies, and every order's fate.

`world.py` builds the days; this module spends them. Each policy sees the same orders, the same riders
and the same seeds — only the ranking differs, plus the expansion ladder and same-vendor batching,
which the nearest-rider policy does not do. The engine under test is the real one: `filter_candidates`,
`score_candidates`, `size_waves` and `batch_score` all come from `src/`.

What is modelled rather than real: travel is distance over speed, acceptance is a per-rider propensity
that moves as offers are answered, and a rider who frees up within fifteen minutes is a candidate —
dispatch assigned the order and the rider starts when they are free. Those are the benchmark's
assumptions, stated here so the report's numbers can be argued with.
"""

from __future__ import annotations

import random
import statistics
from dataclasses import dataclass, field, replace

from batch.constraints import ZonePressure
from batch.score import ScoreInput, batch_score
from dispatch import (
    DEFAULT_WEIGHTS,
    Candidate,
    OrderContext,
    filter_candidates,
    relax_candidates,
    score_candidates,
    size_waves,
)
from dispatch.scoring import RiderHistory, ZoneFeatures
from dispatch.waves import MAX_WAVES, WAVE_SCHEDULE, Wave
from bench.world import (
    DAY_END_S,
    SEED,
    HANDOVER_S,
    Day,
    OrderSpec,
    RiderProfile,
    VendorProfile,
    payout_paisa,
    routed_metres,
)

#: The policies the benchmark compares.
UNDAL = "undal"
NEAREST = "nearest"
POLICIES = (UNDAL, NEAREST)


def gini(values: list[float]) -> float:
    """The Gini coefficient of a distribution. Zero means everyone earned the same."""
    if not values:
        return 0.0
    total = sum(values)
    if total <= 0:
        return 0.0
    ordered = sorted(values)
    count = len(ordered)
    cumulative = sum((index + 1) * value for index, value in enumerate(ordered))
    return (2 * cumulative) / (count * total) - (count + 1) / count


@dataclass
class RiderState:
    """A rider's mutable state during a day — position, load, earnings and current propensity."""

    profile: RiderProfile
    at: Point
    free_at_s: int
    load: int = 0
    deliveries: int = 0
    earnings_paisa: int = 0
    idle_since_s: int = 0
    acceptance: float = 0.5
    vendor_visits: dict[str, int] = field(default_factory=dict)


@dataclass(frozen=True)
class Delivery:
    """The outcome of one order, whether or not it found a rider."""

    order_id: str
    assigned: bool
    rider_id: str | None
    offers: int
    time_to_assignment_s: int | None
    delivered_at_s: int | None
    rider_wait_s: int | None
    customer_wait_s: int | None
    batched: bool
    on_time: bool | None
    payout_paisa: int
    ladder_offers: int = 0


@dataclass
class Tally:
    """Running totals. Aggregation lives here so a day result is plain data."""

    orders: int = 0
    assigned: int = 0
    offers: int = 0
    acceptances: int = 0
    assignment_time_s: int = 0
    rider_wait_s: int = 0
    customer_wait_s: int = 0
    on_time: int = 0
    batched: int = 0
    deliveries: int = 0
    ladder_offers: int = 0
    gini_sum: float = 0.0
    gini_days: int = 0
    rider_hours: float = 0.0

    def add(self, delivery: Delivery) -> None:
        """Fold one delivery into the totals."""
        self.orders += 1
        self.offers += delivery.offers
        self.ladder_offers += delivery.ladder_offers
        if not delivery.assigned:
            return
        self.assigned += 1
        self.acceptances += 1 if delivery.offers > 0 else 0
        self.assignment_time_s += delivery.time_to_assignment_s or 0
        self.rider_wait_s += delivery.rider_wait_s or 0
        self.customer_wait_s += delivery.customer_wait_s or 0
        self.on_time += 1 if delivery.on_time else 0
        self.batched += 1 if delivery.batched else 0
        self.deliveries += 1


def _candidate(state: RiderState, profile: RiderProfile, vendor: VendorProfile, order: OrderSpec) -> Candidate:
    travel_m = routed_metres(state.at, vendor.point)
    return Candidate(
        rider_id=profile.rider_id,
        vehicle=profile.vehicle,
        vehicle_max_radius_m=4_000 if profile.vehicle == "BICYCLE" else 12_000,
        routed_to_vendor_m=travel_m,
        max_concurrent=1 if profile.vehicle == "BICYCLE" else 3,
        current_load=state.load,
        cash_in_hand_paisa=0,
        cash_limit_paisa=350_000,
        zone_id="sylhet-1",
    )


def _history(
    state: RiderState,
    profile: RiderProfile,
    travel_m: int,
    placed_at_s: int,
    vendor_id: str,
) -> RiderHistory:
    """Long-run history plus today's load. Ratings are not re-counted per delivery: a rider's
    reputation is a slow statistic, and letting it grow with today's work would turn every factor
    into a second copy of the fairness term."""
    return RiderHistory(
        completion_rate=profile.completion_rate,
        on_time_rate=profile.on_time_rate,
        rating_positives=40,
        rating_total=45,
        deliveries_from_vendor=state.vendor_visits.get(vendor_id, 0),
        deliveries_into_cell=0,
        idle_s=max(0, placed_at_s - state.idle_since_s),
        deliveries_today=state.deliveries,
        acceptance_probability=max(0.05, min(0.95, state.acceptance)),
        eta_to_vendor_s=travel_m // max(1, int(profile.speed_mps)),
    )


def _accept(
    waves: list,
    states: dict[str, RiderState],
    order: OrderSpec,
    rng: random.Random,
) -> tuple[str | None, int | None, int]:
    """Ask the waves in order and return the winner, the second they answered, and offers made."""
    offers = 0
    for wave in waves:
        for rider_id in wave.rider_ids:
            state = states[rider_id]
            offers += 1
            if rng.random() < max(0.05, min(0.95, state.acceptance)):
                state.acceptance = min(0.95, state.acceptance + 0.08 * (1.0 - state.acceptance))
                return rider_id, wave.starts_at_s + rng.randint(2, 9), offers
            state.acceptance = max(0.05, state.acceptance - 0.03)
    return None, None, offers


def _delivery(
    state: RiderState,
    vendor: VendorProfile,
    order: OrderSpec,
    accepted_at_s: int,
) -> tuple[int, int, int, int, int]:
    """Travel, wait and deliver one order; returns (arrive, wait, depart, delivered, route_m)."""
    travel_m = routed_metres(state.at, vendor.point)
    travel_s = int(travel_m / state.profile.speed_mps)
    start = max(accepted_at_s, state.free_at_s)
    arrive = start + travel_s
    wait = max(0, order.ready_at_s - arrive)
    depart = max(arrive, order.ready_at_s)
    drop_m = routed_metres(vendor.point, order.drop)
    delivered = depart + int(drop_m / state.profile.speed_mps) + 120
    return arrive, wait, depart, delivered, travel_m + drop_m


def _spend(state: RiderState, order: OrderSpec, vendor: VendorProfile, delivered: int, drop: Point, route_m: int) -> None:
    state.at = drop
    state.free_at_s = delivered
    state.load = 0
    state.deliveries += 1
    state.earnings_paisa += payout_paisa(route_m)
    state.idle_since_s = delivered
    state.vendor_visits[vendor.vendor_id] = state.vendor_visits.get(vendor.vendor_id, 0) + 1


def _try_bundle(
    first: OrderSpec,
    second: OrderSpec,
    rider: RiderState,
    vendor: VendorProfile,
    arrive_s: int,
    depart_s: int,
    active_orders: int,
    active_riders: int,
) -> tuple[tuple[OrderSpec, int], tuple[OrderSpec, int]] | None:
    """Score a same-vendor co-arrival and, if it clears 0.45, return both delivery seconds.

    The score is the real `batch.batch_score`; the geometry is the simulated city's. A bundle is only
    considered when both orders are at the same vendor, both ready within six minutes of each other,
    and the rider has capacity — the three conditions `12 §2` names for co-arrival.
    """
    if abs(first.ready_at_s - second.ready_at_s) > 360:
        return None
    if rider.profile.vehicle == "BICYCLE" and rider.load + 2 > 1:
        return None
    first_m = routed_metres(vendor.point, first.drop)
    second_m = routed_metres(vendor.point, second.drop)
    between_m = routed_metres(first.drop, second.drop)
    solo_m = (routed_metres(rider.at, vendor.point) + first_m) * 2
    bundle_m = routed_metres(rider.at, vendor.point) + min(first_m, second_m) + between_m
    detour_s = between_m / rider.profile.speed_mps + HANDOVER_S
    score = batch_score(
        ScoreInput(
            solo_total_m=solo_m,
            bundle_total_m=bundle_m,
            max_detour_s=detour_s,
            ready_window_s=abs(first.ready_at_s - second.ready_at_s),
            batch_success_rate=0.8,
            zone=ZonePressure(active_orders=active_orders, active_riders=max(1, active_riders)),
        )
    )
    if not score.offered:
        return None
    near, far = (first, second) if first_m <= second_m else (second, first)
    depart = max(depart_s, near.ready_at_s, far.ready_at_s)
    near_delivered = depart + int(routed_metres(vendor.point, near.drop) / rider.profile.speed_mps) + 120
    far_delivered = (
        near_delivered + HANDOVER_S + int(routed_metres(near.drop, far.drop) / rider.profile.speed_mps) + 120
    )
    return (near, near_delivered), (far, far_delivered)


@dataclass(frozen=True)
class Attempt:
    """One dispatch attempt: who said yes, when, how many phones rang, and how many the ladder rang."""

    rider_id: str | None
    accepted_at_s: int | None
    offers: int
    ladder_offers: int = 0


def _available(state: dict[str, RiderState], order: OrderSpec, vendor: VendorProfile, at_s: int) -> list[Candidate]:
    """Riders who could take this order if it were dispatched at `at_s`.

    A rider who frees up within fifteen minutes is a candidate: dispatch assigns the order and the
    rider starts travelling when they are free, which is what a real offer to a busy rider does.
    """
    return [
        _candidate(rider, rider.profile, vendor, order)
        for rider in state.values()
        if rider.profile.shift_start_s <= at_s <= rider.profile.shift_end_s
        and rider.free_at_s <= at_s + 900
    ]


def _attempt(
    order: OrderSpec,
    dispatch_at_s: int,
    state: dict[str, RiderState],
    vendor: VendorProfile,
    policy: str,
    rng: random.Random,
) -> Attempt:
    """Apply one policy to one order at one moment, including the ladder's first rung."""
    context = OrderContext("sylhet-1", vendor.vendor_id, order.subtotal_paisa)
    available = _available(state, order, vendor, dispatch_at_s)
    survivors = list(filter_candidates(available, context).candidates)
    histories = {
        rider.rider_id: _history(
            state[rider.rider_id],
            state[rider.rider_id].profile,
            rider.routed_to_vendor_m,
            dispatch_at_s,
            vendor.vendor_id,
        )
        for rider in survivors
    }

    if survivors and policy == UNDAL:
        ranked = score_candidates(
            context,
            survivors,
            DEFAULT_WEIGHTS,
            _zone(survivors, histories),
            histories,
            ready_in_s=max(60, order.ready_at_s - dispatch_at_s),
        )
        probabilities = [histories[entry.rider_id].acceptance_probability for entry in ranked]
        waves = size_waves(ranked, probabilities, target=0.90, max_waves=MAX_WAVES)
        rider_id, accepted_offset, offers = _accept(waves, state, order, rng)
    elif survivors:
        # The baseline: nearest available rider, one phone at a time, the same five-wave schedule.
        ordered = sorted(survivors, key=lambda rider: (rider.routed_to_vendor_m, rider.rider_id))
        waves = [
            Wave(number, (rider.rider_id,), ttl_s, starts_at_s, 1.0 - histories[rider.rider_id].acceptance_probability)
            for (number, ttl_s, starts_at_s), rider in zip(WAVE_SCHEDULE, ordered)
        ]
        rider_id, accepted_offset, offers = _accept(waves, state, order, rng)
    else:
        rider_id, accepted_offset, offers = None, None, 0

    if rider_id is None and policy == UNDAL:
        later = dispatch_at_s + 112
        retry = filter_candidates(
            relax_candidates(_available(state, order, vendor, later)),
            context,
            zone_tolerance_m=3_000,
        )
        waves = size_waves(
            [rider.rider_id for rider in retry.candidates],
            [0.5 for _ in retry.candidates],
            target=0.90,
            max_waves=1,
        )
        rider_id, retry_offset, more = _accept(waves, state, order, rng)
        ladder_offers = more
        if rider_id is not None and retry_offset is not None:
            accepted_offset = 112 + retry_offset
            return Attempt(rider_id, dispatch_at_s + accepted_offset, offers, ladder_offers)
        return Attempt(None, None, offers, ladder_offers)

    if rider_id is None or accepted_offset is None:
        return Attempt(None, None, offers)
    return Attempt(rider_id, dispatch_at_s + accepted_offset, offers)


def _serve(
    order: OrderSpec,
    rider_id: str,
    accepted_at_s: int,
    offers: int,
    state: dict[str, RiderState],
    vendor: VendorProfile,
    ladder_offers: int = 0,
) -> Delivery:
    """Travel, wait, deliver and pay one order; mutates the rider and returns the outcome row."""
    rider = state[rider_id]
    arrive, wait, depart, delivered, route_m = _delivery(rider, vendor, order, accepted_at_s)
    _spend(rider, order, vendor, delivered, order.drop, route_m)
    row = _delivery_row(order, rider_id, offers, accepted_at_s, depart, delivered, wait, False, route_m)
    return row if ladder_offers == 0 else replace(row, ladder_offers=ladder_offers)


def _drain(
    pending: list[tuple[OrderSpec, int, int]],
    at_s: int,
    state: dict[str, RiderState],
    day: Day,
    policy: str,
    rng: random.Random,
    deliveries: list[Delivery],
) -> list[tuple[OrderSpec, int, int]]:
    """Offer every waiting order once at `at_s`, oldest first; return those still waiting."""
    still: list[tuple[OrderSpec, int, int]] = []
    for waiting, carried, carried_ladder in pending:
        vendor = next(item for item in day.vendors if item.vendor_id == waiting.vendor_id)
        attempt = _attempt(waiting, at_s, state, vendor, policy, rng)
        if attempt.rider_id is not None and attempt.accepted_at_s is not None:
            deliveries.append(
                _serve(
                    waiting,
                    attempt.rider_id,
                    attempt.accepted_at_s,
                    carried + attempt.offers,
                    state,
                    vendor,
                    carried_ladder + attempt.ladder_offers,
                )
            )
        else:
            still.append((waiting, carried + attempt.offers, carried_ladder + attempt.ladder_offers))
    return still


def simulate_day(day: Day, policy: str) -> tuple[list[Delivery], Tally]:
    """Run one day under one policy, returning each order's outcome and the day's totals.

    Orders do not vanish when every rider is busy: they wait, and are offered again whenever a rider
    frees up, when the next order arrives, or when the day ends. "No rider found" counts the orders
    that were still waiting when the day closed — the ones a customer would have had cancelled.
    """
    if policy not in POLICIES:
        raise ValueError(f"unknown policy {policy!r}")
    rng = random.Random(SEED * 7_919 + day.day)
    state = {
        profile.rider_id: RiderState(
            profile=profile,
            at=profile.home,
            free_at_s=profile.shift_start_s,
            idle_since_s=profile.shift_start_s,
            acceptance=profile.base_acceptance,
        )
        for profile in day.riders
    }
    deliveries: list[Delivery] = []
    tally = Tally()
    for profile in day.riders:
        tally.rider_hours += max(0, profile.shift_end_s - profile.shift_start_s) / 3_600.0

    queue = list(day.orders)
    pending: list[tuple[OrderSpec, int, int]] = []
    while queue:
        order = queue.pop(0)
        now = order.placed_at_s

        pending = _drain(pending, now, state, day, policy, rng, deliveries)

        vendor = next(item for item in day.vendors if item.vendor_id == order.vendor_id)
        attempt = _attempt(order, order.placed_at_s, state, vendor, policy, rng)
        if attempt.rider_id is None or attempt.accepted_at_s is None:
            pending.append((order, attempt.offers, attempt.ladder_offers))
            continue

        rider_id = attempt.rider_id
        accepted_at_s = attempt.accepted_at_s
        rider = state[rider_id]
        arrive, wait, depart, delivered, route_m = _delivery(rider, vendor, order, accepted_at_s)

        # Same-vendor co-arrival: bundle the next order when the real score says it is worth it.
        if policy == UNDAL and queue and queue[0].vendor_id == order.vendor_id and abs(queue[0].placed_at_s - order.placed_at_s) <= 480:
            nxt = queue[0]
            bundle = _try_bundle(
                order, nxt, rider, vendor, arrive, depart,
                active_orders=len(queue), active_riders=len(state),
            )
            if bundle is not None:
                (near, near_at), (far, far_at) = bundle
                for row_order, row_at, row_offers, row_route in (
                    (near, near_at, attempt.offers, route_m),
                    (far, far_at, 0, routed_metres(far.drop, near.drop)),
                ):
                    deliveries.append(
                        _delivery_row(row_order, rider_id, row_offers, accepted_at_s, depart, row_at, wait, True, row_route)
                    )
                rider.deliveries += 2
                rider.earnings_paisa += payout_paisa(route_m, orders=2)
                rider.at = far.drop
                rider.free_at_s = far_at
                rider.idle_since_s = far_at
                rider.load = 0
                rider.vendor_visits[vendor.vendor_id] = rider.vendor_visits.get(vendor.vendor_id, 0) + 2
                queue.pop(0)
                continue

        deliveries.append(
            _serve(
                order,
                rider_id,
                accepted_at_s,
                attempt.offers,
                state,
                vendor,
                attempt.ladder_offers,
            )
        )
        # A rider has just become busy until a known second. That is the next moment the queue can
        # move, so dispatch reacts then rather than waiting for the next order to arrive.
        freed = min(
            (rider.free_at_s for rider in state.values() if rider.free_at_s >= accepted_at_s),
            default=accepted_at_s,
        )
        pending = _drain(pending, freed, state, day, policy, rng, deliveries)

    # Last call: whatever is still waiting is offered once more before the day closes.
    still_waiting: list[tuple[OrderSpec, int, int]] = []
    for waiting, carried, carried_ladder in pending:
        vendor = next(item for item in day.vendors if item.vendor_id == waiting.vendor_id)
        attempt = _attempt(waiting, DAY_END_S, state, vendor, policy, rng)
        if attempt.rider_id is not None and attempt.accepted_at_s is not None:
            deliveries.append(
                _serve(
                    waiting,
                    attempt.rider_id,
                    attempt.accepted_at_s,
                    carried + attempt.offers,
                    state,
                    vendor,
                    carried_ladder + attempt.ladder_offers,
                )
            )
        else:
            still_waiting.append((waiting, carried + attempt.offers, carried_ladder + attempt.ladder_offers))
    for waiting, carried, carried_ladder in still_waiting:
        deliveries.append(
            Delivery(
                waiting.order_id, False, None, carried, None, None, None, None, False, None, 0, carried_ladder
            )
        )

    for delivery in deliveries:
        tally.add(delivery)

    rates = []
    for profile in day.riders:
        hours = max(0.5, (profile.shift_end_s - profile.shift_start_s) / 3_600.0)
        rates.append(state[profile.rider_id].earnings_paisa / hours)
    tally.gini_sum += gini(rates)
    tally.gini_days += 1
    return deliveries, tally


def _delivery_row(
    order: OrderSpec,
    rider_id: str,
    offers: int,
    accepted_at_s: int,
    depart_s: int,
    delivered_at_s: int,
    wait_s: int,
    batched: bool,
    route_m: int,
) -> Delivery:
    """Assemble one outcome row; the arithmetic that makes it is above, in one place per policy."""
    return Delivery(
        order_id=order.order_id,
        assigned=True,
        rider_id=rider_id,
        offers=offers,
        time_to_assignment_s=accepted_at_s - order.placed_at_s,
        delivered_at_s=delivered_at_s,
        rider_wait_s=wait_s,
        customer_wait_s=delivered_at_s - order.placed_at_s,
        batched=batched,
        on_time=delivered_at_s <= order.promise_at_s,
        payout_paisa=payout_paisa(route_m),
    )


def _zone(survivors: list[Candidate], histories: dict[str, RiderHistory]) -> ZoneFeatures:
    distances = sorted(rider.routed_to_vendor_m for rider in survivors)
    deliveries = [entry.deliveries_today for entry in histories.values()]
    return ZoneFeatures(
        median_pickup_m=max(1.0, float(statistics.median(distances))),
        median_deliveries_today=max(1.0, float(statistics.mean(deliveries)) if deliveries else 4.0),
        riders_in_drop_cell=float(max(1, len(survivors) // 2)),
        forecast_drop_cell=float(max(1, len(survivors) // 2)),
    )
