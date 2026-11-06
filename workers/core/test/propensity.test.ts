/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The acceptance-propensity model (`09 §7.4`, D133).
 *
 * The module exists to make factor 3 conditional — "would *this* rider take *this* offer" — and the tests are the four
 * things that make it trustworthy rather than merely present: the eight features are the document's eight, in the
 * document's order, because that order is the stored format; every feature is a magnitude in `[0, 1]` with the signs in
 * the weights; the update moves the weight the way the outcome says it should, and the L2 term shrinks it every step;
 * and the blend hands over from a rider's own record to the zone's model at a rate the zone can see.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  blendPropensity,
  IDLE_UNIT_S,
  isPropensityWeights,
  learnStep,
  MAX_LOGIT,
  PAYOUT_UNIT_PAISA,
  PICKUP_UNIT_M,
  predictAcceptance,
  PROPENSITY_FEATURES,
  PROPENSITY_FULL_TRUST,
  PROPENSITY_L2,
  PROPENSITY_PRIOR,
  PROPENSITY_SIZE,
  propensityFeatures,
  readPropensityModel,
  sigmoid,
} from "../src/domain/order/propensity.ts";

const PAISA = 10_000;

describe("the model's shape (09 §7.4)", () => {
  test("eight features, in the order the weights are stored", () => {
    assert.equal(PROPENSITY_FEATURES.length, 8);
    assert.equal(PROPENSITY_SIZE, 8);
    assert.deepEqual([...PROPENSITY_FEATURES], ["payout", "pickup", "trip", "idle", "todSin", "todCos", "weather", "batch"]);
    assert.equal(PROPENSITY_PRIOR.length, 8);
    assert.equal(isPropensityWeights(PROPENSITY_PRIOR), true);
  });

  test("the prior's signs are the ones an operator should be able to read", () => {
    const weight = (name: (typeof PROPENSITY_FEATURES)[number]): number =>
      PROPENSITY_PRIOR[PROPENSITY_FEATURES.indexOf(name)] as number;
    assert.ok(weight("payout") > 0, "a better payout helps");
    assert.ok(weight("pickup") < 0, "farther away hurts");
    assert.ok(weight("trip") < 0);
    assert.ok(weight("idle") > 0, "a rider who has waited takes the next one");
    assert.ok(weight("batch") < 0);
    assert.ok(weight("weather") < 0);
  });

  test("a coefficient vector that is not eight finite numbers is not a model", () => {
    assert.equal(isPropensityWeights([1, 2, 3]), false);
    assert.equal(isPropensityWeights([...PROPENSITY_PRIOR, 0]), false);
    assert.equal(isPropensityWeights([...PROPENSITY_PRIOR.slice(1), Number.NaN]), false);
    assert.equal(isPropensityWeights("weights"), false);
  });

  test("a config row is read leniently, and a broken one is absent rather than fatal", () => {
    assert.deepEqual(readPropensityModel({ weights: [0, 1, 2, 3, 4, 5, 6, 7], samples: 12 }), {
      weights: [0, 1, 2, 3, 4, 5, 6, 7],
      samples: 12,
      trainedThroughMs: 0,
    });
    assert.equal(
      readPropensityModel({ weights: [0, 1, 2, 3, 4, 5, 6, 7], samples: 1, trainedThroughMs: 1_700_000_000_000 })
        ?.trainedThroughMs,
      1_700_000_000_000,
      "the watermark is how a training pass knows where it got to (D135)",
    );
    assert.equal(
      readPropensityModel({ weights: [0, 1, 2, 3, 4, 5, 6, 7], samples: 1, trainedThroughMs: -5 })?.trainedThroughMs,
      0,
    );
    assert.deepEqual(readPropensityModel({ weights: [0, 1, 2, 3, 4, 5, 6, 7], samples: 9_999 })?.samples, PROPENSITY_FULL_TRUST);
    assert.equal(readPropensityModel({ weights: [1, 2, 3] }), null);
    assert.equal(readPropensityModel({ samples: 4 }), null);
    assert.equal(readPropensityModel(null), null);
  });
});

