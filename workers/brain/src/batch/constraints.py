"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The constants and the shapes of `10 §` and `12 §4`: what a bundle is, and how much detour it may cost.

Bundling exists because two orders from the same kitchen on the same street are one trip, and it is
the only mechanism in the platform that reduces cost *and* rider earnings per trip at the same time —
so it is also the only one that can quietly ruin the product. The detour budget is the guardrail, and
it is a hard number rather than a preference: seven minutes of extra wait is invisible in a dashboard
and very visible to the customer holding the bag.
"""

from __future__ import annotations

from dataclasses import dataclass, field

#: C1: the most detour one order may suffer inside a bundle, in seconds.
MAX_DETOUR_S = 420

#: C2: the tightened budget when an order carries a `TEMPERATURE_CRITICAL` or `SPILL_RISK` item.
TEMPERATURE_DETOUR_S = MAX_DETOUR_S // 2

#: C4: how far apart two orders' ready times may be.
READY_WINDOW_S = 360

#: C5: the longest hop between two drops, per vehicle.
MAX_LEG_M = {"MOTORBIKE": 2_000, "BICYCLE": 1_200}

#: C6: the longest total route a bundle may run, per vehicle.
MAX_BUNDLE_SPAN_M = {"MOTORBIKE": 12_000, "BICYCLE": 4_000}

#: C7: how many bags fit, and what a fragile item costs in capacity.
CAPACITY = {"MOTORBIKE": 3, "BICYCLE": 1}

#: A door costs more than a road: finding a building, stairs, waiting, making change (`12 §4.1`).
DEFAULT_HANDOVER_S = 165

#: What a learned handover time is clamped to.
HANDOVER_MIN_S = 90
HANDOVER_MAX_S = 420

#: At most six orderings for three orders, and no bundles larger than three.
MAX_BUNDLE_ORDERS = 3
MAX_PERMUTATIONS = 6

#: The weight on route metres in the permutation cost (`12 §4.2`), so 500 m ≈ 22 s of squared detour.
ROUTE_PENALTY_PER_M = 0.004

#: A bundle is only offered above this score (`12 §6`).
BATCH_SCORE_MIN = 0.45

#: The states an order may not be in when it is bundled (`C9`).
UNBUNDLEABLE_STATES = frozenset({"REASSIGNING", "DISPUTED", "SETTLED", "DELIVERED", "CANCELLED_BY_CUSTOMER"})


@dataclass(frozen=True)
class BundleOrder:
    """One order as the bundle evaluator needs it."""

    order_id: str
    ready_at_s: int
    drop_cell: str
    total_paisa: int
    promised_eta_max_s: int
    state: str = "RIDER_SEARCH"
    temperature_critical: bool = False
    spill_risk: bool = False
    item_count: int = 1
    min_payout_paisa: int = 4_000

    @property
    def fragile(self) -> bool:
        """Whether the order tightens the detour budget (`C2`)."""
        return self.temperature_critical or self.spill_risk


@dataclass(frozen=True)
class Legs:
    """The travel times a bundle evaluation needs, in seconds, all measured by the same matrix."""

    vendor_to: dict[str, int]
    between: dict[tuple[str, str], int]

    def to_drop(self, order_id: str) -> int:
        return self.vendor_to[order_id]

    def between_drops(self, first: str, second: str) -> int:
        return self.between[(first, second)]


@dataclass(frozen=True)
class RiderFacts:
    """What the constraints need to know about the rider carrying the bundle."""

    vehicle: str
    cash_in_hand_paisa: int
    cash_limit_paisa: int
    batch_success_rate: float = 0.9
    payout_paisa: int = 0
    handover_s: int = DEFAULT_HANDOVER_S


@dataclass(frozen=True)
class ZonePressure:
    """The zone terms the batch score needs (`12 §6`)."""

    active_orders: int = 0
    active_riders: int = 1


@dataclass(frozen=True)
class ConstraintReport:
    """Every constraint's verdict, so an infeasible bundle says exactly what stopped it."""

    verdicts: dict[str, bool | None] = field(default_factory=dict)

    @property
    def feasible(self) -> bool:
        return all(value is not False for value in self.verdicts.values())

    @property
    def failed(self) -> tuple[str, ...]:
        return tuple(name for name, value in self.verdicts.items() if value is False)

    def __getitem__(self, name: str) -> bool | None:
        return self.verdicts[name]


def clamp_handover(seconds: int) -> int:
    """A learned handover time, kept inside the range the model is trusted in."""
    return max(HANDOVER_MIN_S, min(HANDOVER_MAX_S, seconds))
