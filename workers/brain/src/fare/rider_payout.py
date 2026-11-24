"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

What the rider earns — `10 §7`, `§11` and the pass-throughs of `§10`.

Four ideas, and the fourth is the one that makes short deliveries possible at all:

1. the weather premium is paid on the ride core and borne entirely by the platform;
2. a bundled order's fare is rebuilt on its marginal detour, not on a full route;
3. the fare is floored at the vehicle's minimum payout, so a 400 m delivery still pays ৳40;
4. the rider keeps every pass-through — bonus, order-fee share, tip — untouched.
"""

from __future__ import annotations

from dataclasses import dataclass

from fare.constants import BUNDLE_BASE_BPS, BUNDLE_BONUS_PAISA, VehiclePricing
from fare.ride_core import RideCore
from lib.paisa import apply_rate


@dataclass(frozen=True)
class RiderPayout:
    """Every component the rider can see on their own screen, and the total they are owed."""

    fare_paisa: int
    weather_paisa: int
    bundle_paisa: int
    bonus_paisa: int
    small_order_paisa: int
    tip_paisa: int
    total_paisa: int


def bundle_adjustment(
    core: RideCore,
    pricing: VehiclePricing,
    batch_position: int,
    marginal_distance_m: int,
) -> int:
    """The delta applied to the fare for a non-first order in a bundle.

    The rider is already at the vendor and already heading that way, so the fixed cost is
    genuinely shared: the base fare is reduced to 55%, the distance component is computed on
    the marginal detour instead of a full leg, and a flat bonus is added. `10 §12.6` shows the
    construction raising the rider's take per kilometre from ৳17.00 to ৳20.82 — which is the
    only reason a rider accepts a second order.
    """
    if batch_position == 0:
        return 0

    reduced_base = apply_rate(pricing.base_fare_paisa, BUNDLE_BASE_BPS)
    marginal_m = max(0, marginal_distance_m - pricing.base_distance_m)
    marginal_distance = (marginal_m * pricing.per_km_paisa) // 1000

    target = reduced_base + marginal_distance + BUNDLE_BONUS_PAISA
    return target - core.total_paisa


def rider_payout(
    core: RideCore,
    pricing: VehiclePricing,
    *,
    weather_paisa: int,
    bundle_paisa: int,
    bonus_paisa: int,
    small_order_paisa: int,
    tip_paisa: int,
) -> RiderPayout:
    """Assemble the rider's payout, with the minimum-payout floor applied to the fare only.

    The floor applies to `fare`, not to the total: a tip is the customer's gift and must never
    be the thing that lifts a fare above the guarantee, because then the platform could claim
    it had paid the guarantee while the rider's own tip did the work.
    """
    fare = max(pricing.min_payout_paisa, core.total_paisa + weather_paisa + bundle_paisa)
    return RiderPayout(
        fare_paisa=fare,
        weather_paisa=weather_paisa,
        bundle_paisa=bundle_paisa,
        bonus_paisa=bonus_paisa,
        small_order_paisa=small_order_paisa,
        tip_paisa=tip_paisa,
        total_paisa=fare + bonus_paisa + small_order_paisa + tip_paisa,
    )


def bundle_customer_credit(delivery_fee_paisa: int, credit_bps: int, cap_paisa: int) -> int:
    """What each customer in a bundle gets back: 30% of their fee, capped.

    They were quoted a solo fee because bundling was not known at checkout, and the bundle
    made the delivery cheaper to perform. Returning part of that is cheap, honest and the only
    thing in this market that treats an efficiency gain as the customer's too.
    """
    from lib.paisa import apply_rate as rate  # local import keeps the module's import graph flat

    return min(rate(delivery_fee_paisa, credit_bps), cap_paisa)