describe("prediction", () => {
  test("the sigmoid is clamped at the logit the document clamps", () => {
    assert.ok(Math.abs(sigmoid(0) - 0.5) < 1e-12);
    assert.equal(sigmoid(MAX_LOGIT * 100), sigmoid(MAX_LOGIT), "the clamp is what keeps exp() finite");
    assert.ok(sigmoid(MAX_LOGIT) > 0.999, "a huge logit is still a probability");
    assert.ok(sigmoid(-MAX_LOGIT) < 0.001);
    assert.equal(sigmoid(Number.NaN), 0.5, "a broken logit is the uninformative answer");
  });

  test("a dominated offer predicts lower than a good one", () => {
    const good = propensityFeatures({ payoutPaisa: 2 * PAISA, pickupDistanceM: 200, tripDistanceM: 2_000, idleS: 900, atMs: 0 });
    const bad = propensityFeatures({ payoutPaisa: 3_000, pickupDistanceM: 4_000, tripDistanceM: 8_000, idleS: 0, atMs: 0 });
    assert.ok(predictAcceptance(PROPENSITY_PRIOR, good) > predictAcceptance(PROPENSITY_PRIOR, bad));
  });

  test("a vector of the wrong length answers the uninformative probability, not a guess", () => {
    assert.equal(predictAcceptance([1, 2], [0.5, 0.5]), 0.5);
    assert.equal(predictAcceptance(PROPENSITY_PRIOR, [0.5]), 0.5);
  });
});

describe("the online step (09 §7.4)", () => {
  test("an accepted offer raises the weight on a present feature, a rejected one lowers it", () => {
    const zero: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0];
    const features = [0.8, 0, 0, 0, 0, 0, 0, 0];
    const up = learnStep(zero, { features, accepted: true }, 0.01);
    const down = learnStep(zero, { features, accepted: false }, 0.01);
    assert.ok((up[0] as number) > 0, "the feature was present and the rider took it");
    assert.ok((down[0] as number) < 0);
  });

  test("L2 shrinks every weight, present or not", () => {
    const weights: readonly number[] = [1, -1, 0, 0, 0, 0, 0, 0];
    const moved = learnStep(weights, { features: [0, 0, 0, 0, 0, 0, 0, 0], accepted: true }, 0.1);
    // p = 0.5, y = 1 -> g = -0.5, but every feature is zero, so only the penalty acts.
    assert.ok(Math.abs((moved[0] as number) - (1 - 0.1 * PROPENSITY_L2 * 1)) < 1e-12);
    assert.ok(Math.abs((moved[1] as number) - (-1 - 0.1 * PROPENSITY_L2 * -1)) < 1e-12);
    assert.equal(moved[2], 0);
  });

  test("the update returns a new vector: a model that mutates itself cannot be replayed", () => {
    const weights: readonly number[] = [...PROPENSITY_PRIOR];
    const moved = learnStep(weights, { features: [1, 1, 1, 1, 1, 1, 1, 1], accepted: false });
    assert.notEqual(moved, weights);
    assert.deepEqual(weights, [...PROPENSITY_PRIOR]);
    assert.notDeepEqual(moved, weights);
  });

  test("many accepted offers converge towards certainty without leaving [0, 1]", () => {
    let weights: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0];
    const features = [1, 0, 0, 0, 0, 0, 0, 0];
    for (let step = 0; step < 2_000; step += 1) weights = learnStep(weights, { features, accepted: true });
    const probability = predictAcceptance(weights, features);
    assert.ok(probability > 0.9 && probability <= 1, `learned ${String(probability)}`);
  });
});

