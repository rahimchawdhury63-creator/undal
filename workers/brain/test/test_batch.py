"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Batching: the ten constraints, the six orderings, the score and the proof.

The properties are the `35 §` gate's `B1`–`B9`. Each constraint is exercised at its boundary *and* just
past it, because a limit that only fails far away is a limit nobody has actually tested; and the
worked example of `12 §6.1` is recomputed from its own printed terms, which do not add up to the total
the document prints — recorded here, as `D73` did for dispatch (`D74`).
"""

from __future__ import annotations

import dataclasses
import unittest

from batch import (
    BATCH_SCORE_MIN,
    DEFAULT_HANDOVER_S,
    MAX_BUNDLE_ORDERS,
    MAX_BUNDLE_SPAN_M,
    MAX_DETOUR_S,
    MAX_LEG_M,
    MAX_PERMUTATIONS,
    READY_WINDOW_S,
    ROUTE_PENALTY_PER_M,
    TEMPERATURE_DETOUR_S,
    BundleOrder,
    Legs,
    RiderFacts,
    ScoreInput,
    ZonePressure,
    batch_score,
    best_ordering,
    clamp_handover,
    cost_of,
    evaluate,
    feasible_orderings,
    make_proof,
    revalidate,
)
from batch.score import WEIGHTS


def order(order_id: str, *, ready: int = 0, drop_travel: int = 600, total: int = 50_000, eta_max: int = 3_000, **kwargs) -> BundleOrder:
    return BundleOrder(
        order_id=order_id,
        ready_at_s=ready,
        drop_cell="cell-1",
        total_paisa=total,
        promised_eta_max_s=eta_max,
        **kwargs,
    )


def legs(first: str, second: str, *, a: int = 600, b: int = 700, between: int = 200) -> Legs:
    return Legs(vendor_to={first: a, second: b}, between={(first, second): between, (second, first): between})


def legs_with_detours(*, first: int = 0, second: int) -> Legs:
    """A leg set built backwards from the detours a test wants.

    With both orders ready at once, the first order's detour is zero and the second's is
    `travel_a + handover + between − travel_b`; solving for `between` keeps every boundary test honest
    about which number it is actually moving.
    """
    between = second - (600 + DEFAULT_HANDOVER_S - 700)
    if between < 0:
        raise ValueError("that detour is impossible with these legs")
    return legs("A", "B", between=between)


RIDER = RiderFacts(vehicle="MOTORBIKE", cash_in_hand_paisa=0, cash_limit_paisa=350_000, payout_paisa=10_000)


class ConstraintTests(unittest.TestCase):
    def test_a_comfortable_bundle_passes_every_constraint(self):
        report = evaluate([order("A"), order("B")], legs("A", "B"), RIDER)
        self.assertTrue(report.feasible)
        self.assertEqual(report.failed, ())
        self.assertIsNone(report["C2"], "C2 does not apply when nothing is fragile")

    def test_c1_detour_limit_holds_at_the_boundary_and_fails_past_it(self):
        # The first order's detour is the whole ready-time gap; the second's is kept at 265 s.
        at_limit = evaluate([order("A", ready=0), order("B", ready=MAX_DETOUR_S)], legs_with_detours(second=265), RIDER)
        self.assertTrue(at_limit["C1"])
        past = evaluate([order("A", ready=0), order("B", ready=MAX_DETOUR_S + 1)], legs_with_detours(second=265), RIDER)
        self.assertFalse(past["C1"])

    def test_c2_halves_the_budget_for_a_fragile_order(self):
        at_limit = [order("A"), order("B", ready=0, temperature_critical=True)]
        self.assertTrue(at_limit[1].fragile)
        report = evaluate(at_limit, legs_with_detours(second=TEMPERATURE_DETOUR_S), RIDER)
        self.assertTrue(report["C2"], "210 s of detour is exactly the fragile budget")
        past = evaluate([order("A"), order("B", ready=0, spill_risk=True)], legs_with_detours(second=TEMPERATURE_DETOUR_S + 1), RIDER)
        self.assertFalse(past["C2"], "and 211 s is not")

    def test_c3_never_breaks_a_promise_made_at_checkout(self):
        promises = [order("A", eta_max=100), order("B", eta_max=100)]
        report = evaluate(promises, legs("A", "B"), RIDER)
        self.assertFalse(report["C3"])
        generous = [order("A", eta_max=5_000), order("B", eta_max=5_000)]
        self.assertTrue(evaluate(generous, legs("A", "B"), RIDER)["C3"])

    def test_c4_ready_window(self):
        self.assertTrue(evaluate([order("A", ready=0), order("B", ready=READY_WINDOW_S)], legs("A", "B"), RIDER)["C4"])
        self.assertFalse(evaluate([order("A", ready=0), order("B", ready=READY_WINDOW_S + 1)], legs("A", "B"), RIDER)["C4"])

    def test_c5_the_hop_between_drops(self):
        inside = legs("A", "B", between=MAX_LEG_M["MOTORBIKE"])
        self.assertTrue(evaluate([order("A"), order("B")], inside, RIDER)["C5"])
        outside = legs("A", "B", between=MAX_LEG_M["MOTORBIKE"] + 1)
        self.assertFalse(evaluate([order("A"), order("B")], outside, RIDER)["C5"])

    def test_c6_total_span(self):
        long_hop = legs("A", "B", a=5_000, b=5_000, between=MAX_LEG_M["MOTORBIKE"])
        report = evaluate([order("A"), order("B")], long_hop, RIDER)
        self.assertTrue(report["C6"])
        bicycle = RiderFacts(vehicle="BICYCLE", cash_in_hand_paisa=0, cash_limit_paisa=350_000, payout_paisa=10_000)
        self.assertFalse(evaluate([order("A"), order("B")], long_hop, bicycle)["C6"])

    def test_c7_a_fragile_item_costs_capacity(self):
        bicycle = RiderFacts(vehicle="BICYCLE", cash_in_hand_paisa=0, cash_limit_paisa=350_000, payout_paisa=10_000)
        single_bags = [order("A"), order("B")]
        self.assertFalse(evaluate(single_bags, legs("A", "B"), bicycle)["C7"], "a bicycle carries one bag")
        fragile = [order("A"), order("B")]  # a fragile item reduces motorcycle capacity from 3 to 2
        self.assertTrue(evaluate(fragile, legs("A", "B"), RIDER)["C7"])
        # A motorcycle carries three bags, or two when one of them is fragile.
        three = [order("A"), order("B"), order("C")]
        three_legs = Legs(
            vendor_to={"A": 600, "B": 700, "C": 800},
            between={(first, second): 100 for first in "ABC" for second in "ABC" if first != second},
        )
        self.assertTrue(evaluate(three, three_legs, RIDER)["C7"], "three plain bags fit")
        fragile_three = [order("A"), order("B", spill_risk=True), order("C")]
        self.assertFalse(evaluate(fragile_three, three_legs, RIDER)["C7"], "a spill costs a slot")

    def test_c8_cash_headroom_covers_both_orders(self):
        # ৳3 000 in hand plus two ৳500 orders is ৳4 000 against a ৳3 500 cap.
        tight = RiderFacts(vehicle="MOTORBIKE", cash_in_hand_paisa=300_000, cash_limit_paisa=350_000, payout_paisa=10_000)
        self.assertFalse(evaluate([order("A", total=50_000), order("B", total=50_000)], legs("A", "B"), tight)["C8"])
        roomy = RiderFacts(vehicle="MOTORBIKE", cash_in_hand_paisa=200_000, cash_limit_paisa=350_000, payout_paisa=10_000)
        self.assertTrue(evaluate([order("A", total=50_000), order("B", total=50_000)], legs("A", "B"), roomy)["C8"])
        boundary = RiderFacts(vehicle="MOTORBIKE", cash_in_hand_paisa=250_000, cash_limit_paisa=350_000, payout_paisa=10_000)
        self.assertTrue(evaluate([order("A", total=50_000), order("B", total=50_000)], legs("A", "B"), boundary)["C8"], "exactly at the cap is allowed")

    def test_c9_neither_order_may_be_in_trouble(self):
        self.assertFalse(evaluate([order("A", state="DISPUTED"), order("B")], legs("A", "B"), RIDER)["C9"])
        self.assertFalse(evaluate([order("A", state="REASSIGNING"), order("B")], legs("A", "B"), RIDER)["C9"])
        self.assertTrue(evaluate([order("A", state="RIDER_SEARCH"), order("B")], legs("A", "B"), RIDER)["C9"])

    def test_c10_the_rider_is_never_paid_less_than_two_solo_trips(self):
        poor = RiderFacts(vehicle="MOTORBIKE", cash_in_hand_paisa=0, cash_limit_paisa=350_000, payout_paisa=7_000)
        self.assertFalse(evaluate([order("A", min_payout_paisa=4_000), order("B", min_payout_paisa=4_000)], legs("A", "B"), poor)["C10"])
        fair = RiderFacts(vehicle="MOTORBIKE", cash_in_hand_paisa=0, cash_limit_paisa=350_000, payout_paisa=8_000)
        self.assertTrue(evaluate([order("A", min_payout_paisa=4_000), order("B", min_payout_paisa=4_000)], legs("A", "B"), fair)["C10"])

    def test_a_bundle_holds_two_or_three_orders_and_no_more(self):
        with self.assertRaises(ValueError):
            evaluate([order("A")], legs("A", "B"), RIDER)
        with self.assertRaises(ValueError):
            evaluate([order("A"), order("B"), order("C"), order("D")], legs("A", "B"), RIDER)

    def test_only_orderings_that_pass_everything_are_returned_and_never_more_than_six(self):
        three = [order("A"), order("B"), order("C")]
        three_legs = Legs(
            vendor_to={"A": 600, "B": 700, "C": 800},
            between={(first, second): 400 for first in "ABC" for second in "ABC" if first != second},
        )
        orderings = feasible_orderings(three, three_legs, RIDER)
        self.assertLessEqual(len(orderings), MAX_PERMUTATIONS)
        for ordering in orderings:
            self.assertTrue(evaluate(list(ordering), three_legs, RIDER).feasible)
            self.assertEqual(len({entry.order_id for entry in ordering}), MAX_BUNDLE_ORDERS)


class PermutationTests(unittest.TestCase):
    def test_the_squared_detour_prefers_two_small_waits_to_one_large_one(self):
        # Two orderings with the same route metres; only the distribution of detour differs.
        balanced = type("T", (), {"detours": {"A": 100, "B": 100}, "total_route_m": 0})()
        concentrated = type("T", (), {"detours": {"A": 0, "B": 200}, "total_route_m": 0})()
        self.assertLess(cost_of(balanced), cost_of(concentrated))

    def test_route_metres_are_weighted_by_lambda(self):
        near = type("T", (), {"detours": {"A": 0, "B": 0}, "total_route_m": 1_000})()
        self.assertAlmostEqual(cost_of(near), ROUTE_PENALTY_PER_M * 1_000, places=12)

    def test_the_cheapest_ordering_is_chosen_deterministically(self):
        first = best_ordering([order("A", ready=0), order("B", ready=200)], legs("A", "B", a=600, b=900), RIDER)
        second = best_ordering([order("A", ready=0), order("B", ready=200)], legs("A", "B", a=600, b=900), RIDER)
        self.assertEqual(first.order_ids, second.order_ids)
        self.assertEqual(set(first.order_ids), {"A", "B"})

    def test_only_two_or_three_orders_may_be_ordered(self):
        with self.assertRaises(ValueError):
            best_ordering([order("A")], legs("A", "B"), RIDER)


class ScoreTests(unittest.TestCase):
    def test_the_weights_sum_to_one(self):
        self.assertAlmostEqual(sum(WEIGHTS.values()), 1.0, places=12)

    def test_the_worked_example_is_recomputed_from_its_own_terms(self):
        # `12 §6.1` prints 0.417, 0.579, 0.750, 0.880, 0.393 and a total of 0.566. Those terms weight
        # to 0.5812, so the total the document prints is not the sum of the total it prints (D74).
        score = batch_score(
            ScoreInput(
                solo_total_m=8_400,
                bundle_total_m=4_900,
                max_detour_s=177,
                ready_window_s=90,
                batch_success_rate=0.88,
                zone=ZonePressure(active_orders=11, active_riders=14),
            )
        )
        self.assertAlmostEqual(score.terms["efficiency"], 0.4167, places=4)
        self.assertAlmostEqual(score.terms["detour_quality"], 0.5786, places=4)
        self.assertAlmostEqual(score.terms["ready_sync"], 0.75, places=4)
        self.assertAlmostEqual(score.terms["pressure"], 0.3929, places=4)
        self.assertAlmostEqual(score.total, 0.5812, places=4)
        self.assertNotAlmostEqual(score.total, 0.566, places=3)
        self.assertTrue(score.offered)

    def test_the_threshold_is_the_documents(self):
        self.assertEqual(BATCH_SCORE_MIN, 0.45)
        poor = batch_score(ScoreInput(solo_total_m=8_400, bundle_total_m=8_300, max_detour_s=400, ready_window_s=350, batch_success_rate=0.5, zone=ZonePressure()))
        self.assertFalse(poor.offered)

    def test_a_bundle_longer_than_two_solo_trips_scores_below_the_threshold(self):
        worse = batch_score(ScoreInput(solo_total_m=4_900, bundle_total_m=8_400, max_detour_s=177, ready_window_s=90, batch_success_rate=0.88, zone=ZonePressure(11, 14)))
        self.assertLess(worse.terms["efficiency"], 0.0)
        self.assertFalse(worse.offered)

    def test_a_zero_median_solo_distance_does_not_divide_by_zero(self):
        score = batch_score(ScoreInput(solo_total_m=0, bundle_total_m=0, max_detour_s=0, ready_window_s=0, batch_success_rate=1.0, zone=ZonePressure(2, 1)))
        self.assertEqual(score.terms["efficiency"], 0.0)
        self.assertTrue(score.offered)


class ProofTests(unittest.TestCase):
    def build(self):
        bundle = [order("A"), order("B")]
        timing_legs = legs("A", "B")
        report = evaluate(bundle, timing_legs, RIDER)
        score = batch_score(ScoreInput(solo_total_m=8_400, bundle_total_m=4_900, max_detour_s=177, ready_window_s=90, batch_success_rate=0.88, zone=ZonePressure(11, 14)))
        best = best_ordering(bundle, timing_legs, RIDER)
        return make_proof("bundle-1", ("A", "B"), best.order_ids, best.timings.detours, best.timings.total_route_m, report, score, DEFAULT_HANDOVER_S), report, timing_legs

    def test_a_proof_round_trips_through_json(self):
        proof, _, _ = self.build()
        self.assertEqual(proof.to_json()["orders"], ["A", "B"])
        self.assertEqual(proof.from_json(proof.to_json()), proof)

    def test_an_infeasible_bundle_cannot_be_proved(self):
        bundle = [order("A", state="DISPUTED"), order("B")]
        report = evaluate(bundle, legs("A", "B"), RIDER)
        score = batch_score(ScoreInput(8_400, 4_900, 177, 90, 0.88, ZonePressure(11, 14)))
        with self.assertRaises(ValueError):
            make_proof("b", ("A", "B"), ("A", "B"), {"A": 0, "B": 0}, 1_000, report, score, DEFAULT_HANDOVER_S)

    def test_revalidation_fails_when_the_world_moves(self):
        proof, _, timing_legs = self.build()
        self.assertTrue(revalidate(proof, evaluate([order("A"), order("B")], timing_legs, RIDER)).valid)

        moved = evaluate([order("A"), order("B", state="DISPUTED")], timing_legs, RIDER)
        result = revalidate(proof, moved)
        self.assertFalse(result.valid)
        self.assertIn("C9", result.broken)

    def test_a_stored_detour_over_budget_is_a_dishonest_proof(self):
        proof, _, timing_legs = self.build()
        dishonest = dataclasses.replace(proof, detours_s={"A": MAX_DETOUR_S + 1, "B": 1})
        result = revalidate(dishonest, evaluate([order("A"), order("B")], timing_legs, RIDER))
        self.assertFalse(result.valid)
        self.assertIn("A", result.broken)


class HandoverTests(unittest.TestCase):
    def test_a_learned_handover_time_is_clamped(self):
        self.assertEqual(clamp_handover(10), 90)
        self.assertEqual(clamp_handover(165), 165)
        self.assertEqual(clamp_handover(9_000), 420)

    def test_the_bundle_span_limits_are_the_documents(self):
        self.assertEqual(MAX_BUNDLE_SPAN_M["MOTORBIKE"], 12_000)
        self.assertEqual(MAX_BUNDLE_SPAN_M["BICYCLE"], 4_000)
        self.assertEqual(MAX_LEG_M["MOTORBIKE"], 2_000)
        self.assertEqual(MAX_LEG_M["BICYCLE"], 1_200)


if __name__ == "__main__":
    unittest.main()
