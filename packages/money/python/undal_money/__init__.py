"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The Python third of the money law: integer paisa, one rounding point, one floor,
one grouping rule.

The Brain recomputes fares and settlements when it explains a decision, and the
nightly integrity walk re-derives the ledger. If those numbers differed from the
Worker's by a paisa, the reconciliation report would be noise, so the arithmetic
here is a line-by-line mirror of `packages/money/src` and a 110 000-vector
differential test proves it.
"""

from __future__ import annotations

PAISA_MAX = 2**53 - 1
THIN_SPACE = "\u2009"


def apply_rate(amount_paisa: int, rate_bps: int) -> int:
    """Multiply an integer amount by a basis-point rate, rounding ties to even.

    Banker's rounding for the same reason as every other implementation: half-up
    always favours the larger share, and a bias that nobody chose is money the
    platform took without agreeing to.
    """
    if not isinstance(amount_paisa, int) or not isinstance(rate_bps, int):
        raise TypeError("apply_rate takes integer paisa and integer basis points")

    product = amount_paisa * rate_bps
    if abs(product) > PAISA_MAX:
        raise ValueError("apply_rate: intermediate product left the safe integer range")

    negative = product < 0
    magnitude = abs(product)
    quotient, remainder = divmod(magnitude, 10_000)

    if remainder * 2 > 10_000:
        rounded = quotient + 1
    elif remainder * 2 < 10_000:
        rounded = quotient
    else:
        rounded = quotient if quotient % 2 == 0 else quotient + 1

    return -rounded if negative else rounded


def floor_to_taka(amount_paisa: int) -> tuple[int, int]:
    """Floor a customer total to whole taka, returning `(total, delta)`.

    Negative amounts are refused: a refund returns the exact amount that was
    charged, which is read from the order row rather than re-derived.
    """
    if not isinstance(amount_paisa, int):
        raise TypeError("floor_to_taka takes integer paisa")
    if amount_paisa < 0:
        raise ValueError("floor_to_taka: customer totals are never negative")

    remainder = amount_paisa % 100
    return amount_paisa - remainder, (0 if remainder == 0 else -remainder)


def group_bdt(amount_paisa: int) -> dict[str, object]:
    """Format paisa as Bangladeshi taka: last three digits, then pairs."""
    if not isinstance(amount_paisa, int):
        raise TypeError("group_bdt takes integer paisa")

    negative = amount_paisa < 0
    magnitude = abs(amount_paisa)
    taka, sub = divmod(magnitude, 100)

    digits = str(taka)
    if len(digits) <= 3:
        grouped = digits
    else:
        head, tail = digits[:-3], digits[-3:]
        pairs: list[str] = []
        end = len(head)
        while end > 0:
            pairs.insert(0, head[max(0, end - 2) : end])
            end -= 2
        grouped = ",".join(pairs) + "," + tail

    decimal = f"{grouped}.{sub:02d}"
    sign = "\u2212" if negative else ""
    return {
        "amount": f"{sign}{decimal}",
        "withSymbol": f"{sign}\u09f3{THIN_SPACE}{decimal}",
        "negative": negative,
    }


def machine_bdt(amount_paisa: int) -> str:
    """The fixed-width form used in payment files: `BDT 54900.00`."""
    grouped = group_bdt(amount_paisa)["amount"]
    return "BDT " + str(grouped).replace("\u2212", "-").replace(",", "")
