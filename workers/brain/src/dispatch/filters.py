"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The fourteen hard filters of `11 §3`.

A filter is a veto: a rider who fails one is not a candidate, and no amount of proximity or
acceptance gets them back. That is why the reasons are numbered and returned — the rider app can say
*why* an order did not arrive, and an ops engineer reading a trace can see which rule emptied the
candidate list without re-deriving it from the code.

Filter 10 (batch feasibility) is answered by `batch/feasibility.py`, which does not exist yet; until
it does, a rider already carrying an order is not offered a second one. That is the conservative
answer, and it is the honest one: a cold meal is worse than a second wave.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

#: How far outside their own zone a rider is still useful (`11 §3`, filter 7).
ZONE_EDGE_TOLERANCE_M = 1_500


@dataclass(frozen=True)
class OrderContext:
    """The order facts the filters read, and nothing else."""

    zone_id: str
    vendor_id: str
    total_paisa: int
    drop_cell: str = ""


@dataclass(frozen=True)
class Candidate:
    """A rider as dispatch sees them when the order becomes assignable."""

    rider_id: str
    status: str = "APPROVED"
    shift_state: str = "ONLINE"
    selfie_verified: bool = True
    fix_age_s: int = 10
    stale_after_s: int = 60
    cash_locked: bool = False
    suspended: bool = False
    zone_id: str = ""
    distance_to_zone_edge_m: int = 0
    vehicle: str = "MOTORBIKE"
    vehicle_max_radius_m: int = 12_000
    routed_to_vendor_m: int = 2_000
    current_load: int = 0
    max_concurrent: int = 3
    cash_in_hand_paisa: int = 0
    cash_limit_paisa: int = 350_000
    rejected_waves: tuple[int, ...] = ()
    vendor_cooldown: bool = False
    notifications_allowed: bool = True


@dataclass
class FilterResult:
    """Whether a rider passed, and if not, which numbered rule refused them."""

    rider_id: str
    passed: bool
    number: int | None = None
    name: str | None = None


def _passes(rider: Candidate, order: OrderContext, zone_tolerance_m: int = ZONE_EDGE_TOLERANCE_M) -> FilterResult:
    checks: tuple[tuple[int, str, Callable[[], bool]], ...] = (
        (1, "KYC_APPROVED", lambda: rider.status == "APPROVED"),
        (2, "ON_SHIFT", lambda: rider.shift_state in ("ONLINE", "ON_ORDER")),
        (3, "SELFIE_VERIFIED", lambda: rider.selfie_verified),
        (4, "POSITION_FRESH", lambda: rider.fix_age_s <= rider.stale_after_s),
        (5, "NOT_CASH_LOCKED", lambda: not rider.cash_locked),
        (6, "NOT_SUSPENDED", lambda: not rider.suspended),
        (7, "ZONE_MATCH_OR_NEAR", lambda: rider.zone_id == order.zone_id or rider.distance_to_zone_edge_m <= zone_tolerance_m),
        (8, "WITHIN_VEHICLE_RADIUS", lambda: rider.routed_to_vendor_m <= rider.vehicle_max_radius_m),
        (9, "UNDER_LOAD_LIMIT", lambda: rider.current_load < rider.max_concurrent),
        (10, "BATCH_FEASIBLE", lambda: rider.current_load == 0),
        (11, "CASH_WITHIN_LIMIT", lambda: rider.cash_in_hand_paisa + order.total_paisa <= rider.cash_limit_paisa),
        (12, "NOT_ALREADY_REJECTED", lambda: len(rider.rejected_waves) == 0),
        (13, "NOT_IN_REJECTION_COOLDOWN", lambda: not rider.vendor_cooldown),
        (14, "NOTIFICATIONS_ENABLED", lambda: rider.notifications_allowed),
    )
    for number, name, check in checks:
        if not check():
            return FilterResult(rider_id=rider.rider_id, passed=False, number=number, name=name)
    return FilterResult(rider_id=rider.rider_id, passed=True)


@dataclass(frozen=True)
class FilterOutcome:
    """The survivors, and a refusal for everyone else so the trace can explain the silence."""

    candidates: tuple[Candidate, ...]
    refusals: tuple[FilterResult, ...] = field(default_factory=tuple)

    @property
    def refused_by_filter(self) -> dict[int, int]:
        counts: dict[int, int] = {}
        for refusal in self.refusals:
            if refusal.number is not None:
                counts[refusal.number] = counts.get(refusal.number, 0) + 1
        return counts


def filter_candidates(
    riders: list[Candidate],
    order: OrderContext,
    zone_tolerance_m: int = ZONE_EDGE_TOLERANCE_M,
) -> FilterOutcome:
    """Apply all fourteen filters, keeping the survivors and recording every reason.

    `zone_tolerance_m` exists for the expansion ladder (`11 §11` step 1), which widens the edge from
    1 500 m to 3 000 m when the cascade fails. Everything else about a filter is fixed, because a
    filter that could be tuned per call is a score wearing a veto's authority.
    """
    survivors: list[Candidate] = []
    refusals: list[FilterResult] = []
    for rider in riders:
        result = _passes(rider, order, zone_tolerance_m)
        if result.passed:
            survivors.append(rider)
        else:
            refusals.append(result)
    return FilterOutcome(candidates=tuple(survivors), refusals=tuple(refusals))


#: The fourteen filter names, in the document's order, for the trace and the admin panel.
FILTERS = (
    "KYC_APPROVED",
    "ON_SHIFT",
    "SELFIE_VERIFIED",
    "POSITION_FRESH",
    "NOT_CASH_LOCKED",
    "NOT_SUSPENDED",
    "ZONE_MATCH_OR_NEAR",
    "WITHIN_VEHICLE_RADIUS",
    "UNDER_LOAD_LIMIT",
    "BATCH_FEASIBLE",
    "CASH_WITHIN_LIMIT",
    "NOT_ALREADY_REJECTED",
    "NOT_IN_REJECTION_COOLDOWN",
    "NOTIFICATIONS_ENABLED",
)
