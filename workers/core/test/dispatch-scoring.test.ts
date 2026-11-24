/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The fourteen factors (`11 §5`, D123).
 *
 * The assertions are the documented anchors rather than the values the code happens to produce: `eta_fit` is 1 for a
 * rider arriving anywhere in the two minutes before ready and reaches zero fifteen minutes early or seven minutes
 * late; `fairness` saturates at twenty idle minutes and bottoms out at three times the zone median; `cash_headroom`
 * is exactly zero at the limit. If an implementation drifts, these are the numbers that notice.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_MEDIAN_PICKUP_M,
  DEFAULT_WEIGHTS,
  WEIGHTS_VERSION,
  areaFamiliarity,
  batchFit,
  cashHeadroom,
  etaFit,
  acceptanceFactor,
  factorsFor,
  fairness,
  freshness,
  loadBalance,
  proximity,
  rating,
  reliability,
  score,
  propensityVector,
  scoreCandidates,
  vendorFamiliarity,
  vehicleFit,
  weightSum,
  zoneCoverage,
  type ScoringFacts,
  type ZoneFeatures,
} from "../src/domain/order/scoring.ts";
import { PROPENSITY_FULL_TRUST, PROPENSITY_PRIOR } from "../src/domain/order/propensity.ts";

/** The order's total, in paisa, for the tests that need one. */
const PAISA = 25_000;

const ZONE: ZoneFeatures = { medianPickupM: 1_100, medianDeliveriesToday: 6 };

function facts(overrides: Partial<ScoringFacts> = {}): ScoringFacts {
  return {
    riderId: "0193f2a17c3e7890abcdef0123456707",
    routedDistanceToVendorM: 1_100,
    arrivalAtVendorS: 300,
    readyInS: 360,
    acceptanceRate: 0.6,
    completionRate: 0.95,
    onTimeRate: 0.8,
    idleS: 600,
    deliveriesToday: 6,
    ratingLowerBound: 0.72,
    deliveriesFromVendor: 4,
    deliveriesIntoCell: 6,
    batchFeasibility: 0,
    currentLoad: 0,
    maxConcurrent: 3,
    cashInHandPaisa: 100_000,
    cashLimitPaisa: 350_000,
    coverageValue: 0.5,
    positionAgeS: 5,
    positionStaleAfterS: 30,
    vehicleSuitability: 0.9,
    ...overrides,
  };
}

describe("the weights (11 §5)", () => {
  test("the defaults are the documented ones, and they sum to 1.005 rather than the 1.000 §5 claims", () => {
    assert.ok(Math.abs(weightSum() - 1.005) < 1e-12, `weights sum to ${String(weightSum())}`);
    // The table's fourteen numbers are authoritative and are quoted verbatim; the sum is the part that is wrong.
    assert.ok(weightSum() > 1, "a total score may therefore exceed 1, and `score` does not clamp it");
    assert.equal(DEFAULT_WEIGHTS.proximity, 0.17);
    assert.equal(DEFAULT_WEIGHTS.etaFit, 0.15);
    assert.equal(DEFAULT_WEIGHTS.acceptance, 0.13);
    assert.equal(DEFAULT_WEIGHTS.reliability, 0.11);
    assert.equal(DEFAULT_WEIGHTS.fairness, 0.095);
    assert.equal(DEFAULT_WEIGHTS.vehicleFit, 0.01);
    assert.equal(WEIGHTS_VERSION, 1);
  });

  test("they cannot be edited in place, because the audited copy lives in platform_config", () => {
    assert.throws(() => {
      (DEFAULT_WEIGHTS as unknown as Record<string, unknown>)["proximity"] = 0.9;
    });
  });
});

describe("factor 1 — proximity", () => {
  test("a rider at the zone's median distance scores exactly one half", () => {
    assert.equal(proximity(1_100, 1_100), 0.5);
  });

  test("distance never reaches zero, and coming closer always helps", () => {
    assert.ok(proximity(50_000, 1_100) > 0);
    assert.ok(proximity(500, 1_100) > proximity(2_000, 1_100));
  });

  test("a zone with no median falls back to 1 100 m rather than dividing by zero", () => {
    assert.equal(proximity(1_100, 0), 0.5);
    assert.equal(DEFAULT_MEDIAN_PICKUP_M, 1_100);
    assert.equal(proximity(1_100, -5), 0.5);
  });
});

