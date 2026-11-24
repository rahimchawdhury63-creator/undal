"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The ride core — `10 §5`. What the trip itself is worth, before the platform's margin.

Three components and no more: the base fare scaled by surge, the distance beyond the included
base distance, and compensation for congestion in whole five-minute blocks. Everything the
rider earns that is not one of those three is a pass-through and lives elsewhere, which is why
this module has no knowledge of tips, bonuses or fees.
"""

from __future__ import annotations

from dataclasses import dataclass

from fare.constants import TRAFFIC_BLOCK_S, VehiclePricing
from lib.paisa import apply_rate


@dataclass(frozen=True)
class RideCore:
    """The three components and their sum, kept separate so an explanation can name them."""

    surged_base_paisa: int
    distance_paisa: int
    traffic_paisa: int
    total_paisa: int


def ride_core(routed_distance_m: int, traffic_delay_s: int, surge_bps: int, pricing: VehiclePricing) -> RideCore:
    """Compute the core for a trip.

    Distance is floored to the whole paisa, not rounded: at ৳14/km the most a rider can lose
    to the floor is 1.4 paisa, while flooring keeps the function monotone in integer metres
    with no plateaus — which removes an entire class of "the fare went down when I moved
    further away" reports.
    """
    if routed_distance_m < 0:
        raise ValueError(f"ride_core: negative distance {routed_distance_m}")
    if traffic_delay_s < 0:
        raise ValueError(f"ride_core: negative traffic delay {traffic_delay_s}")

    surged_base = apply_rate(pricing.base_fare_paisa, surge_bps)

    billable_m = max(0, routed_distance_m - pricing.base_distance_m)
    distance = (billable_m * pricing.per_km_paisa) // 1000

    blocks = traffic_delay_s // TRAFFIC_BLOCK_S
    traffic = blocks * pricing.traffic_block_paisa

    return RideCore(
        surged_base_paisa=surged_base,
        distance_paisa=distance,
        traffic_paisa=traffic,
        total_paisa=surged_base + distance + traffic,
    )
