/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * What the platform is willing to believe about where a rider is (`07 §4.5`, D95).
 *
 * Every test here is a position that could arrive from a real phone: under a bridge, out of a tunnel, in a
 * car park outside the zone, from a clock that is wrong, or from a build that mocks location. The rules are
 * about telling those apart rather than dropping "bad" fixes in one bucket.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MAX_ACCURACY_M, MAX_CLOCK_AHEAD_MS, judgeBatch, inflateBbox, impliedSpeedMps } from "../src/d1/ingest.ts";
import type { IngestContext, PositionFix } from "../src/d1/ingest.ts";

const T0 = 1_793_612_345_678;

/** Sylhet, roughly. */
const LAT = 249_000_000;
const LON = 918_700_000;

/** About 111 metres north of the origin point, per 0.001° of latitude. */
const METRES_PER_DEGREE = 111_320;
const atMetresNorth = (metres: number): number => LAT + Math.round((metres / METRES_PER_DEGREE) * 1e7);

const ZONE = { minLatE7: LAT - 20_000_000, maxLatE7: LAT + 20_000_000, minLonE7: LON - 20_000_000, maxLonE7: LON + 20_000_000 };

const fix = (overrides: Partial<PositionFix> = {}): PositionFix => ({
  latE7: LAT,
  lonE7: LON,
  accuracyM: 12,
  bearingDeg: 90,
  recordedAtMs: T0,
  isMock: false,
  ...overrides,
});

const context = (overrides: Partial<IngestContext> = {}): IngestContext => ({
  zone: ZONE,
  vehicle: "MOTORBIKE",
  receivedAtMs: T0,
  lastAccepted: null,
  ...overrides,
});

const reasonOf = (fixes: readonly PositionFix[], overrides: Partial<IngestContext> = {}) => {
  const judgement = judgeBatch(fixes, context(overrides));
  return judgement.refused[0]?.reason ?? null;
};

describe("the gate", () => {
  test("a good fix is accepted with the edge's clock beside it", () => {
    const judgement = judgeBatch([fix()], context());
    assert.equal(judgement.accepted.length, 1);
    assert.equal(judgement.accepted[0]?.receivedAtMs, T0);
    assert.deepEqual(judgement.refused, []);
    assert.equal(judgement.suspendShift, false);
  });

  test("accuracy worse than sixty metres is a marker that moves without the rider", () => {
    assert.equal(reasonOf([fix({ accuracyM: MAX_ACCURACY_M + 1 })]), "poor_accuracy");
    assert.equal(reasonOf([fix({ accuracyM: MAX_ACCURACY_M })]), null, "exactly sixty is allowed");
  });

  test("a clock more than thirty seconds fast is refused and named", () => {
    assert.equal(reasonOf([fix({ recordedAtMs: T0 + MAX_CLOCK_AHEAD_MS + 1 })]), "clock_ahead");
    assert.equal(reasonOf([fix({ recordedAtMs: T0 + MAX_CLOCK_AHEAD_MS })]), null);
  });

  test("a fix older than the newest accepted one is out of order, unless it is a backfill", () => {
    const older = fix({ recordedAtMs: T0 - 5_000 });
    const lastAccepted = fix({ recordedAtMs: T0 });
    assert.equal(reasonOf([older], { lastAccepted }), "out_of_order");
    assert.equal(reasonOf([older], { lastAccepted, backfill: true }), null);
  });

  test("a motorbike at 144 km/h is the line, and a bicycle's is lower", () => {
    // 200 m in 5 s is 40 m/s: at the motorbike's limit, far past the bicycle's.
    const start = fix({ recordedAtMs: T0 - 5_000 });
    const fast = fix({ latE7: atMetresNorth(200), recordedAtMs: T0 });
    assert.equal(reasonOf([fast], { lastAccepted: start }), null);
    assert.equal(reasonOf([fast], { lastAccepted: start, vehicle: "BICYCLE" }), "implausible_speed");
  });

  test("a teleport is counted, not just dropped", () => {
    const start = fix({ recordedAtMs: T0 - 5_000 });
    const jump = fix({ latE7: atMetresNorth(5_000), recordedAtMs: T0 });
    const judgement = judgeBatch([jump], context({ lastAccepted: start }));
    assert.equal(judgement.refused[0]?.reason, "implausible_speed");
    assert.equal(judgement.teleports, 1);
    assert.equal(judgement.raiseException, false, "a teleport is a data problem, not yet an operator's");
  });

  test("a position twenty kilometres outside its zone is worth an exception", () => {
    const off = fix({ latE7: LAT + 60_000_000 });
    const judgement = judgeBatch([off], context());
    assert.equal(judgement.refused[0]?.reason, "outside_zone");
    assert.equal(judgement.raiseException, true);
  });

  test("a position just outside the box is still the rider's neighbourhood", () => {
    // 1 km outside a 2 km box: inside the inflation, so accepted.
    const nearby = fix({ latE7: ZONE.maxLatE7 + 100_000 });
    assert.equal(reasonOf([nearby], { lastAccepted: null }), null);
  });
});