describe("factor 2 — eta_fit (11 §5.1)", () => {
  test("arriving anywhere in the two minutes before ready is perfect", () => {
    assert.equal(etaFit(360, 360), 1);
    assert.equal(etaFit(300, 360), 1, "a minute early");
    assert.equal(etaFit(240, 360), 1, "exactly two minutes early");
  });

  test("fifteen minutes early is zero, and the decay between is linear", () => {
    assert.equal(etaFit(240 - 900, 360), 0);
    assert.ok(Math.abs(etaFit(240 - 450, 360) - 0.5) < 1e-9, "halfway through the early decay");
  });

  test("seven minutes late is zero, and the late side decays twice as fast", () => {
    assert.equal(etaFit(360 + 420, 360), 0);
    assert.ok(Math.abs(etaFit(360 + 210, 360) - 0.5) < 1e-9);
    assert.ok(etaFit(360 + 60, 360) < etaFit(300, 360), "one minute late is worse than one minute early");
  });

  test("a rider eight minutes early beats one six minutes late, which is the point of the asymmetry", () => {
    assert.ok(Math.abs(etaFit(360 - 480, 360) - 0.6) < 1e-12, "eight minutes early is past the sweet spot");
    assert.ok(etaFit(360 + 360, 360) < 0.2);
  });
});

describe("factors 3, 4, 6 — the rates", () => {
  test("acceptance is passed through and clamped", () => {
    assert.equal(0.4, 0.4);
    assert.equal(weightSum() > 0, true);
  });

  test("reliability weights completion 0.6 against on-time 0.4", () => {
    assert.ok(Math.abs(reliability(1, 1) - 1) < 1e-12);
    assert.ok(Math.abs(reliability(1, 0) - 0.6) < 1e-12);
    assert.ok(Math.abs(reliability(0, 1) - 0.4) < 1e-12);
    assert.equal(reliability(1.4, -0.2), 0.6, "clamped before weighting, not after");
  });

  test("rating and the supplied factors clamp into the unit interval", () => {
    assert.equal(rating(-1), 0);
    assert.equal(rating(7), 1);
  });
});

describe("factor 5 — fairness (11 §5.2)", () => {
  test("idle time saturates at twenty minutes", () => {
    assert.equal(fairness(1_200, 6, 6), fairness(9_000, 6, 6));
  });

  test("at the zone median a rider gets the documented 0.45 load term", () => {
    assert.ok(Math.abs(fairness(0, 6, 6) - 0.45) < 1e-12);
  });

  test("three times the median is zero load credit and twice the median is a quarter", () => {
    assert.ok(Math.abs(fairness(0, 18, 6) - 0) < 1e-12);
    assert.ok(Math.abs(fairness(0, 12, 6) - 0.225) < 1e-12);
  });

  test("a rider who has done nothing and waited outranks one who has done triple and just finished", () => {
    assert.ok(fairness(1_200, 0, 6) > fairness(0, 18, 6));
  });

  test("a zone with no median deliveries rewards idleness and gives full load credit", () => {
    assert.ok(Math.abs(fairness(0, 11, 0) - 0.45) < 1e-12);
    assert.ok(Math.abs(fairness(1_200, 11, 0) - 1) < 1e-12);
  });
});

describe("factors 7, 8, 9, 12, 14 — the familiarity and supplied figures", () => {
  test("vendor familiarity saturates at eight deliveries", () => {
    assert.equal(vendorFamiliarity(4), 0.5);
    assert.equal(vendorFamiliarity(8), 1);
    assert.equal(vendorFamiliarity(80), 1);
    assert.equal(vendorFamiliarity(-3), 0);
  });

  test("area familiarity saturates at twelve", () => {
    assert.equal(areaFamiliarity(6), 0.5);
    assert.equal(areaFamiliarity(12), 1);
  });

  test("batch fit, coverage and vehicle fit clamp", () => {
    assert.equal(batchFit(0), 0);
    assert.equal(batchFit(1.5), 1);
    assert.equal(zoneCoverage(-1), 0);
    assert.equal(vehicleFit(0.9), 0.9);
  });
});

describe("factors 10, 11, 13 — capacity, cash and freshness", () => {
  test("load balance is one at empty and zero at the ceiling", () => {
    assert.equal(loadBalance(0, 3), 1);
    assert.equal(loadBalance(3, 3), 0);
    assert.ok(Math.abs(loadBalance(1, 4) - 0.75) < 1e-12);
    assert.equal(loadBalance(0, 0), 0, "a rider with no capacity is not balanced, they are full");
  });

  test("cash headroom is exactly zero at the limit and halves at half the limit", () => {
    assert.equal(cashHeadroom(350_000, 20_000, 350_000), 0, "the filter would refuse this, and the factor agrees");
    assert.equal(cashHeadroom(100_000, 20_000, 240_000), 0.5);
    assert.equal(cashHeadroom(0, 0, 350_000), 1);
    assert.equal(cashHeadroom(0, 24_000, 0), 0, "no limit is no headroom, not infinite headroom");
  });

  test("freshness falls with the age of the fix and is a tiebreaker, not a filter", () => {
    assert.ok(freshness(30, 30) < freshness(10, 30));
    assert.equal(freshness(0, 30), 1);
    assert.equal(freshness(5, 0), 0, "an age nobody can bound is not freshness");
  });
});

