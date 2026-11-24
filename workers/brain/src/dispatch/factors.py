"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The fourteen factors of `11 §5`, each returning a value in `[0, 1]` where 1 is better.

Two rules hold the module together. Every factor is a pure function of its own arguments — no clock,
no database, no configuration read — so a ranking can be replayed and a disagreement can be settled
by hand. And every factor is clamped into `[0, 1]` by construction rather than by a `max(0, min(1))`
sprinkled at the call site, because a factor that can exceed 1 turns the weights into a suggestion.

The weights are the document's figures normalised to sum to exactly 1.0; see `D73` and the test that
records why.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

#: The fourteen factors, in the order `11 §5` prints them. The order is load-bearing: the tie-break
#: reads `factors[2]`, which is acceptance, and the explain row is rendered column by column.
FACTORS = (
    "proximity",
    "eta_fit",
    "acceptance",
    "reliability",
    "fairness",
    "rating",
    "vendor_familiarity",
    "area_familiarity",
    "batch_fit",
    "load_balance",
    "cash_headroom",
    "zone_coverage",
    "freshness",
    "vehicle_fit",
)

#: The default weights exactly as `11 §5` prints them. They sum to 1.005, not 1.000 — see `D73`.
PRINTED_WEIGHTS = {
    "proximity": 0.170,
    "eta_fit": 0.150,
    "acceptance": 0.130,
    "reliability": 0.110,
    "fairness": 0.095,
    "rating": 0.070,
    "vendor_familiarity": 0.055,
    "area_familiarity": 0.055,
    "batch_fit": 0.050,
    "load_balance": 0.045,
    "cash_headroom": 0.030,
    "zone_coverage": 0.025,
    "freshness": 0.010,
    "vehicle_fit": 0.010,
}

#: How close to 1.0 a weight set must be before dispatch will use it (`35 §` gate: ±1e-9).
WEIGHT_TOLERANCE = 1e-9

#: The floor a bicycle's `vehicle_fit` can reach: a bicycle on a long trip is bad, never impossible.
MIN_VEHICLE_FIT = 0.3


def normalise(weights: dict[str, float]) -> dict[str, float]:
    """Divide by the sum, so a configured set is a genuine convex combination.

    A ranking is a weighted average only if the weights sum to one; otherwise the score is a number
    whose scale depends on how many factors somebody edited, and no threshold on it means anything.
    """
    missing = [name for name in FACTORS if name not in weights]
    if missing:
        raise ValueError(f"missing factor weights: {missing}")
    total = sum(float(weights[name]) for name in FACTORS)
    if total <= 0:
        raise ValueError("weights must sum to something positive")
    return {name: float(weights[name]) / total for name in FACTORS}


@dataclass(frozen=True)
class Weights:
    """A validated, normalised set of factor weights."""

    values: dict[str, float]

    def __post_init__(self) -> None:
        missing = [name for name in FACTORS if name not in self.values]
        if missing:
            raise ValueError(f"missing factor weights: {missing}")
        total = sum(self.values[name] for name in FACTORS)
        if abs(total - 1.0) > WEIGHT_TOLERANCE:
            raise ValueError(f"weights must sum to 1.0 ± {WEIGHT_TOLERANCE}, got {total!r}")

    def __getitem__(self, name: str) -> float:
        return self.values[name]

    @classmethod
    def default(cls) -> "Weights":
        return cls(normalise(PRINTED_WEIGHTS))


DEFAULT_WEIGHTS = Weights.default()


def proximity(routed_m: int, median_pickup_m: float) -> float:
    """`1 / (1 + d/k)` — close is better, with a zone-shaped sense of what "close" means.

    The `k` divisor is the zone's median pickup distance, not a constant, because 900 m is around the
    corner in Sylhet city and a different neighbourhood entirely in a village union.
    """
    if routed_m < 0:
        raise ValueError(f"negative distance {routed_m}")
    if median_pickup_m <= 0:
        raise ValueError(f"median pickup distance must be positive, got {median_pickup_m}")
    return 1.0 / (1.0 + routed_m / median_pickup_m)


def eta_fit(arrival_s: int, ready_s: int) -> float:
    """1.0 when the rider arrives in the sweet spot just before the food is ready.

    The asymmetry is deliberate: arriving early costs the rider time, arriving late costs the customer
    a cold meal, and the second is worse. The decay on the late side is therefore steep.
    """
    slack = ready_s - arrival_s  # positive = early
    if 0 <= slack <= 120:
        return 1.0
    if slack > 120:
        return max(0.0, 1.0 - (slack - 120) / 900.0)  # 15 min early → 0
    return max(0.0, 1.0 - (-slack) / 420.0)  # 7 min late → 0


def acceptance(probability: float) -> float:
    """The propensity model's prediction for this rider and this offer (`09 §7.4`).

    Passed in rather than computed here: the model is a logistic fit over history, and a dispatch
    module that recomputed it would be a second model with its own opinion about who says yes.
    """
    if not 0.0 <= probability <= 1.0:
        raise ValueError(f"acceptance probability must be 0..1, got {probability}")
    return probability


def reliability(completion_rate: float, on_time_rate: float) -> float:
    """`0.6 × completion + 0.4 × on-time` — finishing matters more than being quick."""
    for name, value in (("completion_rate", completion_rate), ("on_time_rate", on_time_rate)):
        if not 0.0 <= value <= 1.0:
            raise ValueError(f"{name} must be 0..1, got {value}")
    return 0.6 * completion_rate + 0.4 * on_time_rate


