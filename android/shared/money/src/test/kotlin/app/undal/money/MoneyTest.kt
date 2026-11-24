/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

package app.undal.money

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

/**
 * The Kotlin side of the money law, checked against the same worked examples the
 * TypeScript and Python suites use, so a divergence fails here before it can
 * reach a rider's phone.
 */
class MoneyTest {

    @Test
    fun `platform margin on the worked vector`() {
        assertEquals(3_600L, Money.applyRate(45_000, 800))
        assertEquals(524L, Money.applyRate(8_725, 600))
    }

    @Test
    fun `ties round to even in both directions`() {
        assertEquals(62L, Money.applyRate(1_250, 500))
        assertEquals(188L, Money.applyRate(3_750, 500))
        assertEquals(2L, Money.applyRate(3, 5_000))
        assertEquals(0L, Money.applyRate(1, 5_000))
    }

    @Test
    fun `tax line matches the fare sheet`() {
        assertEquals(439L, Money.applyRate(8_772, 500))
        assertEquals(522L, Money.applyRate(10_432, 500))
        assertEquals(-439L, Money.applyRate(-8_772, 500))
    }

    @Test
    fun `flooring leaves whole taka and a delta of at most 99 paisa`() {
        assertEquals(54_900L to -81L, Money.floorToTaka(54_981))
        assertEquals(50_000L to 0L, Money.floorToTaka(50_000))
        assertThrows(IllegalArgumentException::class.java) { Money.floorToTaka(-1) }
    }

    @Test
    fun `lakh and crore grouping`() {
        assertEquals("1,000.00", Money.groupBdt(100_000).amount)
        assertEquals("1,00,000.00", Money.groupBdt(10_000_000).amount)
        assertEquals("1,00,00,000.00", Money.groupBdt(1_000_000_000).amount)
        assertEquals("\u2212\u09F3\u200915.00", Money.groupBdt(-1_500).withSymbol)
        assertEquals("BDT 54900.00", Money.machineBdt(5_490_000))
    }
}