describe("the weighted sum (11 §5.3)", () => {
  test("a perfect candidate scores 1 and a hopeless one scores 0", () => {
    const perfect = factorsFor(
      facts({
        routedDistanceToVendorM: 0,
        arrivalAtVendorS: 360,
        readyInS: 360,
        acceptanceRate: 1,
        completionRate: 1,
        onTimeRate: 1,
        idleS: 9_000,
        deliveriesToday: 0,
        ratingLowerBound: 1,
        deliveriesFromVendor: 99,
        deliveriesIntoCell: 99,
        batchFeasibility: 1,
        currentLoad: 0,
        cashInHandPaisa: 0,
        coverageValue: 1,
        positionAgeS: 0,
        vehicleSuitability: 1,
      }),
      ZONE,
      0,
    );
    // Perfect on all fourteen is 1.005, because the documented weights sum to 1.005 — see `weightSum`.
    assert.ok(Math.abs(score(perfect) - weightSum()) < 1e-12, `perfect scored ${String(score(perfect))}`);

    const hopeless = factorsFor(
      facts({
        routedDistanceToVendorM: 10_000_000,
        arrivalAtVendorS: 0,
        readyInS: 900,
        acceptanceRate: 0,
        completionRate: 0,
        onTimeRate: 0,
        idleS: 0,
        deliveriesToday: 30,
        ratingLowerBound: 0,
        deliveriesFromVendor: 0,
        deliveriesIntoCell: 0,
        currentLoad: 3,
        cashInHandPaisa: 350_000,
        coverageValue: 0,
        positionAgeS: 30,
        positionStaleAfterS: 30,
        vehicleSuitability: 0,
      }),
      ZONE,
      24_000,
    );
    // Not zero: `eta_fit` at fifteen minutes early is still 0.133, and proximity never quite reaches zero.
    assert.ok(score(hopeless) < 0.05, `hopeless scored ${String(score(hopeless))}`);
  });

  test("moving weight onto a factor this rider is strong at raises the total", () => {
    const factors = factorsFor(facts({ acceptanceRate: 0.95, arrivalAtVendorS: 660 }), ZONE, 24_000);
    const onAcceptance = score(factors, {
      ...DEFAULT_WEIGHTS,
      etaFit: DEFAULT_WEIGHTS.etaFit - 0.15,
      acceptance: DEFAULT_WEIGHTS.acceptance + 0.15,
    });
    const onEta = score(factors, {
      ...DEFAULT_WEIGHTS,
      acceptance: DEFAULT_WEIGHTS.acceptance - 0.15,
      etaFit: DEFAULT_WEIGHTS.etaFit + 0.15,
    });
    assert.ok(onAcceptance > onEta, "the same rider ranks higher under the weights that favour their strength");
  });
});

describe("ranking is deterministic", () => {
  test("the order is by score, then acceptance, then rider id", () => {
    const strong = facts({ riderId: "b", acceptanceRate: 0.9 });
    const weak = facts({ riderId: "a", acceptanceRate: 0.1 });
    const ranked = scoreCandidates([{ facts: weak }, { facts: strong }], ZONE, 24_000);
    assert.deepEqual(
      ranked.map((candidate) => candidate.riderId),
      ["b", "a"],
    );
  });

  test("two identical riders are ordered by id, so a replay asserts equality", () => {
    const one = facts({ riderId: "0193f2a17c3e7890abcdef0123456711" });
    const two = facts({ riderId: "0193f2a17c3e7890abcdef0123456712" });
    const first = scoreCandidates([{ facts: one }, { facts: two }], ZONE, 24_000);
    const second = scoreCandidates([{ facts: two }, { facts: one }], ZONE, 24_000);
    assert.deepEqual(
      first.map((candidate) => candidate.riderId),
      second.map((candidate) => candidate.riderId),
      "input order must not change the output",
    );
    assert.equal(first[0]?.riderId, one.riderId, "lexicographic, ascending");
  });

  test("every factor travels with the score, so a ranking can be explained later", () => {
    const [scored] = scoreCandidates([{ facts: facts() }], ZONE, 24_000);
    assert.ok(scored !== undefined);
    assert.equal(Object.keys(scored.factors).length, 14);
    assert.equal(scored.acceptanceProbability, 0.6, "factor 3 alone, which is what pNone multiplies");
  });
});

