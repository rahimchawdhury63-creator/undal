/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The delta-encoded upload (`07 §4.1–4.2`, D97).
 *
 * The numbers in these tests come straight from the worked example in the document: a base at 24.894215 /
 * 91.868912 and a delta of `[412, -238, 14200, 18, 42, 97]`. If the units are right, 412 units of 1e-6 of a
 * degree is 4 120 e7 units, which is about forty-six metres — a rider two seconds into a turn at speed.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { BATCH_MAX_POSITIONS, DELTA_MAX_UNITS, TRAIL_CAPACITY, parseBatch, ringSlots } from "../src/d1/batch.ts";

const BASE = { lat: 24.894215, lon: 91.868912, t: 1_762_000_123_456, acc: 12, brg: 90 };
const LAT_E7 = 248_942_150;
const LON_E7 = 918_689_120;

const body = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  shiftId: "shift-1",
  seq: 7,
  base: BASE,
  d: [[412, -238, 14_200, 18, 42, 97]],
  ...overrides,
});

const parsed = (overrides: Record<string, unknown> = {}) => {
  const result = parseBatch(body(overrides));
  assert.equal(result.ok, true, `expected a parse, got ${JSON.stringify(result)}`);
  return result.ok ? result.batch : null;
};

const refusal = (overrides: Record<string, unknown> | unknown): string | null => {
  const result = parseBatch(overrides);
  return result.ok ? null : result.reason;
};

describe("the delta encoding", () => {
  test("a base and a delta become two positions in e7, in order", () => {
    const batch = parsed()!;
    assert.equal(batch.fixes.length, 2);
    assert.deepEqual(batch.fixes[0]?.latE7, LAT_E7);
    assert.deepEqual(batch.fixes[0]?.lonE7, LON_E7);
    assert.equal(batch.fixes[1]?.latE7, LAT_E7 + 4_120, "412 units of 1e-6° is ten e7 units each");
    assert.equal(batch.fixes[1]?.lonE7, LON_E7 - 2_380);
    assert.equal(batch.fixes[1]?.recordedAtMs, BASE.t + 14_200);
    assert.equal(batch.fixes[1]?.accuracyM, 18);
    assert.equal(batch.fixes[1]?.bearingDeg, 42);
  });

  test("a delta with no accuracy of its own inherits the base's", () => {
    const batch = parsed({ d: [[100, 100, 1_000, null, null]] })!;
    assert.equal(batch.fixes[1]?.accuracyM, 12);
    assert.equal(batch.fixes[1]?.bearingDeg, null);
  });

  test("the device's counter is carried, wrapped into the ring", () => {
    assert.equal(parsed()!.seqStart, 7);
    assert.equal(parsed({ seq: 127 })!.seqStart, 7);
  });

  test("a batch is bounded at twelve positions, and the thirteenth is a refusal", () => {
    const eleven = Array.from({ length: BATCH_MAX_POSITIONS - 1 }, () => [10, 10, 1_000] as const);
    assert.equal(parsed({ d: eleven })!.fixes.length, BATCH_MAX_POSITIONS);
    assert.equal(refusal(body({ d: [...eleven, [10, 10, 1_000]] })), "too_many_positions");
  });
});

describe("the parser is strict on purpose", () => {
  test("a body that is not an object is refused", () => {
    assert.equal(refusal([] as unknown), "not_an_object");
    assert.equal(refusal("nope" as unknown), "not_an_object");
    assert.equal(refusal(null as unknown), "not_an_object");
  });

  test("a batch with no shift cannot be stored against one", () => {
    assert.equal(refusal(body({ shiftId: "" })), "missing_shift");
    assert.equal(refusal(body({ shiftId: "x".repeat(65) })), "missing_shift");
  });

  test("an upload with no deltas is not an upload", () => {
    assert.equal(refusal(body({ d: [] })), "no_positions");
    assert.equal(refusal(body({ d: undefined })), "no_positions");
  });

  test("a base without coordinates or accuracy is refused whole", () => {
    assert.equal(refusal(body({ base: { lat: 24.9, lon: 91.8 } })), "bad_base");
    assert.equal(refusal(body({ base: { ...BASE, acc: null } })), "bad_base");
    assert.equal(refusal(body({ base: { ...BASE, lat: 91 } })), "bad_base");
  });

  test("a delta that is not three finite integers is a client bug, and named as one", () => {
    assert.equal(refusal(body({ d: [[1, 2]] })), "bad_delta");
    assert.equal(refusal(body({ d: [["1", "2", "3"]] })), "bad_delta");
    assert.equal(refusal(body({ d: [[1.5, 2, 3]] })), "bad_delta");
  });

  test("a delta past eleven kilometres, or backwards in time, is too large", () => {
    assert.equal(refusal(body({ d: [[DELTA_MAX_UNITS + 1, 0, 1_000]] })), "delta_too_large");
    assert.equal(refusal(body({ d: [[0, 0, -1]] })), "delta_too_large");
    assert.equal(refusal(body({ d: [[0, 0, 3_600_000]] })), "delta_too_large");
  });

  test("the mock flag marks every position in the batch, which is what suspends a shift", () => {
    const batch = parsed({ mock: true, d: [[10, 10, 1_000], [20, 20, 2_000]] })!;
    assert.equal(batch.fixes.every((fix) => fix.isMock), true);
  });
});

describe("ring slots", () => {
  test("the counter wraps at the capacity rather than growing", () => {
    assert.deepEqual(ringSlots(118, 4), [118, 119, 0, 1]);
    assert.deepEqual(ringSlots(0, 2), [0, 1]);
    assert.equal(TRAIL_CAPACITY, 120);
  });

  test("a counter from a phone that thinks it is negative still lands in the ring", () => {
    assert.deepEqual(ringSlots(-1, 2), [119, 0]);
  });

  test("slots advance for every position offered, refused or not", () => {
    // The device's counter counts fixes, not accepted fixes: eleven slots for eleven positions.
    assert.equal(ringSlots(10, 11).length, 11);
    assert.equal(ringSlots(10, 11)[10], 20);
  });
});
