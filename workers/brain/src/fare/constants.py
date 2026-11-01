"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The launch configuration, exactly as `10 §2` prints it.

Every one of these is a default: the live value comes from `zone_pricing` (temporal, per zone,
per vehicle) or `platform_config`, and the engine takes the resolved values in its input. The
table exists so that a Brain with no configuration at all still computes a defensible fare,
and so the forty vectors have something to compare against that is not a database.

`traffic_block_paisa` looks like a constant and is not: it is derived from the target hourly
rate and a coverage factor (`10 §2.1`), and the derivation is repeated here as a function
rather than a comment, because a rate that is ৳8 in Sylhet and should be ৳8 there for a
reason is a rate that will be edited to ৳10 by someone who cannot see the reason.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict

from lib.paisa import apply_rate

#: The traffic block that every delay is measured in, and the coverage it restores.
TRAFFIC_BLOCK_S = 300
TRAFFIC_COVERAGE_BPS = 8_000

MOTORBIKE = "MOTORBIKE"
BICYCLE = "BICYCLE"


def traffic_block_paisa(target_hourly_paisa: int, coverage_bps: int = TRAFFIC_COVERAGE_BPS) -> int:
    """The compensation for one 5-minute block: an hour's target, a twelfth of it, 80% of it.

    `10 §2.1`: `round((block_s / 3600) × hourly × coverage)`, which is 800 paisa for a
    motorbike's ৳120/h and 500 for a bicycle's ৳75/h. Expressed as two rates through the one
    rounding point rather than with a float, so the figure cannot differ by a paisa between
    the Brain and the invoice.
    """
    share_of_hour = apply_rate(target_hourly_paisa, TRAFFIC_BLOCK_S * 10_000 // 3_600)
    return apply_rate(share_of_hour, coverage_bps)


@dataclass(frozen=True)
class VehiclePricing:
    """One vehicle class's rate card, as `zone_pricing` resolves it for a zone and a time."""

    vehicle: str
    base_fare_paisa: int
    base_distance_m: int
    per_km_paisa: int
    max_radius_m: int
    min_payout_paisa: int
    surge_cap_bps: int
    traffic_block_paisa: int
    min_delivery_fee_paisa: int
    max_delivery_fee_paisa: int


#: The launch cards. Bicycle's 4 km radius is a dispatch rule as much as a pricing one.
LAUNCH_PRICING: Dict[str, VehiclePricing] = {
    MOTORBIKE: VehiclePricing(
        vehicle=MOTORBIKE,
        base_fare_paisa=4_000,
        base_distance_m=2_000,
        per_km_paisa=1_400,
        max_radius_m=12_000,
        min_payout_paisa=4_000,
        surge_cap_bps=22_000,
        traffic_block_paisa=traffic_block_paisa(12_000),
        min_delivery_fee_paisa=2_500,
        max_delivery_fee_paisa=22_000,
    ),
    BICYCLE: VehiclePricing(
        vehicle=BICYCLE,
        base_fare_paisa=2_500,
        base_distance_m=2_000,
        per_km_paisa=800,
        max_radius_m=4_000,
        min_payout_paisa=2_500,
        surge_cap_bps=22_000,
        traffic_block_paisa=traffic_block_paisa(7_500),
        min_delivery_fee_paisa=2_000,
        max_delivery_fee_paisa=12_000,
    ),
}

#: Platform-wide rates, in basis points.
COMMISSION_BPS = 1_500
RIDER_BONUS_BPS = 300
DELIVERY_MARGIN_BPS = 800
TAX_BPS = 500

#: Weather premiums, `10 §7`. The customer never pays these; the platform does.
WEATHER_PREMIUM_BPS: Dict[str, int] = {
    "CLEAR": 0,
    "RAIN": 2_000,
    "STORM": 4_000,
    "EXTREME_HEAT": 1_500,
}

#: Below this confidence the weather reading is not trusted and no premium is paid.
WEATHER_CONFIDENCE_FLOOR = 0.5

#: The small-order fee and its three-way split, `10 §8`.
SMALL_ORDER_THRESHOLD_PAISA = 10_000
SMALL_ORDER_FEE_PAISA = 2_500
SMALL_ORDER_RIDER_PAISA = 500
SMALL_ORDER_VENDOR_PAISA = 500
SMALL_ORDER_PLATFORM_PAISA = SMALL_ORDER_FEE_PAISA - SMALL_ORDER_RIDER_PAISA - SMALL_ORDER_VENDOR_PAISA

#: The pickup fee: no rider exists, so the rider's share is not collected at all.
SMALL_ORDER_PICKUP_FEE_PAISA = SMALL_ORDER_FEE_PAISA - SMALL_ORDER_RIDER_PAISA

#: Bundling, `10 §11`.
BUNDLE_BASE_BPS = 5_500
BUNDLE_BONUS_PAISA = 1_200
BUNDLE_CREDIT_BPS = 3_000
BUNDLE_CREDIT_CAP_PAISA = 2_500

#: The quote is valid for this long; the Brain refuses to answer outside its budget.
FARE_BUDGET_MS = 400
