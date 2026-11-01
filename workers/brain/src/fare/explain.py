"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The explanation behind a fare — `10 §10`, and the transparency sheet the customer sees.

Every line is a **code and an amount**, never a sentence. The Brain is a Python Worker with no
access to the translation catalogue, and the rule that no user-facing string is hardcoded
applies to it as much as to the storefront: a fare explanation that ships English in a Bangla
build is a bug that only appears on the device of the customer who complains.

The codes are stable because they are contract: the receipt, the support console and the
"why is my fee ৳78?" sheet all render the same list.
"""

from __future__ import annotations

from typing import List, Tuple


def explain(breakdown, surge_bps: int, inp) -> Tuple[Tuple[str, int, str], ...]:
    """Return `(code, paisa, kind)` lines in the order a customer reads them.

    `kind` is `CHARGE`, `PASS_THROUGH` or `SAVING`, which is how the apps group the sheet: the
    charges first, then the part that belongs to somebody else, then anything given back.
    """
    lines: List[Tuple[str, int, str]] = [
        ("fare.base", breakdown.core.surged_base_paisa, "CHARGE"),
        ("fare.distance", breakdown.core.distance_paisa, "CHARGE"),
        ("fare.traffic", breakdown.core.traffic_paisa, "CHARGE"),
        ("fare.delivery", breakdown.delivery_fee_paisa, "CHARGE"),
        ("fare.order_fee", breakdown.small_order.total_paisa, "CHARGE"),
        ("fare.tax", breakdown.tax_paisa, "CHARGE"),
        ("fare.tip", breakdown.tip_paisa, "PASS_THROUGH"),
        ("fare.rounding", breakdown.rounding_delta_paisa, "SAVING"),
        ("fare.total", breakdown.customer_total_paisa, "TOTAL"),
        ("fare.rider_earns", breakdown.rider_payout_paisa, "PASS_THROUGH"),
        ("fare.vendor_earns", breakdown.vendor_payout_paisa, "PASS_THROUGH"),
        ("fare.platform_keeps", breakdown.platform_commission_paisa + breakdown.platform_small_order_paisa
         + breakdown.platform_delivery_net_paisa - breakdown.platform_weather_expense_paisa
         - breakdown.platform_rounding_expense_paisa, "PASS_THROUGH"),
    ]

    # A surge line only when there is a surge: a 1.00x row on every receipt trains people to
    # ignore the sheet, and the row that matters is the one that is sometimes absent.
    if surge_bps > 10_000:
        lines.insert(0, ("fare.surge", surge_bps, "SURGE"))

    return tuple(lines)
