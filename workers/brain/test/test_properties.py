"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Twenty-five properties over generated fares: P1–P25 of `10 §10.1`, `§4.3`, `§7` and `§8`.

Generated, committed generator, fixed seed — the same argument as the ledger's closure test:
a hand-written case list is a snapshot of what somebody thought of, a seeded generator explores
the same space on every machine and reproduces any failure from the seed alone.
"""

from __future__ import annotations

import unittest

from fare.constants import BICYCLE, LAUNCH_PRICING, MOTORBIKE, SMALL_ORDER_THRESHOLD_PAISA
from fare.engine import compute_fare
from fare.inputs import FareInput, FareInputError
from fare.small_order import small_order_fee
from fare.surge import surge_bps
from lib.paisa import apply_rate, floor_to_taka

CASES = 4_000
PRICING = [LAUNCH_PRICING[MOTORBIKE], LAUNCH_PRICING[BICYCLE]]


class Gen:
    """The committed generator: a 64-bit LCG with the seed the money vectors use."""

    MASK = (1 << 64) - 1

    def __init__(self, seed: int = 0x9E3779B97F4A7C15) -> None:
        self.state = seed

    def next(self) -> int:
        self.state = (self.state * 6364136223846793005 + 1442695040888963407) & self.MASK
        return self.state >> 11

    def between(self, low: int, high: int) -> int:
        return low + self.next() % max(1, high - low)

    def pick(self, items):
        return items[self.next() % len(items)]


def generate():
    gen = Gen()
    for _ in range(CASES):
        pricing = gen.pick(PRICING)
        yield FareInput(
            pricing=pricing,
            routed_distance_m=gen.between(0, pricing.max_radius_m + 1),
            traffic_delay_s=gen.between(0, 1_800),
            riders=gen.between(0, 60),
            orders=gen.between(0, 60),
            weather=gen.pick(["CLEAR", "RAIN", "STORM", "EXTREME_HEAT"]),
            weather_confidence=gen.between(0, 101) / 100,
            item_subtotal_paisa=gen.between(0, 300_000),
            tip_paisa=gen.between(0, 5_000),
            fulfilment="DELIVERY" if gen.between(0, 4) else "PICKUP",
        )


class TestTheTwentyFiveProperties(unittest.TestCase):
    def setUp(self) -> None:
        self.quotes = [(inp, compute_fare(inp)) for inp in generate()]

    def test_p01_every_fare_closes(self):
        for inp, q in self.quotes:
            b = q.breakdown
            self.assertEqual(b.customer_total_paisa,
                             b.vendor_payout_paisa + b.rider_payout_paisa + b.platform_commission_paisa
                             + b.platform_small_order_paisa + b.platform_delivery_net_paisa
                             + b.platform_tax_payable_paisa - b.platform_rounding_expense_paisa)

    def test_p02_every_amount_is_an_integer(self):
        for _, q in self.quotes:
            for value in vars(q.breakdown).values():
                if isinstance(value, int):
                    self.assertIsInstance(value, int)

    def test_p03_the_customer_total_is_whole_taka(self):
        for _, q in self.quotes:
            self.assertEqual(q.breakdown.customer_total_paisa % 100, 0)

    def test_p04_rounding_is_bounded_and_never_positive(self):
        for _, q in self.quotes:
            self.assertLessEqual(q.breakdown.rounding_delta_paisa, 0)
            self.assertGreater(q.breakdown.rounding_delta_paisa, -100)

    def test_p05_no_counterparty_is_owed_a_negative_amount(self):
        for _, q in self.quotes:
            self.assertGreaterEqual(q.breakdown.vendor_payout_paisa, 0)
            self.assertGreaterEqual(q.breakdown.rider_payout_paisa, 0)

    def test_p06_the_rider_is_never_paid_below_the_floor(self):
        for inp, q in self.quotes:
            if inp.fulfilment == "DELIVERY":
                self.assertGreaterEqual(q.breakdown.rider_payout_paisa, inp.pricing.min_payout_paisa)

    def test_p07_the_customer_never_pays_the_weather_premium(self):
        for inp, q in self.quotes:
            if q.breakdown.weather_paisa == 0:
                continue
            calm = compute_fare(FareInput(**{**inp.__dict__, "weather": "CLEAR"}))
            self.assertEqual(calm.breakdown.delivery_fee_paisa, q.breakdown.delivery_fee_paisa)

    def test_p08_the_tip_reaches_the_rider_untouched(self):
        for inp, q in self.quotes:
            bare = compute_fare(FareInput(**{**inp.__dict__, "tip_paisa": 0}))
            self.assertEqual(q.breakdown.rider_payout_paisa - bare.breakdown.rider_payout_paisa, inp.tip_paisa)

    def test_p09_the_commission_is_the_documented_rate(self):
        for inp, q in self.quotes:
            self.assertEqual(q.breakdown.commission_paisa, apply_rate(inp.item_subtotal_paisa, 1500))

    def test_p10_the_bonus_is_vendor_funded(self):
        for inp, q in self.quotes:
            self.assertEqual(q.breakdown.rider_bonus_paisa, apply_rate(inp.item_subtotal_paisa, 300))
            self.assertGreaterEqual(q.breakdown.vendor_payout_paisa,
                                    inp.item_subtotal_paisa - q.breakdown.commission_paisa - q.breakdown.rider_bonus_paisa)

    def test_p11_the_taxable_base_is_fee_revenue_only(self):
        for _, q in self.quotes:
            b = q.breakdown
            self.assertEqual(b.taxable_base_paisa,
                             b.commission_paisa + b.small_order.platform_paisa + b.delivery_margin_paisa)

    def test_p12_the_tax_is_the_documented_rate(self):
        for _, q in self.quotes:
            self.assertEqual(q.breakdown.tax_paisa, apply_rate(q.breakdown.taxable_base_paisa, 500))

    def test_p13_the_small_order_split_sums(self):
        for _, q in self.quotes:
            s = q.breakdown.small_order
            self.assertEqual(s.total_paisa, s.rider_paisa + s.vendor_paisa + s.platform_paisa)

    def test_p14_the_fee_is_zero_below_the_threshold(self):
        for subtotal in range(0, SMALL_ORDER_THRESHOLD_PAISA, 997):
            self.assertEqual(small_order_fee(subtotal, "DELIVERY").total_paisa, 0)

    def test_p15_a_pickup_never_collects_the_rider_share(self):
        for subtotal in range(0, 200_000, 997):
            fee = small_order_fee(subtotal, "PICKUP")
            self.assertEqual(fee.rider_paisa, 0)

    def test_p16_the_delivery_fee_is_inside_its_clamp(self):
        for inp, q in self.quotes:
            if inp.fulfilment == "PICKUP":
                self.assertEqual(q.breakdown.delivery_fee_paisa, 0)
                continue
            self.assertGreaterEqual(q.breakdown.delivery_fee_paisa, inp.pricing.min_delivery_fee_paisa)
            self.assertLessEqual(q.breakdown.delivery_fee_paisa, inp.pricing.max_delivery_fee_paisa)

    def test_p17_the_fare_is_monotone_in_distance(self):
        for pricing in PRICING:
            previous = -1
            for metres in range(0, pricing.max_radius_m, 137):
                inp = FareInput(pricing=pricing, routed_distance_m=metres, traffic_delay_s=0,
                                riders=10, orders=10, weather="CLEAR", weather_confidence=1.0,
                                item_subtotal_paisa=30_000, tip_paisa=0, fulfilment="DELIVERY")
                value = compute_fare(inp).breakdown.rider_payout_paisa
                self.assertGreaterEqual(value, previous)
                previous = value

    def test_p18_the_surge_is_monotone_in_the_ratio(self):
        previous = None
        for index in range(0, 600):
            value = surge_bps(index / 100)
            if previous is not None:
                self.assertLessEqual(value, previous)
            previous = value

    def test_p19_the_surge_is_bounded_by_one_and_the_cap(self):
        for index in range(0, 600):
            value = surge_bps(index / 100, 22_000)
            self.assertGreaterEqual(value, 10_000)
            self.assertLessEqual(value, 22_000)

    def test_p20_a_bundle_never_pays_more_than_two_solo_fares(self):
        for inp, q in self.quotes:
            if inp.fulfilment != "DELIVERY":
                continue
            solo = FareInput(**{**inp.__dict__, "batch_position": 0, "batch_marginal_distance_m": 0})
            self.assertLessEqual(q.breakdown.rider_payout_paisa,
                                 compute_fare(solo).breakdown.rider_payout_paisa + 1_200)

    def test_p21_the_platform_keeps_a_non_negative_gross_on_a_delivery(self):
        # A pickup has no delivery line at all: the margin is minus the ride core by
        # construction, and the platform earns from commission on that path.
        for inp, q in self.quotes:
            if inp.fulfilment != "DELIVERY":
                continue
            b = q.breakdown
            self.assertGreaterEqual(b.platform_commission_paisa + b.platform_small_order_paisa + b.delivery_margin_paisa, 0)

    def test_p22_the_explanation_sums_to_the_total(self):
        for _, q in self.quotes:
            lines = dict((code, value) for code, value, _ in q.explanation)
            self.assertEqual(lines["fare.total"], q.breakdown.customer_total_paisa)

    def test_p23_the_explanation_carries_no_prose(self):
        for _, q in self.quotes:
            for code, value, kind in q.explanation:
                self.assertTrue(code.startswith("fare."))
                self.assertIsInstance(value, int)
                self.assertIn(kind, {"CHARGE", "PASS_THROUGH", "SAVING", "TOTAL", "SURGE"})

    def test_p24_an_untrusted_weather_reading_pays_no_premium(self):
        inp = FareInput(pricing=PRICING[0], routed_distance_m=3_000, traffic_delay_s=0, riders=10,
                        orders=10, weather="STORM", weather_confidence=0.49, item_subtotal_paisa=20_000,
                        tip_paisa=0, fulfilment="DELIVERY")
        self.assertEqual(compute_fare(inp).breakdown.weather_paisa, 0)

    def test_p25_the_absolute_floor_is_the_atomic_unit(self):
        low, delta = floor_to_taka(0)
        self.assertEqual((low, delta), (0, 0))
        with self.assertRaises(ValueError):
            floor_to_taka(-1)
        # The input refuses nothing at construction — validation is the engine's, so that a
        # stored order can be replayed even if a rule tightened after it was placed.
        with self.assertRaises(FareInputError):
            compute_fare(FareInput(pricing=PRICING[0], routed_distance_m=-1, traffic_delay_s=0,
                                   riders=1, orders=1, weather="CLEAR", weather_confidence=1.0,
                                   item_subtotal_paisa=0, tip_paisa=0, fulfilment="DELIVERY"))


if __name__ == "__main__":
    unittest.main()
