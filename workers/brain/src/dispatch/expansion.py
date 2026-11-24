"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The expansion ladder (`11 §11`): what Undal does when nobody takes the order.

Six steps, each at a printed second, each strictly more generous than the last and each cheaper for
the platform than a cancellation. The ladder is data, not `if` statements scattered through Core: a
step has a time, an action and the parameters that action needs, so the order's state event log can
name the step that fired and the weekly review can count how often step 5 was reached — which is the
clearest signal available that a zone is under-supplied.

Two rules are encoded rather than commented. Step 1 only ever *widens* a limit: a relaxation that
narrowed a radius or a cash cap would be a bug wearing a rescue's clothes, so the scales refuse to go
below 100%. And no order may be cancelled before step 6 (`D10`): `may_cancel` is false for every
second before T+480, whatever the caller would prefer.
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass

from dispatch.filters import Candidate
from lib.paisa import BPS, floor_to_taka

#: When the ladder's steps fire, in seconds after the order became assignable (`11 §11`).
RELAX_AT_S = 112
BOOST_1_AT_S = 140
BOOST_2_AT_S = 175
ADMIN_EXCEPTION_AT_S = 215
ASK_CUSTOMER_AT_S = 300
AUTO_CANCEL_AT_S = 480

#: The two boosts, as a percentage of the rider fare, funded by the platform.
BOOST_1_PCT = 20
BOOST_2_PCT = 40

#: Step 1's relaxations, all expressed so that the result is still an integer.
BICYCLE_RADIUS_SCALE_BPS = 12_000
CASH_CAP_SCALE_BPS = 12_000
RELAXED_ZONE_TOLERANCE_M = 3_000

#: Credits paid from the platform's account, never from the customer's or the rider's.
PICKUP_APOLOGY_CREDIT_PAISA = 3_000
CANCEL_APOLOGY_CREDIT_PAISA = 5_000

#: The bonus a re-dispatched order carries so somebody rescues it (`11 §10`).
RECOVERY_BONUS_PAISA = 1_500

#: The admin exception step 4 raises.
ADMIN_EXCEPTION_KIND = "NO_RIDER_AVAILABLE"
ADMIN_EXCEPTION_SEVERITY = "HIGH"

#: The three answers step 5 offers the customer.
CUSTOMER_WAIT = "WAIT"
CUSTOMER_PICKUP = "PICKUP"
CUSTOMER_CANCEL = "CANCEL"
CUSTOMER_CHOICES = (CUSTOMER_WAIT, CUSTOMER_PICKUP, CUSTOMER_CANCEL)


@dataclass(frozen=True)
class ExpansionStep:
    """One rung: when it fires, what it does, and the numbers the action needs."""

    step: int
    at_s: int
    action: str
    detail: str
    boost_pct: int | None = None


#: The ladder exactly as `11 §11` prints it. Order is the firing order.
EXPANSION_LADDER = (
    ExpansionStep(1, RELAX_AT_S, "RELAX_FILTERS", "widen the bicycle radius, the cash cap and the zone edge by 20%"),
    ExpansionStep(2, BOOST_1_AT_S, "BOOST_PAYOUT", "re-offer wave 1 with a platform-funded boost", BOOST_1_PCT),
    ExpansionStep(3, BOOST_2_AT_S, "BOOST_PAYOUT_AND_WIDEN", "offer to every eligible rider in the zone", BOOST_2_PCT),
    ExpansionStep(4, ADMIN_EXCEPTION_AT_S, "RAISE_ADMIN_EXCEPTION", "put the order on the command map for a human"),
    ExpansionStep(5, ASK_CUSTOMER_AT_S, "ASK_CUSTOMER", "wait, switch to pick-up, or cancel for a full refund"),
    ExpansionStep(6, AUTO_CANCEL_AT_S, "AUTO_CANCEL", "cancel if the customer has not answered and no rider accepted"),
)


