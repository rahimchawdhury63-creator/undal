/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

package app.undal.money

/**
 * Integer paisa arithmetic — the Kotlin third of the money law.
 *
 * Riders see the fare this computes on a 720p phone in the sun; the Worker sees
 * the same number when it settles; the Brain sees it when it audits. A single
 * paisa of disagreement between those three is a support call nobody can win, so
 * this object is a line-by-line mirror of `packages/money/src`, and the 110 000
 * vector differential fails the build on the first divergence.
 */
object Money {

    /** The largest amount a TiDB `BIGINT` and a safe JS integer agree on. */
    const val PAISA_MAX: Long = 9_007_199_254_740_991L

    private const val THIN_SPACE = "\u2009"
    private const val MINUS = "\u2212"
    private const val TAKA_SIGN = "\u09F3"

    /**
     * Multiply an integer amount by a basis-point rate, rounding ties to even.
     *
     * Ties-to-even rather than half-up because half-up always favours the party
     * with the larger share, and an unchosen bias is money taken without asking.
     */
    @JvmStatic
    fun applyRate(amountPaisa: Long, rateBps: Long): Long {
        val product = Math.multiplyExact(amountPaisa, rateBps)
        require(product in -PAISA_MAX..PAISA_MAX) { "applyRate: product left the safe range" }

        val negative = product < 0
        val magnitude = Math.abs(product)
        val quotient = magnitude / 10_000
        val remainder = magnitude % 10_000

        val rounded = when {
            remainder * 2 > 10_000 -> quotient + 1
            remainder * 2 < 10_000 -> quotient
            quotient % 2 == 0L -> quotient
            else -> quotient + 1
        }
        return if (negative) -rounded else rounded
    }

    /**
     * Floor a customer total to whole taka, returning `(total, delta)`.
     *
     * Negative amounts are refused: a refund returns what was charged, which
     * lives on the order row, not something re-derived from a negative floor.
     */
    @JvmStatic
    fun floorToTaka(amountPaisa: Long): Pair<Long, Long> {
        require(amountPaisa >= 0) { "floorToTaka: customer totals are never negative" }
        val remainder = amountPaisa % 100
        return (amountPaisa - remainder) to if (remainder == 0L) 0L else -remainder
    }

    /**
     * Format paisa as Bangladeshi taka: last three digits, then pairs.
     *
     * Implemented here rather than delegated to `NumberFormat` because ICU
     * versions differ between Android releases, and an invoice that groups
     * differently on a Nokia than on a Pixel is not an invoice.
     */
    @JvmStatic
    fun groupBdt(amountPaisa: Long): GroupedBdt {
        val negative = amountPaisa < 0
        val magnitude = Math.abs(amountPaisa)
        val taka = magnitude / 100
        val sub = magnitude % 100
        val digits = taka.toString()

        val grouped = if (digits.length <= 3) {
            digits
        } else {
            val head = digits.dropLast(3)
            val tail = digits.takeLast(3)
            val pairs = head.reversed().chunked(2).joinToString(",").reversed()
            "$pairs,$tail"
        }

        val decimal = "$grouped.${sub.toString().padStart(2, '0')}"
        val sign = if (negative) MINUS else ""
        return GroupedBdt(amount = "$sign$decimal", withSymbol = "$sign$TAKA_SIGN$THIN_SPACE$decimal", negative = negative)
    }

    /** The fixed-width form used in payment files: `BDT 54900.00`. */
    @JvmStatic
    fun machineBdt(amountPaisa: Long): String =
        "BDT " + groupBdt(amountPaisa).amount.replace(MINUS, "-").replace(",", "")
}

/**
 * A formatted amount, split so a caller can style the sign, the symbol and the
 * digits independently without re-parsing the string.
 */
data class GroupedBdt(val amount: String, val withSymbol: String, val negative: Boolean)
