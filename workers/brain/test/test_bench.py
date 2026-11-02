"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The benchmark, the adversarial scenarios and the replay harness.

A benchmark is evidence only if it is reproducible, so the first test here is determinism: the same
day index produces the same city and the same result. The gate then asserts that Undal beats
nearest-rider on every gated metric over the same generated days — the comparison `11 §12.1` claims —
and that no attacker in `09 §11.1` comes out ahead. The replay tests are the `brain-replay` job in
miniature: the three committed fixtures must reproduce exactly, and a tampered expectation must fail
rather than be tolerated.
"""

from __future__ import annotations

import dataclasses
import unittest

from bench.adversarial import (
    failed,
    plausibility_breach,
    promo_eligible,
    run_all,
)
from bench.brain_replay import differences, load, replay, seed_cases
from bench.city_sim import gini, simulate_day
from bench.report import GATED_METRICS, as_json, measure, render
from bench.world import DAYS, ORDERS_PER_DAY, RIDERS, make_day, payout_paisa, routed_metres


class WorldTests(unittest.TestCase):
    """The city is generated once, from one seed, and does not depend on the policy."""

    def test_a_day_is_reproducible(self):
        self.assertEqual(make_day(7), make_day(7))
        self.assertNotEqual(make_day(7), make_day(8))

    def test_the_vendors_are_the_same_every_day(self):
        self.assertEqual(make_day(0).vendors, make_day(31).vendors)
        self.assertEqual(len(make_day(0).vendors), 8)

    def test_orders_arrive_in_order_and_with_unique_ids(self):
        day = make_day(3)
        placed = [order.placed_at_s for order in day.orders]
        self.assertEqual(placed, sorted(placed))
        self.assertEqual(len({order.order_id for order in day.orders}), ORDERS_PER_DAY)
        self.assertEqual(len(day.riders), RIDERS)

    def test_the_benchmark_runs_more_order_days_than_the_document_promises(self):
        self.assertGreaterEqual(DAYS * ORDERS_PER_DAY, 10_000)

    def test_money_stays_integer_paisa(self):
        for route in (0, 500, 4_999, 12_000):
            self.assertIsInstance(payout_paisa(route), int)
            self.assertGreater(payout_paisa(route), 0)

    def test_routing_is_longer_than_the_straight_line(self):
        self.assertGreater(routed_metres((0.0, 0.0), (1_000.0, 0.0)), 1_000)


class BenchTests(unittest.TestCase):
    """The gate: Undal beats nearest-rider on every gated metric over the same days."""

    @classmethod
    def setUpClass(cls):
        cls.benchmark = measure(range(40))

    def test_the_comparison_has_no_regressions(self):
        self.assertEqual(self.benchmark.regressions(), ())
        for metric in GATED_METRICS:
            self.assertTrue(self.benchmark.better_on(metric), metric)

    def test_both_policies_see_the_same_orders(self):
        self.assertEqual(self.benchmark.orders, 40 * ORDERS_PER_DAY)
        self.assertEqual(self.benchmark.undal.orders, self.benchmark.orders)
        self.assertEqual(self.benchmark.nearest.orders, self.benchmark.orders)

    def test_the_benchmark_is_deterministic(self):
        self.assertEqual(measure(range(3)), measure(range(3)))

    def test_undal_offers_more_than_the_baseline_and_accepts_more_often(self):
        self.assertGreater(
            self.benchmark.undal.offer_acceptance_rate,
            self.benchmark.nearest.offer_acceptance_rate,
        )

    def test_the_baseline_never_batches(self):
        self.assertEqual(self.benchmark.nearest.batch_rate, 0.0)
        self.assertGreater(self.benchmark.undal.batch_rate, 0.0)

    def test_gini_is_zero_for_equals_and_one_half_for_half_the_income(self):
        self.assertEqual(gini([10.0, 10.0, 10.0]), 0.0)
        self.assertAlmostEqual(gini([0.0, 100.0]), 0.5, places=9)
        self.assertEqual(gini([]), 0.0)

    def test_a_single_day_still_produces_a_usable_result(self):
        deliveries, tally = simulate_day(make_day(0), "undal")
        self.assertEqual(len(deliveries), ORDERS_PER_DAY)
        self.assertEqual(tally.orders, ORDERS_PER_DAY)


class ReportTests(unittest.TestCase):
    """The artifact says what happened, including the targets it missed."""

    @classmethod
    def setUpClass(cls):
        cls.benchmark = measure(range(12))

    def test_the_table_carries_every_gated_metric(self):
        text = render(self.benchmark)
        for metric in GATED_METRICS:
            self.assertIn(f"`{metric}`", text)
        self.assertIn("Adversarial scenarios", text)
        self.assertIn("nearest-rider", text)

    def test_the_json_report_is_machine_readable(self):
        payload = as_json(self.benchmark)
        self.assertEqual(payload["days"], 12)
        self.assertEqual(len(payload["gated"]), len(GATED_METRICS))
        self.assertEqual(len(payload["adversarial"]), 7)
        self.assertIn("passed", payload)

    def test_targets_are_reported_even_when_missed(self):
        self.assertIn("missed", render(self.benchmark))


class AdversarialTests(unittest.TestCase):
    """`09 §11.1`: no attacker comes out ahead."""

    def test_every_scenario_is_net_negative_for_the_attacker(self):
        self.assertEqual(failed(run_all()), ())

    def test_all_seven_scenarios_are_present(self):
        self.assertEqual(len(run_all()), 7)
        self.assertEqual(
            [attack.name for attack in run_all()],
            [
                "fake_self_orders",
                "prep_time_lie",
                "delete_and_re_register",
                "reject_low_value_offers",
                "accept_then_unassign",
                "gps_spoofing",
                "promo_farming",
            ],
        )

    def test_an_impossible_jump_is_refused_and_an_ordinary_ride_is_not(self):
        self.assertTrue(plausibility_breach((0.0, 0.0), (5_000.0, 0.0), elapsed_s=10))
        self.assertFalse(plausibility_breach((0.0, 0.0), (200.0, 0.0), elapsed_s=30))
        self.assertTrue(plausibility_breach((0.0, 0.0), (10.0, 0.0), elapsed_s=0))

    def test_promo_eligibility_blocks_any_matching_key(self):
        seen = {("device-1", "address-1", "phone-1")}
        self.assertFalse(promo_eligible(("device-1", "address-9", "phone-9"), seen))
        self.assertFalse(promo_eligible(("device-9", "address-1", "phone-9"), seen))
        self.assertFalse(promo_eligible(("device-9", "address-9", "phone-1"), seen))
        self.assertTrue(promo_eligible(("device-9", "address-9", "phone-9"), seen))


class ReplayTests(unittest.TestCase):
    """`brain-replay`: a recorded decision reproduces exactly, and a tampered one does not."""

    def test_the_committed_fixtures_reproduce(self):
        cases = load()
        self.assertEqual(len(cases), 3)
        for case in cases:
            self.assertEqual(differences(case), (), case.name)

    def test_replaying_twice_gives_the_same_answer(self):
        case = seed_cases()[0]
        self.assertEqual(replay(case), replay(case))

    def test_a_tampered_expectation_is_caught(self):
        case = load()[2]
        broken = dataclasses.replace(
            case,
            expected={**case.expected, "ranking": list(reversed(case.expected["ranking"]))},
        )
        self.assertTrue(any("ranking" in problem for problem in differences(broken)))

    def test_a_fixture_from_another_weights_version_is_not_replayed(self):
        case = seed_cases()[0]
        other = dataclasses.replace(
            case, request={**case.request, "weights_version": "r10.0.0"}
        )
        with self.assertRaises(ValueError):
            replay(other)


if __name__ == "__main__":
    unittest.main()