@dataclass(frozen=True)
class Relaxations:
    """Step 1 as numbers: scales in basis points so nothing rounds through a float."""

    bicycle_radius_scale_bps: int = BICYCLE_RADIUS_SCALE_BPS
    cash_cap_scale_bps: int = CASH_CAP_SCALE_BPS
    zone_tolerance_m: int = RELAXED_ZONE_TOLERANCE_M

    def __post_init__(self) -> None:
        """Refuse a relaxation that narrows anything — that would be a rescuer making things worse."""
        if self.bicycle_radius_scale_bps < BPS:
            raise ValueError("a relaxation may not shrink the bicycle radius")
        if self.cash_cap_scale_bps < BPS:
            raise ValueError("a relaxation may not shrink the cash cap")
        if self.zone_tolerance_m < 1_500:
            raise ValueError("a relaxation may not shrink the zone tolerance")


#: The relaxations step 1 applies.
RELAXATIONS = Relaxations()


def due_step(elapsed_s: int) -> ExpansionStep | None:
    """The latest rung whose time has come, or `None` while the cascade still owns the order."""
    if elapsed_s < 0:
        raise ValueError(f"elapsed seconds cannot be negative, got {elapsed_s}")
    due: ExpansionStep | None = None
    for step in EXPANSION_LADDER:
        if elapsed_s >= step.at_s:
            due = step
    return due


def next_step(elapsed_s: int) -> ExpansionStep | None:
    """The next rung still ahead, or `None` once the ladder has finished cancelling."""
    if elapsed_s < 0:
        raise ValueError(f"elapsed seconds cannot be negative, got {elapsed_s}")
    for step in EXPANSION_LADDER:
        if elapsed_s < step.at_s:
            return step
    return None


def relax_candidate(rider: Candidate, relaxations: Relaxations = RELAXATIONS) -> Candidate:
    """Step 1 for one rider: a wider bicycle radius and a higher cash cap, never a narrower one.

    Only the bicycle radius moves. A motorbike's 12 km radius is a legal-and-practical limit, not a
    tuning knob, and quietly extending it would send a rider across the district.
    """
    radius = rider.vehicle_max_radius_m
    if rider.vehicle == "BICYCLE":
        radius = radius * relaxations.bicycle_radius_scale_bps // BPS
    cash_limit = rider.cash_limit_paisa * relaxations.cash_cap_scale_bps // BPS
    return dataclasses.replace(
        rider,
        vehicle_max_radius_m=max(radius, rider.vehicle_max_radius_m),
        cash_limit_paisa=max(cash_limit, rider.cash_limit_paisa),
    )


def relax_candidates(riders: list[Candidate], relaxations: Relaxations = RELAXATIONS) -> list[Candidate]:
    """Step 1 for the whole candidate list, preserving order."""
    return [relax_candidate(rider, relaxations) for rider in riders]


def boosted_payout(base_paisa: int, boost_pct: int) -> int:
    """The rider fare after a platform-funded boost, floored to taka exactly once.

    A boost is money, so it goes through the same integer arithmetic as every other amount: the
    percentage is applied in paisa and the result is floored to a whole taka. The platform pays the
    difference; the customer's bill is untouched.
    """
    if base_paisa < 0:
        raise ValueError(f"a payout cannot be negative, got {base_paisa}")
    if boost_pct < 0:
        raise ValueError(f"a boost cannot be negative, got {boost_pct}")
    grown = base_paisa * (BPS + boost_pct * 100) // BPS
    return floor_to_taka(grown)[0]


def pickup_refund_paisa(delivery_fee_paisa: int) -> int:
    """Step 5's pick-up switch: the whole delivery fee comes back, plus a ৳30 apology credit."""
    if delivery_fee_paisa < 0:
        raise ValueError(f"a delivery fee cannot be negative, got {delivery_fee_paisa}")
    return delivery_fee_paisa + PICKUP_APOLOGY_CREDIT_PAISA


def may_cancel(elapsed_s: int) -> bool:
    """`D10`: an order is never cancelled before the ladder has run its course."""
    return elapsed_s >= AUTO_CANCEL_AT_S


def may_auto_cancel(elapsed_s: int, customer_responded: bool) -> bool:
    """Step 6: cancel only after T+480, and only if the customer left the question unanswered."""
    return may_cancel(elapsed_s) and not customer_responded


def admin_exception(elapsed_s: int) -> ExpansionStep | None:
    """The rung that puts the order in front of a human, if it has been reached."""
    step = due_step(elapsed_s)
    if step is not None and step.step >= 4:
        return EXPANSION_LADDER[3]
    return None
