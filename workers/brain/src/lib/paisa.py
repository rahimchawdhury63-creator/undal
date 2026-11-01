"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Integer paisa arithmetic — the Brain's copy of the money law.

This is a fourth copy of `apply_rate` (TypeScript, Python, Kotlin, and this one) and it
exists because a Worker cannot import from a sibling directory at runtime: what ships is
`workers/brain/src`. The differential is what keeps four copies honest — the same seeded
vectors run through every implementation, and this module is included in that comparison by
`test/test_paisa_parity.py`, which imports both and refuses to let them drift.

Nothing here is float. The one float in the fare engine is the supply–demand ratio, and it is
quantised to basis points in `fare/surge.py` before it touches money.
"""

from __future__ import annotations

from typing import Tuple

BPS = 10_000
TAKA = 100
PAISA_MAX = 9_007_199_254_740_991


def apply_rate(amount_paisa: int, rate_bps: int) -> int:
    """Multiply by a basis-point rate, rounding once, ties to even.

    Banker's rounding rather than half-up because half-up is biased towards the party with
    the larger share, which over a year of orders is money nobody agreed to. Every rate in
    the platform — commission, tax, bonus, margin, premium, bundle — comes through here, and
    there is exactly one rounding point per component.
    """
    if not isinstance(amount_paisa, int) or isinstance(amount_paisa, bool):
        raise TypeError(f"apply_rate: amount must be integer paisa, got {amount_paisa!r}")
    if not isinstance(rate_bps, int) or isinstance(rate_bps, bool):
        raise TypeError(f"apply_rate: rate must be integer basis points, got {rate_bps!r}")

    product = amount_paisa * rate_bps
    if not -PAISA_MAX <= product <= PAISA_MAX:
        raise OverflowError("apply_rate: intermediate product left the safe integer range")

    negative = product < 0
    magnitude = abs(product)
    quotient, remainder = divmod(magnitude, BPS)

    twice = remainder * 2
    if twice > BPS:
        quotient += 1
    elif twice == BPS and quotient % 2 == 1:
        quotient += 1

    return -quotient if negative else quotient


def floor_to_taka(amount_paisa: int) -> Tuple[int, int]:
    """Floor a total to whole taka, returning the total and the (negative) delta.

    Applied once, at the end, to the customer's total. A refund returns the stored order
    amount rather than a floored negative, which is why a negative input is refused: a
    refund is a document, not an arithmetic operation.
    """
    if not isinstance(amount_paisa, int) or isinstance(amount_paisa, bool):
        raise TypeError(f"floor_to_taka: expected integer paisa, got {amount_paisa!r}")
    if amount_paisa < 0:
        raise ValueError(f"floor_to_taka: customer totals are never negative, got {amount_paisa}")

    remainder = amount_paisa % TAKA
    return amount_paisa - remainder, (-remainder if remainder else 0)


def group_bdt(amount_paisa: int) -> str:
    """Format paisa as taka with Bangladeshi grouping: last three digits, then pairs.

    `৳1,23,456.00` rather than `৳123,456.00` — the lakh/crore grouping every Bangladeshi
    reads without thinking, and the reason this is hand-written instead of delegated to a
    locale, whose ICU data differs by runtime.
    """
    negative = amount_paisa < 0
    magnitude = abs(amount_paisa)
    taka, paisa = divmod(magnitude, TAKA)
    digits = str(taka)
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        digits = ",".join(groups) + "," + tail
    # The thin space after the taka sign is part of the house style (`10 §3`): the sign is a
    # symbol, not a word, and `৳320.00` sets too tight against a two-line label.
    sign = "\u2212" if negative else ""
    return f"{sign}\u09f3\u2009{digits}.{paisa:02d}"
