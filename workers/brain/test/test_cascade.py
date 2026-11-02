"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The cascade, the expansion ladder, the pre-warm cache and the trace.

These are the four pieces that make the ranking operable rather than merely correct, and the properties
under test are the dispatch gate's: exactly one winner (`D3`), no re-offer (`D4`), disjoint waves
(`D5`), termination (`D6`), and a trace with no field missing (`D12`). `D10` — no cancellation before
the ladder ends — is asserted at 479 s and 480 s, because the only interesting second is the boundary.

The trace's shape is the document's, with one recorded difference (`D75`): `09 §6` lists `cooldown`
among its fourteen factor keys, but cooldown is filter 13, not a factor; the engine emits one key per
factor and the test asserts exactly that.
"""

from __future__ import annotations

import copy
import unittest

from dispatch import (
    ADMIN_EXCEPTION_KIND,
    AUTO_CANCEL_AT_S,
    CONFIG_CHANGED,
    DEFAULT_WEIGHTS,
    ENGINE_VERSION,
    EVENT_KINDS,
    EXPANSION_LADDER,
    EXPIRED,
    FACTORS,
    PREWARM_MAX_AGE_S,
    PREWARM_TTL_S,
    RELAX_AT_S,
    RIDER_SET_CHANGED,
    RIDER_SET_DRIFT,
    STALE_AGE,
    TRACE_FACTOR_KEYS,
    Candidate,
    Offer,
    OrderContext,
    PrewarmEntry,
    Relaxations,
    Scored,
    TraceZone,
    Wave,
    admin_exception,
    boosted_payout,
    build_dispatch_trace,
    build_entry,
    claim,
    due_step,
    filter_candidates,
    is_warm,
    may_auto_cancel,
    may_cancel,
    missing_fields,
    next_step,
    pickup_refund_paisa,
    plan_offers,
    recompute_reason,
    relax_candidate,
    relax_candidates,
    rider_set_drift,
    run_cascade,
    score_candidates,
    size_waves,
    trace_retention_days,
)
from dispatch.waves import FALLBACK_AT_S

WAVES = size_waves(["B", "A", "D", "C", "E"], [0.72, 0.54, 0.61, 0.44, 0.31])
ORDER = OrderContext(zone_id="sylhet-1", vendor_id="v-1", total_paisa=45_000)


def scored(rider_id: str, acceptance: float = 0.5) -> Scored:
    """A scored candidate with real factors, so nothing downstream needs a fake."""
    values = tuple(0.5 for _ in FACTORS)
    values = values[:2] + (acceptance,) + values[3:]
    return Scored(rider_id=rider_id, total=0.5, factors=values)


class CascadeTests(unittest.TestCase):
    """`D3`–`D6`: one winner, no re-offer, disjoint waves, and an ending."""

    def test_a_wave_plan_carries_the_documents_timings(self):
        offers = plan_offers(WAVES)
        first = [offer for offer in offers if offer.wave == 1]
        second = [offer for offer in offers if offer.wave == 2]
        self.assertEqual([offer.rider_id for offer in first], ["B", "A", "D"])
        self.assertTrue(all((offer.starts_at_s, offer.expires_at_s) == (0, 25) for offer in first))
        self.assertTrue(all((offer.starts_at_s, offer.expires_at_s) == (25, 50) for offer in second))

    def test_a_rider_in_two_waves_is_refused_at_plan_time(self):
        bad = [Wave(1, ("B", "A"), 25, 0, 0.28), Wave(2, ("A", "C"), 25, 25, 0.5)]
        with self.assertRaises(ValueError):
            plan_offers(bad)

    def test_wave_numbers_must_ascend(self):
        bad = [Wave(2, ("B",), 25, 0, 0.5), Wave(2, ("C",), 25, 25, 0.5)]
        with self.assertRaises(ValueError):
            plan_offers(bad)

    def test_the_first_claim_wins_and_the_other_phones_stop_immediately(self):
        result = run_cascade("o-1", WAVES, claims=(("B", 8),))
        self.assertEqual(result.outcome, "ASSIGNED")
        self.assertEqual((result.claimed_by, result.claimed_at_s), ("B", 8))
        self.assertEqual(result.waves_fired, (1,))
        withdrawn = [event for event in result.events if event.kind == "OFFER_WITHDRAWN"]
        self.assertEqual({event.rider_id for event in withdrawn}, {"A", "B", "D"})
        self.assertTrue(all(event.at_s == 8 for event in withdrawn))

    def test_exactly_one_rider_survives_a_simultaneous_claim(self):
        result = run_cascade("o-1", WAVES, claims=(("A", 8), ("B", 8), ("D", 8)))
        self.assertEqual(result.outcome, "ASSIGNED")
        self.assertEqual(len(result.event_kinds("ASSIGNED")), 1)
        self.assertEqual(result.claimed_by, "A")

    def test_a_claim_after_the_wave_expired_is_refused_and_the_ladder_takes_over(self):
        result = run_cascade("o-1", WAVES, claims=(("B", 30),))
        self.assertEqual(result.outcome, "FALLBACK")
        self.assertEqual(result.event_kinds("CLAIM_REFUSED")[0].detail, "OFFER_NOT_YOURS")
        self.assertEqual(result.fallback_at_s, FALLBACK_AT_S)

    def test_a_rider_who_was_never_offered_cannot_claim(self):
        result = run_cascade("o-1", WAVES, claims=(("Z", 5),))
        self.assertEqual(result.outcome, "FALLBACK")
        self.assertEqual(result.event_kinds("CLAIM_REFUSED")[0].detail, "OFFER_NOT_YOURS")

    def test_a_rider_who_rejected_is_never_offered_again(self):
        result = run_cascade("o-1", WAVES, rejects=(("B", 3),))
        self.assertEqual([offer.wave for offer in result.offers if offer.rider_id == "B"], [1])
        self.assertIn(("B", 3, "REJECT_RECORDED"), [(e.rider_id, e.at_s, e.kind) for e in result.events])

    def test_a_wave_everybody_rejects_advances_early(self):
        result = run_cascade("o-1", WAVES, rejects=(("B", 3), ("A", 4), ("D", 5)))
        wave_two = [event for event in result.events if event.kind == "WAVE_FIRED" and event.wave == 2]
        self.assertEqual([event.at_s for event in wave_two], [5])
        self.assertEqual(result.waves_fired, (1, 2))

    def test_the_cascade_always_ends_in_an_assignment_or_the_ladder(self):
        result = run_cascade("o-1", WAVES, rejects=(("B", 1), ("A", 2), ("D", 3), ("C", 30), ("E", 40)))
        self.assertEqual(result.outcome, "FALLBACK")
        self.assertTrue(all(event.at_s <= result.fallback_at_s for event in result.events))
        self.assertEqual(result.event_kinds("FALLBACK")[0].at_s, FALLBACK_AT_S)

    def test_a_claim_after_the_fallback_belongs_to_the_ladder_not_the_cascade(self):
        result = run_cascade("o-1", WAVES, claims=(("A", 200),))
        self.assertEqual(result.outcome, "FALLBACK")
        self.assertTrue(all(event.at_s <= result.fallback_at_s for event in result.events))

    def test_the_cascade_can_start_at_an_offset_and_the_ladder_moves_with_it(self):
        result = run_cascade("o-1", WAVES, claims=(("B", 1_008),), start_s=1_000)
        self.assertEqual(result.claimed_at_s, 1_008)
        self.assertEqual(result.fallback_at_s, 1_000 + FALLBACK_AT_S)

    def test_every_event_kind_is_declared(self):
        result = run_cascade("o-1", WAVES, claims=(("B", 2), ("Z", 3)), rejects=(("A", 1),))
        self.assertTrue({event.kind for event in result.events} <= set(EVENT_KINDS))

    def test_the_claim_helper_reports_the_three_refusals(self):
        offers = (Offer("B", 1, 0, 25),)
        self.assertEqual(claim(offers, "B", 10).code, "OK")
        self.assertEqual(claim(offers, "B", 25).code, "OFFER_EXPIRED")
        self.assertEqual(claim(offers, "Z", 10).code, "OFFER_NOT_YOURS")
        self.assertEqual(claim(offers, "B", 10, claimed_by="A").code, "OFFER_CLAIMED")

    def test_a_negative_answer_time_is_refused(self):
        with self.assertRaises(ValueError):
            run_cascade("o-1", WAVES, claims=(("B", -1),))

    def test_a_filtered_rider_never_reaches_a_wave(self):
        riders = [Candidate("B"), Candidate("A", suspended=True), Candidate("D", cash_locked=True)]
        outcome = filter_candidates(riders, ORDER)
        ranked = score_candidates(ORDER, list(outcome.candidates), DEFAULT_WEIGHTS, _zone(), {})
        waves = size_waves(ranked, [0.7 for _ in ranked])
        self.assertEqual([rider.rider_id for rider in outcome.candidates], ["B"])
        self.assertEqual([rider for wave in waves for rider in wave.rider_ids], ["B"])

    def test_a_bicycle_is_never_offered_a_trip_beyond_its_radius(self):
        riders = [
            Candidate("near", vehicle="BICYCLE", vehicle_max_radius_m=4_000, routed_to_vendor_m=4_000),
            Candidate("far", vehicle="BICYCLE", vehicle_max_radius_m=4_000, routed_to_vendor_m=4_001),
        ]
        outcome = filter_candidates(riders, ORDER)
        self.assertEqual([rider.rider_id for rider in outcome.candidates], ["near"])


class ExpansionTests(unittest.TestCase):
    """`11 §11`: six rungs, each at its printed second, and no early cancellation (`D10`)."""

    def test_the_ladder_is_six_steps_at_the_documented_times(self):
        self.assertEqual([step.at_s for step in EXPANSION_LADDER], [112, 140, 175, 215, 300, 480])
        self.assertEqual([step.boost_pct for step in EXPANSION_LADDER], [None, 20, 40, None, None, None])

    def test_due_and_next_step_agree_at_every_boundary(self):
        self.assertIsNone(due_step(RELAX_AT_S - 1))
        self.assertEqual(due_step(RELAX_AT_S).step, 1)
        self.assertEqual(due_step(139).step, 1)
        self.assertEqual(due_step(140).step, 2)
        self.assertEqual(due_step(AUTO_CANCEL_AT_S).step, 6)
        self.assertEqual(next_step(0).step, 1)
        self.assertIsNone(next_step(AUTO_CANCEL_AT_S))

    def test_relaxation_widens_the_bicycle_and_the_cash_cap_but_not_the_motorbike(self):
        bicycle = Candidate("b", vehicle="BICYCLE", vehicle_max_radius_m=4_000, cash_limit_paisa=350_000)
        relaxed = relax_candidate(bicycle)
        self.assertEqual((relaxed.vehicle_max_radius_m, relaxed.cash_limit_paisa), (4_800, 420_000))
        motorbike = relax_candidate(Candidate("m"))
        self.assertEqual(motorbike.vehicle_max_radius_m, 12_000)

    def test_a_relaxation_may_not_narrow_anything(self):
        with self.assertRaises(ValueError):
            Relaxations(bicycle_radius_scale_bps=9_000)
        with self.assertRaises(ValueError):
            Relaxations(zone_tolerance_m=1_000)

    def test_step_one_is_the_difference_between_refused_and_offered(self):
        rider = Candidate("edge", zone_id="other", distance_to_zone_edge_m=2_500, cash_in_hand_paisa=340_000)
        self.assertEqual(filter_candidates([rider], ORDER).refused_by_filter, {7: 1})
        relaxed = relax_candidates([rider])[0]
        outcome = filter_candidates([relaxed], ORDER, zone_tolerance_m=3_000)
        self.assertTrue(outcome.candidates)

    def test_a_boost_is_floored_to_taka_once(self):
        self.assertEqual(boosted_payout(54_900, 20), 65_800)
        self.assertEqual(boosted_payout(54_900, 40), 76_800)
        self.assertEqual(boosted_payout(0, 40), 0)
        with self.assertRaises(ValueError):
            boosted_payout(-1, 20)

    def test_switching_to_pickup_refunds_the_fee_and_pays_the_apology_credit(self):
        self.assertEqual(pickup_refund_paisa(4_000), 7_000)

    def test_d10_no_order_is_cancelled_before_the_ladder_ends(self):
        self.assertFalse(may_cancel(AUTO_CANCEL_AT_S - 1))
        self.assertTrue(may_cancel(AUTO_CANCEL_AT_S))
        self.assertFalse(may_auto_cancel(AUTO_CANCEL_AT_S, customer_responded=True))
        self.assertTrue(may_auto_cancel(AUTO_CANCEL_AT_S, customer_responded=False))

    def test_the_admin_exception_appears_only_at_its_rung(self):
        self.assertIsNone(admin_exception(214))
        self.assertEqual(admin_exception(215).step, 4)
        self.assertEqual(ADMIN_EXCEPTION_KIND, "NO_RIDER_AVAILABLE")


class PrewarmTests(unittest.TestCase):
    """`11 §2.1`: 180 s of life, 60 s of trust, and 20% of drift."""

    def setUp(self):
        self.entry = build_entry(
            "o-1",
            100,
            [scored("a"), scored("b")],
            [Wave(1, ("a", "b"), 25, 0, 0.25)],
        )

    def test_the_cache_key_is_namespaced(self):
        self.assertEqual(self.entry.cache_key, "dispatch:prewarm:o-1")

    def test_a_fresh_entry_is_a_hit(self):
        self.assertEqual(recompute_reason(self.entry, 160, ("a", "b")), None)
        self.assertTrue(is_warm(self.entry, 160, ("a", "b")))

    def test_sixty_seconds_is_still_trusted_and_sixty_one_is_not(self):
        self.assertIsNone(recompute_reason(self.entry, 100 + PREWARM_MAX_AGE_S, ("a", "b")))
        self.assertEqual(recompute_reason(self.entry, 101 + PREWARM_MAX_AGE_S, ("a", "b")), STALE_AGE)

    def test_an_entry_dies_at_its_ttl(self):
        self.assertEqual(recompute_reason(self.entry, 100 + PREWARM_TTL_S, ("a", "b")), EXPIRED)

    def test_twenty_percent_drift_is_tolerated_and_more_is_not(self):
        ten = tuple(f"r{index}" for index in range(10))
        one_swapped = ten[:-1] + ("new",)
        two_swapped = ten[:-2] + ("new1", "new2")
        self.assertEqual(rider_set_drift(ten, one_swapped), 0.2)
        self.assertEqual(recompute_reason(build_entry("o", 0, [scored(r) for r in ten], []), 10, one_swapped), None)
        self.assertGreater(rider_set_drift(ten, two_swapped), RIDER_SET_DRIFT)
        self.assertEqual(
            recompute_reason(build_entry("o", 0, [scored(r) for r in ten], []), 10, two_swapped),
            RIDER_SET_CHANGED,
        )

    def test_a_changed_weight_set_invalidates_the_scores(self):
        self.assertEqual(recompute_reason(self.entry, 110, ("a", "b"), weights_version="r10.4.0"), CONFIG_CHANGED)

    def test_a_clock_that_went_backwards_is_not_a_cache_hit(self):
        self.assertEqual(recompute_reason(self.entry, 99, ("a", "b")), STALE_AGE)

    def test_a_wave_may_not_name_an_unscored_rider(self):
        with self.assertRaises(ValueError):
            build_entry("o", 0, [scored("a")], [Wave(1, ("a", "z"), 25, 0, 0.5)])

    def test_the_entry_survives_a_round_trip_through_json(self):
        payload = self.entry.to_json()
        rebuilt = PrewarmEntry.from_json(payload)
        self.assertEqual(rebuilt, self.entry)
        self.assertEqual(rebuilt.to_json(), payload)

    def test_a_malformed_payload_is_refused_rather_than_half_loaded(self):
        payload = self.entry.to_json()
        del payload["scored"]
        with self.assertRaises(ValueError):
            PrewarmEntry.from_json(payload)


def _zone():
    from dispatch.scoring import ZoneFeatures

    return ZoneFeatures()


def _trace(candidates, ranked, waves, duration_ms=6):
    return build_dispatch_trace(
        "UND-7K2M9QX4",
        "sylhet-1",
        {"lat": 24.8949, "lon": 91.8687},
        {"lat": 24.9012, "lon": 91.8721},
        45_000,
        "2026-11-02T14:20:00Z",
        candidates,
        ranked,
        {},
        _zone(),
        TraceZone(active_orders=11, active_riders=14, sdr=1.272, detour_factor=1.31, as_of="2026-11-02T14:19:59Z"),
        waves,
        duration_ms,
    )


class ExplainTests(unittest.TestCase):
    """`D12`: a trace for every decision, with no field missing — and one key per real factor."""

    def setUp(self):
        self.candidates = [Candidate("B", routed_to_vendor_m=820), Candidate("A", routed_to_vendor_m=1_100)]
        self.ranked = score_candidates(ORDER, self.candidates, DEFAULT_WEIGHTS, _zone(), {})
        self.waves = size_waves(self.ranked, [0.72 for _ in self.ranked])
        self.trace = _trace(self.candidates, self.ranked, self.waves)

    def test_the_trace_has_no_missing_field(self):
        self.assertEqual(missing_fields(self.trace), ())

    def test_the_trace_carries_one_key_per_factor_and_they_are_the_documented_names(self):
        row = self.trace["intermediates"]["candidates"][0]
        self.assertEqual(list(row["factors"]), [TRACE_FACTOR_KEYS[name] for name in FACTORS])
        self.assertEqual(len(row["factors"]), 14)
        self.assertNotIn("cooldown", row["factors"])

    def test_ranks_are_one_based_and_in_score_order(self):
        rows = self.trace["intermediates"]["candidates"]
        self.assertEqual([row["rank"] for row in rows], [1, 2])
        self.assertEqual([row["riderId"] for row in rows], [entry.rider_id for entry in self.ranked])

    def test_the_trace_matches_the_wave_plan_it_explains(self):
        self.assertEqual(self.trace["output"]["waves"], [list(wave.rider_ids) for wave in self.waves])
        self.assertEqual(self.trace["output"]["offerTtlS"], 25)
        self.assertEqual(self.trace["output"]["fallbackAfterS"], FALLBACK_AT_S)
        self.assertEqual(self.trace["engineVersion"], ENGINE_VERSION)
        self.assertEqual(self.trace["inputs"]["candidateCount"], 2)

    def test_a_dropped_factor_is_caught_by_the_schema_walk(self):
        broken = copy.deepcopy(self.trace)
        del broken["intermediates"]["candidates"][0]["factors"]["fairness"]
        self.assertEqual(
            missing_fields(broken),
            ("intermediates.candidates[0].factors.fairness",),
        )

    def test_a_dropped_output_field_is_caught(self):
        broken = copy.deepcopy(self.trace)
        del broken["output"]["offerTtlS"]
        self.assertIn("output.offerTtlS", missing_fields(broken))

    def test_a_candidate_missing_from_the_candidate_list_is_refused(self):
        with self.assertRaises(ValueError):
            _trace([self.candidates[0]], self.ranked, self.waves)

    def test_a_negative_duration_or_an_incomplete_point_is_refused(self):
        with self.assertRaises(ValueError):
            _trace(self.candidates, self.ranked, self.waves, duration_ms=-1)
        with self.assertRaises(ValueError):
            build_dispatch_trace(
                "o", "z", {"lat": 24.0}, {"lat": 24.1, "lon": 91.0}, 0, "now",
                self.candidates, self.ranked, {}, _zone(),
                TraceZone(0, 0, 1.0, 1.0, "now"), self.waves, 1,
            )

    def test_retention_is_per_kind_and_unknown_kinds_are_refused(self):
        self.assertEqual(trace_retention_days("DISPATCH"), 90)
        self.assertEqual(trace_retention_days("BATCH"), 90)
        self.assertEqual(trace_retention_days("FARE"), 14)
        self.assertEqual(trace_retention_days("PREPTIME"), 7)
        with self.assertRaises(ValueError):
            trace_retention_days("MYSTERY")


if __name__ == "__main__":
    unittest.main()