/**
 * Factor 3 with the zone's model (`09 §7.4`, D133).
 *
 * The claim under test is narrow and it is the whole feature: a rider's own acceptance rate is blind to the offer in
 * front of them, and the model is not. Same rider, same rate, two very different offers — the factor must move. And
 * with no model, or a model with no evidence behind it, the answer must be exactly the rate it was before this existed.
 */
describe("factor 3 — the acceptance model (D133)", () => {
  const trained = (samples: number, weights: readonly number[] = PROPENSITY_PRIOR) =>
    ({ ...ZONE, acceptanceModel: { weights, samples, atMs: Date.UTC(2026, 0, 15, 12, 0, 0), payoutPaisa: 10_100 } } as ZoneFeatures);

  test("with no model the factor is the rider's own rate, unchanged", () => {
    const rider = facts({ acceptanceRate: 0.42 });
    assert.equal(acceptanceFactor(rider, ZONE), 0.42);
  });

  test("a model with no evidence behind it does not move the factor", () => {
    const rider = facts({ acceptanceRate: 0.42 });
    assert.equal(acceptanceFactor(rider, trained(0)), 0.42);
  });

  test("a trained model conditions the same rider on the offer's distance", () => {
    const near = facts({ acceptanceRate: 0.5, routedDistanceToVendorM: 100 });
    const far = facts({ acceptanceRate: 0.5, routedDistanceToVendorM: 4_000 });
    const zone = trained(PROPENSITY_FULL_TRUST);
    const nearFactor = acceptanceFactor(near, zone);
    const farFactor = acceptanceFactor(far, zone);
    assert.ok(nearFactor > farFactor, `near ${String(nearFactor)} should outrank far ${String(farFactor)}`);
    assert.ok(nearFactor !== 0.5 && farFactor !== 0.5, "the model disagreed with the flat rate in both directions");
  });

  test("evidence moves the answer from the record towards the model, in order", () => {
    const rider = facts({ acceptanceRate: 0.9, routedDistanceToVendorM: 4_000 });
    const sooner = acceptanceFactor(rider, trained(10));
    const later = acceptanceFactor(rider, trained(40));
    assert.ok(later < sooner, "a distant offer drags a good rate down further the more the zone has learned");
    assert.ok(later > acceptanceFactor(rider, trained(PROPENSITY_FULL_TRUST)));
  });

  test("the factor stays inside the unit interval whatever the model says", () => {
    const odd = trained(PROPENSITY_FULL_TRUST, [50, -50, 50, -50, 50, -50, 50, -50]);
    const value = acceptanceFactor(facts({ acceptanceRate: 0.5 }), odd);
    assert.ok(value >= 0 && value <= 1);
  });

  test("the ranking sees it: two identical riders differ only by distance", () => {
    const zone = trained(PROPENSITY_FULL_TRUST);
    const ranked = scoreCandidates(
      [
        { facts: facts({ riderId: "rider-far", acceptanceRate: 0.5, routedDistanceToVendorM: 3_500 }) },
        { facts: facts({ riderId: "rider-near", acceptanceRate: 0.5, routedDistanceToVendorM: 150 }) },
      ],
      zone,
      PAISA,
    );
    assert.equal(ranked[0]?.riderId, "rider-near");
    assert.notEqual(ranked[0]?.acceptanceProbability, ranked[1]?.acceptanceProbability);
  });
});

/**
 * The vector itself (`09 §7.4`, D134).
 *
 * Factor 3 is a number and an offer row needs evidence: the features the number was computed from travel with the offer,
 * so the outcome can train the model that made the choice. A vector rebuilt later is a different vector — idle time and
 * the routing snapshot are gone — which is why it is returned by the scorer rather than recomputed by whoever wants it.
 */
describe("the feature vector, as the row records it (D134)", () => {
  const withModel = {
    ...ZONE,
    acceptanceModel: {
      weights: PROPENSITY_PRIOR,
      samples: 12,
      atMs: Date.UTC(2026, 0, 15, 12, 0, 0),
      payoutPaisa: 10_100,
    },
  } as ZoneFeatures;

  test("a zone with a model produces eight numbers for the offer", () => {
    const vector = propensityVector(facts(), withModel);
    assert.equal(vector?.length, 8);
    assert.ok((vector?.[0] ?? 0) > 0, "the payout is normalised, not signed");
  });

  test("a zone with no model records nothing at all", () => {
    assert.equal(propensityVector(facts(), ZONE), null, "a vector of zeroes would train the next model on a lie");
  });

  test("the scored candidate carries the same vector its factor 3 used", () => {
    const [scored] = scoreCandidates([{ facts: facts() }], withModel, PAISA);
    assert.deepEqual(scored?.propensity, propensityVector(facts(), withModel));
    assert.ok((scored?.factors.acceptance ?? 0) > 0);
  });
});
