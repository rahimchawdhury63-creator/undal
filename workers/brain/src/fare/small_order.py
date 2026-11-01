"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The order fee and its three-way split — `10 §8`.

The fee applies at or *above* ৳100, which reads backwards and is what the brief specifies. The
customer-facing label is therefore "Order fee" / "অর্ডার ফি", and this module keeps the brief's
name so the mapping back to the document is unambiguous.

Two rules that only exist because a real cash business has them: the threshold is evaluated on
the **post-discount** subtotal, because charging a fee on a price nobody paid is indefensible;
and on a pickup there is no rider, so the rider's share is not collected at all — the customer
pays ৳20 instead of ৳25.
"""

from __future__ import annotations

from dataclasses import dataclass

from fare.constants import (
    DELIVERY,
    SMALL_ORDER_FEE_PAISA,
    SMALL_ORDER_PICKUP_FEE_PAISA,
    SMALL_ORDER_PLATFORM_PAISA,
    SMALL_ORDER_RIDER_PAISA,
    SMALL_ORDER_THRESHOLD_PAISA,
    SMALL_ORDER_VENDOR_PAISA,
)


@dataclass(frozen=True)
class SmallOrderFee:
    """The fee and its split. The split is asserted to sum to the total, always."""

    total_paisa: int
    rider_paisa: int
    vendor_paisa: int
    platform_paisa: int

    def __post_init__(self) -> None:
        if self.total_paisa != self.rider_paisa + self.vendor_paisa + self.platform_paisa:
            raise AssertionError(
                f"small-order split does not sum: {self.total_paisa} != "
                f"{self.rider_paisa}+{self.vendor_paisa}+{self.platform_paisa}"
            )


NONE = SmallOrderFee(total_paisa=0, rider_paisa=0, vendor_paisa=0, platform_paisa=0)


def small_order_fee(item_subtotal_paisa: int, fulfilment: str) -> SmallOrderFee:
    """The fee for an order, which is zero below the threshold and on no other path."""
    if item_subtotal_paisa < SMALL_ORDER_THRESHOLD_PAISA:
        return NONE

    if fulfilment == DELIVERY:
        return SmallOrderFee(
            total_paisa=SMALL_ORDER_FEE_PAISA,
            rider_paisa=SMALL_ORDER_RIDER_PAISA,
            vendor_paisa=SMALL_ORDER_VENDOR_PAISA,
            platform_paisa=SMALL_ORDER_PLATFORM_PAISA,
        )

    # A pickup: no rider exists, so the rider's ৳5 is not collected from the customer at all.
    return SmallOrderFee(
        total_paisa=SMALL_ORDER_PICKUP_FEE_PAISA,
        rider_paisa=0,
        vendor_paisa=SMALL_ORDER_VENDOR_PAISA,
        platform_paisa=SMALL_ORDER_PICKUP_FEE_PAISA - SMALL_ORDER_VENDOR_PAISA,
    )