def wilson_lower(successes: int, total: int, z: float = 1.96) -> float:
    """The Wilson lower bound of a proportion.

    A rider with one five-star rating is not a 5.0 rider, and a plain ratio would say they were — which
    is how a new rider outranks a good one and then disappoints the customer who was served first.
    """
    if total < 0 or successes < 0:
        raise ValueError("counts cannot be negative")
    if successes > total:
        raise ValueError(f"{successes} successes out of {total}")
    if total == 0:
        return 0.0
    p = successes / total
    denominator = 1 + z * z / total
    centre = p + z * z / (2 * total)
    margin = z * ((p * (1 - p) / total + z * z / (4 * total * total)) ** 0.5)
    return max(0.0, (centre - margin) / denominator)


def fairness(idle_s: int, deliveries_today: int, zone_median_today: float) -> float:
    """Spread work: waiting riders rise, heavily-loaded riders fall.

    Without this factor dispatch concentrates on whoever happens to live near the busiest vendors,
    their earnings fall, they leave, coverage shrinks, and the concentration gets worse. It is a
    positive-feedback failure mode and an explicit cost in the objective is the only defence.
    """
    if idle_s < 0 or deliveries_today < 0:
        raise ValueError("idle time and delivery counts cannot be negative")
    idle_term = min(1.0, idle_s / 1200.0)  # saturates at 20 min
    if zone_median_today <= 0:
        load_term = 1.0
    else:
        ratio = deliveries_today / zone_median_today
        load_term = max(0.0, min(1.0, 1.5 - 0.5 * ratio))  # 1.0 at 0 jobs, 0.0 at 3× median
    return 0.55 * idle_term + 0.45 * load_term


def vendor_familiarity(deliveries_from_vendor: int) -> float:
    """`min(1, deliveries / 8)` — a rider who knows the back entrance is faster."""
    if deliveries_from_vendor < 0:
        raise ValueError("delivery counts cannot be negative")
    return min(1.0, deliveries_from_vendor / 8.0)


def area_familiarity(deliveries_into_cell: int) -> float:
    """`min(1, deliveries / 12)` — matters most for finding an unmarked door."""
    if deliveries_into_cell < 0:
        raise ValueError("delivery counts cannot be negative")
    return min(1.0, deliveries_into_cell / 12.0)


def batch_fit(feasibility: float | None) -> float:
    """0 when this is not a batch candidate; otherwise the bundle's feasibility score (`12 §5`)."""
    if feasibility is None:
        return 0.0
    if not 0.0 <= feasibility <= 1.0:
        raise ValueError(f"feasibility must be 0..1, got {feasibility}")
    return feasibility


def load_balance(current_load: int, max_concurrent: int) -> float:
    """Falls as a rider's concurrent orders approach their maximum."""
    if max_concurrent <= 0:
        raise ValueError("max_concurrent must be positive")
    if current_load < 0:
        raise ValueError("load cannot be negative")
    return max(0.0, 1.0 - current_load / max_concurrent)


def cash_headroom(cash_in_hand_paisa: int, order_total_paisa: int, cash_limit_paisa: int) -> float:
    """`1 − (cash in hand + order total) / cash limit` — how much room is left before a rider locks."""
    if cash_limit_paisa <= 0:
        raise ValueError("cash limit must be positive")
    if min(cash_in_hand_paisa, order_total_paisa) < 0:
        raise ValueError("cash amounts cannot be negative")
    return max(0.0, min(1.0, 1.0 - (cash_in_hand_paisa + order_total_paisa) / cash_limit_paisa))


def zone_coverage(riders_in_cell: float, forecast_orders: float) -> float:
    """1 when a cell has the riders its forecast needs, falling as it is stripped bare.

    Sending the last rider out of a quiet cell is free today and expensive in twenty minutes, when the
    cell has an order and nobody within a kilometre. This is the factor that pays that forward.
    """
    if riders_in_cell < 0 or forecast_orders < 0:
        raise ValueError("coverage inputs cannot be negative")
    if forecast_orders <= 0:
        return 1.0
    return max(0.0, min(1.0, riders_in_cell / forecast_orders))


def freshness(fix_age_s: int, stale_after_s: int = 240) -> float:
    """Falls as the position fix ages, reaching zero at `stale_after_s`."""
    if fix_age_s < 0:
        raise ValueError("a fix cannot be from the future")
    if stale_after_s <= 0:
        raise ValueError("stale_after_s must be positive")
    return max(0.0, 1.0 - fix_age_s / stale_after_s)


def vehicle_fit(vehicle: str, routed_m: int, max_radius_m: int) -> float:
    """Suitability of the vehicle for the trip, floored so a bicycle is penalised and not banned."""
    if max_radius_m <= 0:
        raise ValueError("max_radius_m must be positive")
    if routed_m < 0:
        raise ValueError("negative distance")
    if vehicle == "MOTORBIKE":
        return 1.0
    if vehicle != "BICYCLE":
        raise ValueError(f"unknown vehicle {vehicle!r}")
    return max(MIN_VEHICLE_FIT, 1.0 - routed_m / max_radius_m)


def all_factors_in_range(values: Iterable[float]) -> bool:
    """Whether every factor the scorer produced is inside `[0, 1]` (`35 §` gate)."""
    return all(0.0 <= value <= 1.0 for value in values)
