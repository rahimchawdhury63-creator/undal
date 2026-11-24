"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The ride core, the delivery fee, and the Brain's copy of the money law.

The parity test at the end is the important one: `lib/paisa.py` is the Brain's own copy of
`apply_rate` because a Worker cannot import from a sibling directory at runtime. Four copies
of a rounding rule is a liability unless something compares them on every build, so this
imports the Python package the differential already holds to TypeScript and Kotlin, and
refuses to let the two disagree.
"""

from __future__ import annotations

import sys
import unittest
from dataclasses import replace
from pathlib import Path

from fare.constants import BICYCLE, LAUNCH_PRICING, MOTORBIKE, traffic_block_paisa
from fare.delivery_fee import delivery_fee_paisa, delivery_margin_paisa
from fare.ride_core import ride_core
from lib.paisa import apply_rate, floor_to_taka, group_bdt

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "packages" / "money" / "python"))

import undal_money  # noqa: E402


class TestRideCore(unittest.TestCase):
    def test_vector_01_by_hand(self):
        core = ride_core(3_800, 0, 10_000, LAUNCH_PRICING[MOTORBIKE])
        self.assertEqual(core.surged_base_paisa, 4_000)
        self.assertEqual(core.distance_paisa, 2_520)
        self.assertEqual(core.traffic_paisa, 0)
        self.assertEqual(core.total_paisa, 6_520)

    def test_inside_the_base_distance_the_distance_component_is_zero(self):
        core = ride_core(1_200, 0, 10_000, LAUNCH_PRICING[MOTORBIKE])
        self.assertEqual(core.distance_paisa, 0)
        self.assertEqual(core.total_paisa, 4_000)

    def test_distance_is_floored_to_the_paisa(self):
        # 2 001 m at ৳14/km is 1.4 paisa: floored to 1, never rounded to 1.4 or to 2.
        core = ride_core(2_001, 0, 10_000, LAUNCH_PRICING[MOTORBIKE])
        self.assertEqual(core.distance_paisa, 1)

    def test_distance_is_monotone_in_metres(self):
        pricing = LAUNCH_PRICING[MOTORBIKE]
        previous = -1
        for metres in range(0, 12_001, 25):
            value = ride_core(metres, 0, 10_000, pricing).distance_paisa
            self.assertGreaterEqual(value, previous, f"distance fell at {metres} m")
            previous = value

    def test_traffic_is_paid_in_whole_five_minute_blocks(self):
        pricing = LAUNCH_PRICING[MOTORBIKE]
        for seconds, blocks in ((0, 0), (4, 0), (299, 0), (300, 1), (599, 1), (600, 2), (1_320, 4)):
            self.assertEqual(
                ride_core(3_000, seconds, 10_000, pricing).traffic_paisa,
                blocks * 800,
                f"{seconds}s",
            )

    def test_a_surge_boundary_changes_the_base_only(self):
        pricing = LAUNCH_PRICING[MOTORBIKE]
        calm = ride_core(3_800, 0, 10_000, pricing)
        surged = ride_core(3_800, 0, 15_000, pricing)
        self.assertEqual(surged.surged_base_paisa, 6_000)
        self.assertEqual(surged.distance_paisa, calm.distance_paisa)
        self.assertEqual(surged.total_paisa, 6_000 + 2_520)

    def test_a_negative_distance_is_refused(self):
        with self.assertRaises(ValueError):
            ride_core(-1, 0, 10_000, LAUNCH_PRICING[MOTORBIKE])


class TestDeliveryFee(unittest.TestCase):
    def test_vector_01(self):
        pricing = LAUNCH_PRICING[MOTORBIKE]
        core = ride_core(3_800, 0, 10_000, pricing)
        fee = delivery_fee_paisa(core, "DELIVERY", pricing)
        self.assertEqual(fee, 7_042)
        self.assertEqual(delivery_margin_paisa(core, fee), 522)

    def test_pickup_pays_nothing(self):
        pricing = LAUNCH_PRICING[MOTORBIKE]
        core = ride_core(3_800, 0, 10_000, pricing)
        self.assertEqual(delivery_fee_paisa(core, "PICKUP", pricing), 0)
        self.assertEqual(delivery_margin_paisa(core, 0), -core.total_paisa)

    def test_the_floor_binds_on_a_short_trip(self):
        # The launch bicycle card can never hit the floor (its base fare alone is ৳25), so the
        # clamp is exercised against a card cheap enough for it to bind — which is the point:
        # the floor protects a configuration, not a fixed price.
        pricing = replace(LAUNCH_PRICING[BICYCLE], base_fare_paisa=1_000)
        core = ride_core(300, 0, 10_000, pricing)
        self.assertEqual(core.total_paisa, 1_000)
        self.assertEqual(delivery_fee_paisa(core, "DELIVERY", pricing), pricing.min_delivery_fee_paisa)

    def test_the_ceiling_binds_on_a_long_trip(self):
        pricing = LAUNCH_PRICING[MOTORBIKE]
        core = ride_core(12_000, 1_320, 22_000, pricing)
        self.assertEqual(delivery_fee_paisa(core, "DELIVERY", pricing), pricing.max_delivery_fee_paisa)

    def test_an_unknown_fulfilment_is_refused(self):
        pricing = LAUNCH_PRICING[MOTORBIKE]
        core = ride_core(3_800, 0, 10_000, pricing)
        with self.assertRaises(ValueError):
            delivery_fee_paisa(core, "TELEPORT", pricing)


class TestTheLaunchCards(unittest.TestCase):
    def test_the_traffic_block_is_derived_not_typed(self):
        self.assertEqual(traffic_block_paisa(12_000), 800)
        self.assertEqual(traffic_block_paisa(7_500), 500)
        self.assertEqual(LAUNCH_PRICING[MOTORBIKE].traffic_block_paisa, 800)
        self.assertEqual(LAUNCH_PRICING[BICYCLE].traffic_block_paisa, 500)

    def test_the_bicycle_radius_is_the_documented_one(self):
        self.assertEqual(LAUNCH_PRICING[BICYCLE].max_radius_m, 4_000)
        self.assertEqual(LAUNCH_PRICING[MOTORBIKE].max_radius_m, 12_000)


class TestPaisaParity(unittest.TestCase):
    def test_the_brain_agrees_with_the_package_the_differential_holds(self):
        amounts = [0, 1, 5, 15, 99, 100, 4_000, 6_520, 45_000, 52_406, 1_234_567, 9_007_199_254]
        rates = [0, 300, 500, 800, 1_500, 2_000, 4_000, 10_000, 15_000, 22_000]
        for amount in amounts:
            for rate in rates:
                self.assertEqual(
                    apply_rate(amount, rate),
                    undal_money.apply_rate(amount, rate),
                    f"amount={amount} rate={rate}",
                )

    def test_the_floors_and_the_grouping_agree(self):
        for amount in (0, 1, 99, 100, 101, 54_981, 1_234_500, 9_007_199_254_740):
            self.assertEqual(floor_to_taka(amount), undal_money.floor_to_taka(amount), f"amount={amount}")
            self.assertEqual(
                group_bdt(amount),
                undal_money.group_bdt(amount)["withSymbol"],
                f"amount={amount}",
            )

    def test_a_zero_tie_never_becomes_negative_zero(self):
        self.assertEqual(str(apply_rate(-5, 1_000)), "0")

    def test_the_refusals_match(self):
        with self.assertRaises(TypeError):
            apply_rate(1.5, 1_000)  # type: ignore[arg-type]
        with self.assertRaises(TypeError):
            apply_rate(1_000, 12.5)  # type: ignore[arg-type]
        with self.assertRaises(ValueError):
            floor_to_taka(-1)


if __name__ == "__main__":
    unittest.main()