describe("blending the model with the record (D133)", () => {
  test("a zone with no outcomes is judged by the rider's own rate", () => {
    assert.equal(blendPropensity(0.9, 0.3, 0), 0.3);
  });

  test("a fully trained zone is judged by the model", () => {
    assert.equal(blendPropensity(0.9, 0.3, PROPENSITY_FULL_TRUST), 0.9);
    assert.equal(blendPropensity(0.9, 0.3, PROPENSITY_FULL_TRUST * 4), 0.9, "more evidence than the cap changes nothing");
  });

  test("halfway is halfway", () => {
    assert.ok(Math.abs(blendPropensity(1, 0, PROPENSITY_FULL_TRUST / 2) - 0.5) < 1e-12);
  });

  test("a broken input never produces a probability outside [0, 1]", () => {
    assert.equal(blendPropensity(5, -2, 10), 10 / 50);
    assert.equal(blendPropensity(Number.NaN, 0.4, 0), 0.4);
    assert.equal(blendPropensity(0.2, Number.NaN, PROPENSITY_FULL_TRUST), 0.2);
  });
});

describe("the feature vector", () => {
  const at = (isoHour: number): number => Date.UTC(2026, 0, 15, isoHour, 0, 0);

  test("every magnitude is normalised, so the signs live in the weights", () => {
    const features = propensityFeatures({
      payoutPaisa: PAYOUT_UNIT_PAISA,
      pickupDistanceM: PICKUP_UNIT_M,
      tripDistanceM: 8_000,
      idleS: IDLE_UNIT_S,
      atMs: at(6),
    });
    assert.equal(features.length, 8);
    assert.equal(features[0], 1, "৳100 is the payout unit");
    assert.equal(features[1], 1, "2 km is the pickup unit");
    assert.equal(features[2], 1);
    assert.equal(features[3], 1);
    for (const value of features) assert.ok(value >= 0 && value <= 1, `${String(value)} is a magnitude, not a sign`);
  });

  test("a huge payout or a negative distance clamps instead of running away", () => {
    const features = propensityFeatures({
      payoutPaisa: 100 * PAISA,
      pickupDistanceM: -5_000,
      tripDistanceM: Number.NaN,
      idleS: -1,
      atMs: at(6),
    });
    assert.equal(features[0], 1);
    assert.equal(features[1], 0);
    assert.equal(features[2], 0);
    assert.equal(features[3], 0);
  });

  test("time of day is a pair, because 23:59 and 00:01 are two minutes apart in a rider's life", () => {
    const late = propensityFeatures({ payoutPaisa: 0, pickupDistanceM: 0, tripDistanceM: 0, idleS: 0, atMs: at(18) });
    const later = propensityFeatures({ payoutPaisa: 0, pickupDistanceM: 0, tripDistanceM: 0, idleS: 0, atMs: at(19) });
    // Nearby hours give nearby features, which a bare hour number would not.
    assert.ok(Math.abs((late[4] as number) - (later[4] as number)) < 0.5);
    assert.ok(Math.abs((late[5] as number) - (later[5] as number)) < 0.5);
    assert.ok(Math.abs((late[4] as number) - 0.5) <= 0.5);
    assert.ok(Math.abs((late[5] as number) - 0.5) <= 0.5);
  });

  test("weather and batch are what they are, and absent means zero", () => {
    const stormy = propensityFeatures({
      payoutPaisa: 0,
      pickupDistanceM: 0,
      tripDistanceM: 0,
      idleS: 0,
      atMs: at(6),
      weatherSeverity: 0.8,
      batch: true,
    });
    assert.equal(stormy[6], 0.8);
    assert.equal(stormy[7], 1);
    const plain = propensityFeatures({ payoutPaisa: 0, pickupDistanceM: 0, tripDistanceM: 0, idleS: 0, atMs: at(6) });
    assert.equal(plain[6], 0, "no weather feed is not bad weather");
    assert.equal(plain[7], 0);
  });
});
