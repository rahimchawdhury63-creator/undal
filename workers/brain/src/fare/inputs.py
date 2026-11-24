"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The fare input, and the validation that refuses an input the engine cannot defend.

The input is deliberately explicit: no defaults from a global, no clock, no I/O. A quote is a
pure function of this object, which is what makes 40 vectors and 25 properties meaningful — and
what lets the same object be replayed a month later to explain a bill.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fare.constants import (
    COMMISSION_BPS,
    DELIVERY,
    MOTORBIKE_BICYCLE_FULFILMENTS,
    PICKUP,
    RIDER_BONUS_BPS,
    WEATHER_PREMIUM_BPS,
    WEATHER_CONFIDENCE_FLOOR,
    VehiclePricing,
)


class FareInputError(ValueError):
    """An input the engine refuses, with the field named so the caller can fix it."""


@dataclass(frozen=True)
class FareInput:
    """Everything a fare depends on, and nothing else."""

    pricing: VehiclePricing
    routed_distance_m: int
    traffic_delay_s: int
    riders: int
    orders: int
    weather: str
    weather_confidence: float
    item_subtotal_paisa: int
    tip_paisa: int
    fulfilment: str
    commission_bps: int = COMMISSION_BPS
    rider_bonus_bps: int = RIDER_BONUS_BPS
    batch_position: int = 0
    batch_marginal_distance_m: int = 0
    surge_bps_override: Optional[int] = None


def validate(inp: FareInput) -> None:
    """Refuse an input that would produce an arithmetic answer to a nonsense question.

    Every refusal here corresponds to a value that would otherwise flow into the closure
    identity and produce a number that balances and is wrong — a negative distance, a weather
    condition nobody pays a premium for, a batch position with no marginal distance to price.
    """
    if inp.fulfilment not in MOTORBIKE_BICYCLE_FULFILMENTS:
        raise FareInputError(f"fulfilment must be DELIVERY or PICKUP, got {inp.fulfilment!r}")
    if inp.routed_distance_m < 0:
        raise FareInputError(f"routed distance cannot be negative: {inp.routed_distance_m}")
    if inp.routed_distance_m > inp.pricing.max_radius_m * 2:
        # Twice the radius is not a long trip, it is a coordinate bug: Dhaka to Chittagong is
        # about 250 km, and a fare of ৳3 500 for a delivery is a number nobody typed on purpose.
        raise FareInputError(f"routed distance {inp.routed_distance_m} m exceeds twice the vehicle radius")
    if inp.traffic_delay_s < 0:
        raise FareInputError(f"traffic delay cannot be negative: {inp.traffic_delay_s}")
    if inp.weather not in WEATHER_PREMIUM_BPS:
        raise FareInputError(f"unknown weather condition {inp.weather!r}")
    if not 0.0 <= inp.weather_confidence <= 1.0:
        raise FareInputError(f"weather confidence must be 0..1, got {inp.weather_confidence}")
    if inp.item_subtotal_paisa < 0:
        raise FareInputError(f"item subtotal cannot be negative: {inp.item_subtotal_paisa}")
    if inp.tip_paisa < 0:
        raise FareInputError(f"tip cannot be negative: {inp.tip_paisa}")
    if inp.commission_bps < 0 or inp.commission_bps > 5_000:
        raise FareInputError(f"commission {inp.commission_bps} bps is outside 0..5000")
    if inp.rider_bonus_bps < 0 or inp.rider_bonus_bps > 5_000:
        raise FareInputError(f"rider bonus {inp.rider_bonus_bps} bps is outside 0..5000")
    if inp.batch_position < 0:
        raise FareInputError(f"batch position cannot be negative: {inp.batch_position}")
    if inp.batch_position > 0 and inp.batch_marginal_distance_m <= 0:
        raise FareInputError("a bundled order after the first must carry its marginal detour")
    if inp.pricing.vehicle not in ("MOTORBIKE", "BICYCLE"):
        raise FareInputError(f"unknown vehicle {inp.pricing.vehicle!r}")
    if inp.fulfilment == PICKUP and inp.batch_position > 0:
        raise FareInputError("a pickup cannot be part of a bundle")


def weather_premium_bps(inp: FareInput) -> int:
    """The premium the platform pays for this weather, or zero when the reading is untrusted.

    A confidence below 0.5 means the weather feed is guessing, and paying a storm premium on
    a guess is how a weather vendor's outage becomes an expense line.
    """
    if inp.weather_confidence < WEATHER_CONFIDENCE_FLOOR:
        return 0
    return WEATHER_PREMIUM_BPS[inp.weather]


__all__ = ["FareInput", "FareInputError", "validate", "weather_premium_bps", "DELIVERY"]