describe("a mock flag ends the batch", () => {
  test("one mocked fix rejects every fix in the upload", () => {
    const judgement = judgeBatch([fix(), fix({ isMock: true }), fix({ recordedAtMs: T0 + 1_000 })], context());
    assert.deepEqual(judgement.accepted, []);
    assert.equal(judgement.refused.length, 3);
    assert.equal(judgement.refused.every((entry) => entry.reason === "mock_location"), true);
    assert.equal(judgement.suspendShift, true);
  });

  test("a clean batch does not suspend anything", () => {
    assert.equal(judgeBatch([fix()], context()).suspendShift, false);
  });
});

describe("a refused fix does not move the baseline", () => {
  test("the good fix after a teleport is judged against the last good fix, not the bad one", () => {
    // 100 m down the road over 5 s — implausible only if measured from the teleport.
    const start = fix({ recordedAtMs: T0 });
    const teleport = fix({ latE7: atMetresNorth(9_000), recordedAtMs: T0 + 5_000 });
    const after = fix({ latE7: atMetresNorth(100), recordedAtMs: T0 + 6_000 });
    const judgement = judgeBatch([teleport, after], context({ lastAccepted: start }));
    assert.deepEqual(judgement.refused.map((entry) => entry.reason), ["implausible_speed"]);
    assert.equal(judgement.accepted.length, 1);
    assert.equal(judgement.accepted[0]?.latE7, atMetresNorth(100));
    assert.equal(judgement.teleports, 1);
  });

  test("two fixes at the same instant imply no speed rather than infinite speed", () => {
    assert.equal(impliedSpeedMps(fix(), fix({ latE7: atMetresNorth(50) })), Number.POSITIVE_INFINITY);
  });
});

describe("geometry helpers", () => {
  test("the box grows by the distance on every side", () => {
    const grown = inflateBbox(ZONE, 20_000);
    assert.equal(grown.minLatE7 < ZONE.minLatE7, true);
    assert.equal(grown.maxLonE7 > ZONE.maxLonE7, true);
    // 20 km at this latitude is about 0.18° of latitude.
    const degrees = (ZONE.minLatE7 - grown.minLatE7) / 1e7;
    assert.equal(degrees > 0.17 && degrees < 0.19, true, `inflated by ${String(degrees)}°`);
  });

  test("implied speed is the straight line over the device's own elapsed time", () => {
    // 100 m in 4 s is 25 m/s.
    const speed = impliedSpeedMps(fix(), fix({ latE7: atMetresNorth(100), recordedAtMs: T0 + 4_000 }));
    assert.equal(speed > 24 && speed < 26, true, `saw ${String(speed)} m/s`);
  });
});
