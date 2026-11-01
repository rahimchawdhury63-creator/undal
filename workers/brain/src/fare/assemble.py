"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Assembly and the closure identity — `10 §9`, `§10`, `§10.1`.

The identity is the whole point of this module. Every component is computed once, added up in
two different ways, and compared before a quote leaves the Brain:

    customer_total == vendor + rider + commission + small_order_platform
                    + delivery_margin − weather + tax − rounding_expense

If it fails, the request fails with `MONEY_INVOICE_UNBALANCED` and no order is written. Undal
refuses to quote before it will produce arithmetic it cannot defend — which is a strange way to
run a business until you meet a cash business whose float does not reconcile at closing time.
"""

from __future__ import annotations

from dataclasses import dataclass

from fare.constants import DELIVERY_MARGIN_BPS, TAX_BPS
from fare.delivery_fee import delivery_fee_paisa, delivery_margin_paisa
from fare.inputs import FareInput
from fare.rider_payout import bundle_adjustment, rider_payout
from fare.ride_core import RideCore, ride_core
from fare.small_order import SmallOrderFee, small_order_fee
from lib.paisa import apply_rate, floor_to_taka


class ClosureViolation(AssertionError):
    """The arithmetic does not close. Raised before a quote is returned, never after."""


@dataclass(frozen=True)
class FareBreakdown:
    """Every number a quote contains, so an explanation and a receipt need no recomputation."""

    core: RideCore
    delivery_fee_paisa: int
    delivery_margin_paisa: int
    small_order: SmallOrderFee
    commission_paisa: int
    rider_bonus_paisa: int
    taxable_base_paisa: int
    tax_paisa: int
    weather_paisa: int
    bundle_paisa: int
    tip_paisa: int
    customer_total_paisa: int
    rounding_delta_paisa: int
    vendor_payout_paisa: int
    rider_payout_paisa: int
    platform_commission_paisa: int
    platform_small_order_paisa: int
    platform_delivery_net_paisa: int
    platform_weather_expense_paisa: int
    platform_tax_payable_paisa: int
    platform_rounding_expense_paisa: int


def assemble(inp: FareInput, core: RideCore, surge_bps: int) -> FareBreakdown:
    """Compute every component, then assert the identity before returning anything."""
    fee = delivery_fee_paisa(core, inp.fulfilment, inp.pricing)
    margin = delivery_margin_paisa(core, fee)
    order_fee = small_order_fee(inp.item_subtotal_paisa, inp.fulfilment)

    commission = apply_rate(inp.item_subtotal_paisa, inp.commission_bps)
    bonus = apply_rate(inp.item_subtotal_paisa, inp.rider_bonus_bps)

    taxable_base = commission + order_fee.platform_paisa + margin
    tax = apply_rate(taxable_base, TAX_BPS)

    weather = apply_rate(core.total_paisa, _weather_bps(inp))
    bundle = bundle_adjustment(core, inp.pricing, inp.batch_position, inp.batch_marginal_distance_m)

    rider = rider_payout(
        core,
        inp.pricing,
        weather_paisa=weather,
        bundle_paisa=bundle,
        bonus_paisa=bonus,
        small_order_paisa=order_fee.rider_paisa,
        tip_paisa=inp.tip_paisa,
    )

    pre_round = (
        inp.item_subtotal_paisa
        + fee
        + order_fee.total_paisa
        + tax
        + inp.tip_paisa
    )
    customer_total, rounding_delta = floor_to_taka(pre_round)

    vendor_payout = inp.item_subtotal_paisa - commission - bonus + order_fee.vendor_paisa
    rounding_expense = -rounding_delta

    # The delivery line's residual: what the customer paid for the delivery less what the
    # rider is paid for it. This is the only figure that makes the identity true in every
    # case — a bundle moves the rider's fare off the ride core, and the minimum-payout floor
    # moves it further. `10 §10.1` prints this as `platform_delivery_margin - weather`, which
    # is the same number whenever the fare equals the core plus the weather premium; the
    # residual is that statement without the assumption (D58).
    delivery_net = fee - rider.fare_paisa

    # The identity, with every term named so a failure says which line is wrong.
    lhs = customer_total
    rhs = (
        vendor_payout
        + rider.total_paisa
        + commission
        + order_fee.platform_paisa
        + delivery_net
        + tax
        - rounding_expense
    )
    if lhs != rhs:
        raise ClosureViolation(
            f"fare does not close: customer={lhs} components={rhs} drift={lhs - rhs} "
            f"(vendor={vendor_payout} rider={rider.total_paisa} commission={commission} "
            f"small={order_fee.platform_paisa} delivery_net={delivery_net} margin={margin} "
              f"weather={weather} tax={tax} "
            f"rounding={rounding_expense}, surge={surge_bps} bps)"
        )

    if rider.total_paisa < 0 or vendor_payout < 0:
        raise ClosureViolation("a counterparty cannot be owed a negative amount")

    return FareBreakdown(
        core=core,
        delivery_fee_paisa=fee,
        delivery_margin_paisa=margin,
        small_order=order_fee,
        commission_paisa=commission,
        rider_bonus_paisa=bonus,
        taxable_base_paisa=taxable_base,
        tax_paisa=tax,
        weather_paisa=weather,
        bundle_paisa=bundle,
        tip_paisa=inp.tip_paisa,
        customer_total_paisa=customer_total,
        rounding_delta_paisa=rounding_delta,
        vendor_payout_paisa=vendor_payout,
        rider_payout_paisa=rider.total_paisa,
        platform_commission_paisa=commission,
        platform_small_order_paisa=order_fee.platform_paisa,
        platform_delivery_net_paisa=delivery_net,
        platform_weather_expense_paisa=weather,
        platform_tax_payable_paisa=tax,
        platform_rounding_expense_paisa=rounding_expense,
    )


def _weather_bps(inp: FareInput) -> int:
    """The premium rate for this input's weather, zero when the reading is not trusted."""
    from fare.inputs import weather_premium_bps

    return weather_premium_bps(inp)


__all__ = ["FareBreakdown", "ClosureViolation", "assemble", "DELIVERY_MARGIN_BPS"]
