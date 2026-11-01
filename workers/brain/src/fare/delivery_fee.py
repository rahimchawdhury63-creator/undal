"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The customer's delivery fee — `10 §6`. The ride core plus the platform's 8%, clamped.

The customer does not pay the weather premium. In rain the platform pays the rider 20% more
while still collecting 8%, so the delivery line runs at −12% of core; in a storm, −32%. That
is the business model rather than a leak, and the ledger shows it as
`PLATFORM:EXPENSE_WEATHER_SUBSIDY` so nobody has to infer it from a revenue number.
"""

from __future__ import annotations

from fare.constants import DELIVERY_MARGIN_BPS, VehiclePricing
from fare.ride_core import RideCore
from lib.paisa import apply_rate

PICKUP = "PICKUP"
DELIVERY = "DELIVERY"


def delivery_fee_paisa(core: RideCore, fulfilment: str, pricing: VehiclePricing) -> int:
    """The fee charged for the delivery, or zero for a pickup.

    The clamp is not cosmetic: the minimum stops a sub-৳25 fee on a 300 m trip from failing
    to cover the rider's floor, and the maximum caps the customer's exposure on a long trip,
    with the platform absorbing the difference. Hitting the cap is an admin signal — it
    usually means the zone's radius is set too wide.
    """
    if fulfilment == PICKUP:
        return 0
    if fulfilment != DELIVERY:
        raise ValueError(f"delivery_fee_paisa: unknown fulfilment {fulfilment!r}")

    margin = apply_rate(core.total_paisa, DELIVERY_MARGIN_BPS)
    fee = core.total_paisa + margin
    return max(pricing.min_delivery_fee_paisa, min(pricing.max_delivery_fee_paisa, fee))


def delivery_margin_paisa(core: RideCore, fee_paisa: int) -> int:
    """The platform's gross on the delivery line: the fee less the core.

    Computed as a difference rather than as 8% of core, because the clamp can move the fee in
    either direction and the margin is whatever the customer actually paid above the core —
    which is also the figure the tax is levied on.
    """
    return fee_paisa - core.total_paisa
