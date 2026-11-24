"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Dispatch: the weights, the fourteen filters, the fourteen factors, the ranking and the waves.

The properties here are the `35 §` gate for R9: `D1`–`D12` are the dispatch properties, weights sum
to 1.0 ± 1e-9, every factor is in `[0, 1]`, and two runs of the same input produce the same order.
The last test in the file records a discrepancy inside `11 §6`'s worked table rather than papering
over it — see `D73`.
"""

from __future__ import annotations

import unittest

from dispatch import factors as f
from dispatch.filters import Candidate, FILTERS, OrderContext, filter_candidates
from dispatch.scoring import RiderHistory, ZoneFeatures, explain_row, score_candidates
from dispatch.waves import MAX_WAVE_SIZE, MAX_WAVES, Wave, fallback_due, size_waves, wave_expiry_s


ORDER = OrderContext(zone_id="zone-1", vendor_id="vendor-1", total_paisa=55_000)


class WeightTests(unittest.TestCase):
    def test_the_printed_weights_do_not_actually_sum_to_one(self):
        # `11 §5` prints "Sum: 1.000" and its fourteen figures add to 1.005. The shipped defaults are
        # normalised, and this test is what keeps that decision visible instead of folkloric (D73).
        self.assertAlmostEqual(sum(f.PRINTED_WEIGHTS.values()), 1.005, places=9)

    def test_the_shipped_weights_sum_to_one_within_the_gate(self):
        self.assertLessEqual(abs(sum(f.DEFAULT_WEIGHTS.values.values()) - 1.0), f.WEIGHT_TOLERANCE)

    def test_normalising_preserves_the_ranking_of_weights(self):
        normalised = f.normalise(f.PRINTED_WEIGHTS)
        ordered = sorted(f.FACTORS, key=lambda name: f.PRINTED_WEIGHTS[name], reverse=True)
        self.assertEqual(ordered, sorted(f.FACTORS, key=lambda name: normalised[name], reverse=True))

    def test_a_weight_set_that_does_not_sum_to_one_is_refused(self):
        with self.assertRaises(ValueError):
            f.Weights(dict(f.PRINTED_WEIGHTS))

    def test_a_missing_factor_is_refused(self):
        partial = dict(f.PRINTED_WEIGHTS)
        del partial["freshness"]
        with self.assertRaises(ValueError):
            f.normalise(partial)


class FactorTests(unittest.TestCase):
    def test_every_factor_stays_inside_the_unit_interval(self):
        for routed in (0, 100, 1_100, 5_000, 12_000):
            for median in (500.0, 1_100.0, 3_000.0):
                self.assertGreaterEqual(f.proximity(routed, median), 0.0)
                self.assertLessEqual(f.proximity(routed, median), 1.0)
        for age in (0, 10, 60, 240, 600):
            self.assertTrue(0.0 <= f.freshness(age) <= 1.0)
        for load in (0, 1, 3):
            self.assertTrue(0.0 <= f.load_balance(load, 3) <= 1.0)
        for cash in (0, 100_000, 349_999, 350_000, 400_000):
            self.assertTrue(0.0 <= f.cash_headroom(cash, 55_000, 350_000) <= 1.0)
        for vehicle, distance, radius in (("MOTORBIKE", 12_000, 12_000), ("BICYCLE", 0, 4_000), ("BICYCLE", 4_000, 4_000)):
            self.assertTrue(0.0 <= f.vehicle_fit(vehicle, distance, radius) <= 1.0)

    def test_proximity_is_monotone_and_hits_the_median_at_one_half(self):
        previous = 1.0
        for routed in range(0, 5_000, 250):
            value = f.proximity(routed, 1_100.0)
            self.assertLessEqual(value, previous)
            previous = value
        self.assertAlmostEqual(f.proximity(1_100, 1_100.0), 0.5, places=12)

    def test_eta_fit_peaks_just_before_ready_and_falls_both_ways(self):
        self.assertEqual(f.eta_fit(540, 540), 1.0)
        self.assertEqual(f.eta_fit(460, 540), 1.0)  # 80 s early: the sweet spot
        self.assertEqual(f.eta_fit(420, 540), 1.0)  # exactly 120 s early
        self.assertLess(f.eta_fit(300, 540), 1.0)  # 4 min early starts costing
        self.assertEqual(f.eta_fit(540 - 1_020, 540), 0.0)  # 17 min early is worthless
        self.assertEqual(f.eta_fit(540 + 420, 540), 0.0)  # 7 min late is cold
        # Late decays faster than early: that asymmetry is the whole factor.
        self.assertGreater(f.eta_fit(540 - 200, 540), f.eta_fit(540 + 200, 540))

    def test_reliability_is_sixty_forty(self):
        self.assertAlmostEqual(f.reliability(1.0, 0.0), 0.6, places=12)
        self.assertAlmostEqual(f.reliability(0.94, 0.88), 0.916, places=12)

    def test_fairness_favours_the_idle_rider_and_the_lightly_loaded_one(self):
        tired = f.fairness(idle_s=10, deliveries_today=12, zone_median_today=6)
        fresh = f.fairness(idle_s=1_200, deliveries_today=0, zone_median_today=6)
        self.assertGreater(fresh, tired)
        self.assertAlmostEqual(f.fairness(0, 0, 0), 0.45, places=12)  # no median yet: load term is 1.0

    def test_wilson_lower_bounds_are_conservative_about_small_samples(self):
        self.assertLess(f.wilson_lower(1, 1), 1.0)
        self.assertLess(f.wilson_lower(1, 1), f.wilson_lower(50, 50))
        self.assertEqual(f.wilson_lower(0, 0), 0.0)

    def test_a_bicycle_on_a_long_trip_is_penalised_and_never_banned(self):
        self.assertEqual(f.vehicle_fit("MOTORBIKE", 12_000, 12_000), 1.0)
        self.assertAlmostEqual(f.vehicle_fit("BICYCLE", 3_800, 4_000), 0.3, places=12)
        self.assertAlmostEqual(f.vehicle_fit("BICYCLE", 0, 4_000), 1.0, places=12)

    def test_a_factor_refuses_an_impossible_input_rather_than_returning_a_number(self):
        with self.assertRaises(ValueError):
            f.proximity(-1, 1_100.0)
        with self.assertRaises(ValueError):
            f.proximity(10, 0)
        with self.assertRaises(ValueError):
            f.acceptance(1.5)
        with self.assertRaises(ValueError):
            f.freshness(10, 0)
        with self.assertRaises(ValueError):
            f.vehicle_fit("TRUCK", 10, 100)


class FilterTests(unittest.TestCase):
    def test_the_fourteen_filters_are_numbered_one_to_fourteen(self):
        self.assertEqual(len(FILTERS), 14)
        self.assertEqual(FILTERS[0], "KYC_APPROVED")
        self.assertEqual(FILTERS[13], "NOTIFICATIONS_ENABLED")

    def test_a_healthy_rider_survives(self):
        outcome = filter_candidates([Candidate(rider_id="r1", zone_id="zone-1")], ORDER)
        self.assertEqual([rider.rider_id for rider in outcome.candidates], ["r1"])
        self.assertEqual(outcome.refusals, ())

    def test_each_refusal_names_its_filter(self):
        cases = [
            (Candidate(rider_id="a", status="PENDING", zone_id="zone-1"), 1),
            (Candidate(rider_id="b", shift_state="OFFLINE", zone_id="zone-1"), 2),
            (Candidate(rider_id="c", selfie_verified=False, zone_id="zone-1"), 3),
            (Candidate(rider_id="d", fix_age_s=61, zone_id="zone-1"), 4),
            (Candidate(rider_id="e", cash_locked=True, zone_id="zone-1"), 5),
            (Candidate(rider_id="f", suspended=True, zone_id="zone-1"), 6),
            (Candidate(rider_id="g", zone_id="zone-2", distance_to_zone_edge_m=2_000), 7),
            (Candidate(rider_id="h", routed_to_vendor_m=12_001, zone_id="zone-1"), 8),
            (Candidate(rider_id="i", current_load=3, zone_id="zone-1"), 9),
            (Candidate(rider_id="j", current_load=1, zone_id="zone-1"), 10),
            (Candidate(rider_id="k", cash_in_hand_paisa=300_000, zone_id="zone-1"), 11),
            (Candidate(rider_id="l", rejected_waves=(1,), zone_id="zone-1"), 12),
            (Candidate(rider_id="m", vendor_cooldown=True, zone_id="zone-1"), 13),
            (Candidate(rider_id="n", notifications_allowed=False, zone_id="zone-1"), 14),
        ]
        for candidate, expected in cases:
            outcome = filter_candidates([candidate], ORDER)
            self.assertEqual(outcome.candidates, (), candidate.rider_id)
            self.assertEqual(outcome.refusals[0].number, expected, candidate.rider_id)
            self.assertEqual(outcome.refusals[0].name, FILTERS[expected - 1])

    def test_an_edge_zone_rider_is_useful_up_to_the_tolerance(self):
        inside = Candidate(rider_id="in", zone_id="zone-2", distance_to_zone_edge_m=1_500)
        outside = Candidate(rider_id="out", zone_id="zone-2", distance_to_zone_edge_m=1_501)
        outcome = filter_candidates([inside, outside], ORDER)
        self.assertEqual([rider.rider_id for rider in outcome.candidates], ["in"])

    def test_the_trace_counts_why_candidates_were_lost(self):
        riders = [
            Candidate(rider_id="ok", zone_id="zone-1"),
            Candidate(rider_id="off1", shift_state="OFFLINE", zone_id="zone-1"),
            Candidate(rider_id="off2", shift_state="OFFLINE", zone_id="zone-1"),
        ]
        outcome = filter_candidates(riders, ORDER)
        self.assertEqual(outcome.refused_by_filter, {2: 2})


class ScoringTests(unittest.TestCase):
    def setUp(self) -> None:
        self.riders = [Candidate(rider_id=name, zone_id="zone-1", routed_to_vendor_m=distance) for name, distance in
                       (("A", 420), ("B", 820), ("D", 1_950), ("E", 2_800), ("C", 610))]
        self.histories = {
            "A": RiderHistory(completion_rate=0.94, on_time_rate=0.88, rating_positives=82, rating_total=100,
                              deliveries_from_vendor=11, deliveries_into_cell=7, idle_s=40, deliveries_today=9,
                              acceptance_probability=0.71, eta_to_vendor_s=95),
            "B": RiderHistory(completion_rate=0.96, on_time_rate=0.91, rating_positives=79, rating_total=100,
                              deliveries_from_vendor=7, deliveries_into_cell=9, idle_s=412, deliveries_today=4,
                              acceptance_probability=0.84, eta_to_vendor_s=165),
            "D": RiderHistory(completion_rate=0.92, on_time_rate=0.86, rating_positives=74, rating_total=100,
                              deliveries_from_vendor=0, deliveries_into_cell=3, idle_s=1_310, deliveries_today=1,
                              acceptance_probability=0.79, eta_to_vendor_s=390),
            "E": RiderHistory(completion_rate=0.88, on_time_rate=0.79, rating_positives=69, rating_total=100,
                              deliveries_from_vendor=3, deliveries_into_cell=5, idle_s=22, deliveries_today=12,
                              acceptance_probability=0.58, eta_to_vendor_s=520),
            "C": RiderHistory(completion_rate=0.90, on_time_rate=0.84, rating_positives=88, rating_total=100,
                              deliveries_from_vendor=2, deliveries_into_cell=4, idle_s=95, deliveries_today=6,
                              acceptance_probability=0.66, eta_to_vendor_s=220),
        }
        self.zone = ZoneFeatures()

    def score(self, riders=None):
        return score_candidates(ORDER, riders or self.riders, f.DEFAULT_WEIGHTS, self.zone, self.histories)

    def test_every_factor_is_inside_the_unit_interval_for_every_candidate(self):
        for entry in self.score():
            for value in entry.factors:
                self.assertGreaterEqual(value, 0.0)
                self.assertLessEqual(value, 1.0)

    def test_the_ranking_is_the_documents_ranking(self):
        # `11 §6` prints the rank B, A, D, C, E and the weighted totals 0.7444, 0.6620, 0.6554, 0.6269,
        # 0.5557. Those totals come from the table's own factor values, four of which the printed
        # formulas do not reproduce (see the discrepancy test below); what is asserted here is the
        # ordering, which is the claim the document actually makes.
        self.assertEqual([entry.rider_id for entry in self.score()], ["B", "A", "D", "C", "E"])

    def test_scoring_is_deterministic(self):
        first = [(entry.rider_id, round(entry.total, 12)) for entry in self.score()]
        second = [(entry.rider_id, round(entry.total, 12)) for entry in self.score()]
        self.assertEqual(first, second)

    def test_ties_break_on_acceptance_then_on_rider_id(self):
        twins = [Candidate(rider_id="zz", zone_id="zone-1", routed_to_vendor_m=800),
                 Candidate(rider_id="aa", zone_id="zone-1", routed_to_vendor_m=800)]
        histories = {"zz": RiderHistory(acceptance_probability=0.5, eta_to_vendor_s=400),
                     "aa": RiderHistory(acceptance_probability=0.5, eta_to_vendor_s=400)}
        order = score_candidates(ORDER, twins, f.DEFAULT_WEIGHTS, self.zone, histories)
        self.assertEqual([entry.rider_id for entry in order], ["aa", "zz"])

        better = {"zz": RiderHistory(acceptance_probability=0.9, eta_to_vendor_s=400),
                  "aa": RiderHistory(acceptance_probability=0.5, eta_to_vendor_s=400)}
        self.assertEqual(
            [entry.rider_id for entry in score_candidates(ORDER, twins, f.DEFAULT_WEIGHTS, self.zone, better)], ["zz", "aa"]
        )

    def test_the_explanation_is_the_weighted_contributions_and_they_add_up(self):
        entry = self.score()[0]
        row = explain_row(entry, f.DEFAULT_WEIGHTS)
        self.assertAlmostEqual(row["total"], sum(row[name] for name in f.FACTORS), places=12)
        self.assertGreater(row["proximity"], row["freshness"])


class WaveTests(unittest.TestCase):
    def test_the_worked_example_of_11_7_2(self):
        probabilities = [0.72, 0.54, 0.61, 0.44, 0.31]
        riders = [f"r{index}" for index in range(len(probabilities))]
        waves = size_waves(riders, probabilities)
        self.assertEqual(len(waves[0].rider_ids), 3, "three riders reach the 90% target")
        self.assertAlmostEqual(waves[0].p_none, 0.28 * 0.46 * 0.39, places=12)
        self.assertEqual(waves[1].rider_ids, ("r3", "r4"))
        self.assertEqual(waves[0].starts_at_s, 0)
        self.assertEqual(waves[1].starts_at_s, 25)

    def test_no_rider_is_asked_twice_and_every_wave_is_within_size(self):
        probabilities = [0.2] * 20
        waves = size_waves([f"r{index}" for index in range(20)], probabilities)
        asked = [rider for wave in waves for rider in wave.rider_ids]
        self.assertEqual(len(asked), len(set(asked)))
        self.assertLessEqual(len(waves), MAX_WAVES)
        for wave in waves:
            self.assertLessEqual(len(wave.rider_ids), MAX_WAVE_SIZE)

    def test_a_confident_single_candidate_gets_a_wave_of_one(self):
        waves = size_waves(["only"], [0.95])
        self.assertEqual([list(wave.rider_ids) for wave in waves], [["only"]])

    def test_expiry_and_fallback_follow_the_schedule(self):
        wave = Wave(wave=3, rider_ids=("a",), ttl_s=22, starts_at_s=50, p_none=0.5)
        self.assertEqual(wave_expiry_s(wave), 72)
        self.assertFalse(fallback_due(0, 111))
        self.assertTrue(fallback_due(0, 112))

    def test_a_probability_outside_the_unit_interval_is_refused(self):
        with self.assertRaises(ValueError):
            size_waves(["a"], [1.2])
        with self.assertRaises(ValueError):
            size_waves(["a", "b"], [0.5])


class DocumentDiscrepancyTests(unittest.TestCase):
    """`11 §6` prints a worked table that its own formulas do not reproduce.

    Recorded rather than repaired: the formulas are the specification, the table is an illustration,
    and pretending the two agree would hide the next reader's confusion behind a green test (D73).
    """

    def test_proximity_and_reliability_reproduce_exactly(self):
        self.assertAlmostEqual(f.proximity(420, 1_100.0), 0.724, places=3)
        self.assertAlmostEqual(f.proximity(820, 1_100.0), 0.573, places=3)
        self.assertAlmostEqual(f.proximity(1_950, 1_100.0), 0.360, places=2)  # the table prints three digits
        self.assertAlmostEqual(f.reliability(0.94, 0.88), 0.916, places=3)
        self.assertAlmostEqual(f.reliability(0.90, 0.84), 0.876, places=3)

    def test_eta_fit_reproduces_only_where_the_table_says_one(self):
        ready = 540
        # E arrives 20 s before ready: the table's 1.000 is what the formula says.
        self.assertAlmostEqual(f.eta_fit(520, ready), 1.000, places=3)
        # A arrives 445 s early, and the formula says 0.639 against the table's 0.629.
        self.assertAlmostEqual(f.eta_fit(95, ready), 0.639, places=3)
        self.assertNotAlmostEqual(f.eta_fit(95, ready), 0.629, places=3)

    def test_fairness_reproduces_for_one_rider_of_the_five(self):
        # B is the only column that matches: idle 412 s, 4 jobs against a median of 6.
        self.assertAlmostEqual(f.fairness(412, 4, 6.0), 0.639, places=3)
        # A is 40 s idle with 9 jobs; the formula says 0.356 where the table prints 0.206.
        self.assertAlmostEqual(f.fairness(40, 9, 6.0), 0.356, places=3)
        self.assertNotAlmostEqual(f.fairness(40, 9, 6.0), 0.206, places=3)


if __name__ == "__main__":
    unittest.main()
