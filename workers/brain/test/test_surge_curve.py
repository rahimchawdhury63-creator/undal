"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The surge curve: twenty thousand and one points, four properties, one table.

Why a sweep of 20 001 rather than the twelve rows somebody typed: the table proves the
function matches the document at the places the document looked, and the sweep proves it is
monotone, continuous and bounded *everywhere* — which is the property that stops a rider
from being able to game the boundary by going offline for ninety seconds.
"""

from __future__ import annotations

import unittest

from fare.surge import (
    SURGE_MODERATE_MAX,
    SURGE_MODERATE_MIN,
    SURGE_NONE,
    SURGE_SEVERE_MAX,
    SURGE_SEVERE_MIN,
    published_surge_bps,
    surge_bps,
    supply_demand_ratio,
)

SWEEP_POINTS = 20_001


class TestTheTabulatedCurve(unittest.TestCase):
    def test_the_documented_points(self):
        # `10 §4.3`, where the table and its own formula agree. SDR 0.50 is excluded here and
        # covered by the next test: the table prints 1.48x and the printed function returns
        # 147.50x hundredths, which is a 50 bps disagreement in the document, not in the code.
        expected = {
            0.00: 22_000,
            0.05: 21_300,
            0.10: 20_600,
            0.15: 19_900,
            0.20: 19_200,
            0.25: 18_500,
            0.30: 17_800,
            0.35: 17_100,
            0.40: 16_400,
            0.45: 15_700,
            0.55: 13_800,
            0.60: 13_600,
            0.65: 13_400,
            0.70: 13_200,
            0.75: 13_000,
            0.80: 12_800,
            0.85: 12_600,
            0.90: 12_400,
            0.95: 12_200,
            1.00: 11_100,
            1.05: 10_000,
            1.50: 10_000,
            3.00: 10_000,
        }
        for sdr, bps in expected.items():
            self.assertEqual(surge_bps(sdr), bps, f"sdr={sdr}")

    def test_the_half_point_follows_the_formula_not_the_table(self):
        # D56: the bridge lands on 14 750 at SDR 0.50 — 1.475x, between the severe and
        # moderate bands, exactly as the printed function computes it.
        self.assertEqual(surge_bps(0.50), 14_750)

    def test_no_orders_is_full_supply_and_no_surge(self):
        self.assertEqual(supply_demand_ratio(7, 0), float("inf"))
        self.assertEqual(surge_bps(supply_demand_ratio(7, 0)), SURGE_NONE)


class TestTheCurveOverEveryPoint(unittest.TestCase):
    def test_monotone_non_increasing_bounded_and_integral(self):
        previous = None
        for index in range(SWEEP_POINTS):
            sdr = index * 2.5 / SWEEP_POINTS
            value = surge_bps(sdr)
            self.assertIsInstance(value, int)
            self.assertGreaterEqual(value, SURGE_NONE, f"sdr={sdr}")
            self.assertLessEqual(value, SURGE_SEVERE_MAX, f"sdr={sdr}")
            if previous is not None:
                self.assertLessEqual(value, previous, f"surge rose between sweep points at sdr={sdr}")
            previous = value

    def test_continuous_to_within_fifty_basis_points(self):
        # A 2.5/20 001 step in SDR is 0.000125; the steepest segment moves 7 000 bps over 0.5
        # SDR, which is 1.75 bps per step. Anything above 50 bps between neighbours is a cliff.
        previous = surge_bps(0.0)
        for index in range(1, SWEEP_POINTS):
            sdr = index * 2.5 / SWEEP_POINTS
            value = surge_bps(sdr)
            self.assertLessEqual(abs(value - previous), 50, f"discontinuity at sdr={sdr}")
            previous = value

    def test_the_bands_still_say_what_the_brief_says(self):
        for index in range(1, 400):  # SDR 0.001 .. 0.449
            sdr = index / 1_000
            self.assertGreaterEqual(surge_bps(sdr), SURGE_SEVERE_MIN, f"sdr={sdr}")
        for index in range(551, 946):  # SDR 0.551 .. 0.945
            value = surge_bps(index / 1_000)
            self.assertGreaterEqual(value, SURGE_MODERATE_MIN - 100, f"sdr={index / 1_000}")
            self.assertLessEqual(value, SURGE_MODERATE_MAX, f"sdr={index / 1_000}")

    def test_the_cap_binds_before_the_curve_would_exceed_it(self):
        self.assertEqual(surge_bps(0.0, cap_bps=18_000), 18_000)
        self.assertEqual(surge_bps(0.0), SURGE_SEVERE_MAX)

    def test_a_nan_ratio_is_refused(self):
        with self.assertRaises(ValueError):
            surge_bps(float("nan"))


class TestHysteresis(unittest.TestCase):
    def test_a_small_change_is_suppressed(self):
        self.assertEqual(
            published_surge_bps(13_000, 13_400, seconds_since_publish=600),
            13_000,
        )

    def test_a_large_change_inside_the_window_waits(self):
        self.assertEqual(
            published_surge_bps(13_000, 18_000, seconds_since_publish=30),
            13_000,
        )

    def test_a_large_change_after_the_window_publishes(self):
        self.assertEqual(
            published_surge_bps(13_000, 18_000, seconds_since_publish=91),
            18_000,
        )

    def test_the_first_publish_is_never_suppressed(self):
        self.assertEqual(published_surge_bps(None, 12_200, seconds_since_publish=None), 12_200)


if __name__ == "__main__":
    unittest.main()
