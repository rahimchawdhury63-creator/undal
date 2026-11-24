/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * What a device sends, and what the write budget costs (`07 §3.2–3.3`, `§8.1`, D96).
 *
 * The interesting tests are not the six rules in isolation but the two claims the document makes with numbers:
 * a rider's idle heartbeat is one write every five minutes, and a 3.8 km delivery costs about 54 writes. Both
 * are simulated here by driving a synthetic rider along the legs of `07 §8.1` at the stated speeds and counting
 * the writes the gate actually allows.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AT_DROP_RADIUS_M,
  angularDeltaDegrees,
  batteryScale,
  cadenceFor,
  phaseFor,
  shouldSend,
} from "../src/d1/cadence.ts";
import type { CadenceProfile, DeviceFix, RiderPhase, SentFix } from "../src/d1/cadence.ts";

const T0 = 1_793_612_345_678;
const LAT = 249_000_000;
const LON = 918_700_000;
const METRES_PER_DEGREE = 111_320;

const atMetresNorth = (metres: number): number => LAT + Math.round((metres / METRES_PER_DEGREE) * 1e7);

const fix = (overrides: Partial<DeviceFix> = {}): DeviceFix => ({
  latE7: LAT,
  lonE7: LON,
  accuracyM: 10,
  bearingDeg: 0,
  atMs: T0,
  ...overrides,
});

const sent = (overrides: Partial<SentFix> = {}): SentFix => ({
  latE7: LAT,
  lonE7: LON,
  bearingDeg: 0,
  sentAtMs: T0,
  ...overrides,
});

const profile = (overrides: Partial<CadenceProfile> = {}): CadenceProfile => ({
  displacementM: 100,
  floorMs: 10_000,
  ceilingMs: 60_000,
  ...overrides,
});

describe("the profile table", () => {
  test("each row of §3.3 is the row the situation deserves", () => {
    assert.deepEqual(cadenceFor("IDLE_STATIONARY"), { displacementM: 150, floorMs: 20_000, ceilingMs: 300_000 });
    assert.deepEqual(cadenceFor("IDLE_MOVING"), { displacementM: 150, floorMs: 15_000, ceilingMs: 120_000 });
    assert.deepEqual(cadenceFor("TO_VENDOR"), { displacementM: 100, floorMs: 10_000, ceilingMs: 60_000 });
    assert.deepEqual(cadenceFor("CARRYING_FAR"), { displacementM: 100, floorMs: 8_000, ceilingMs: 45_000 });
    assert.deepEqual(cadenceFor("CARRYING_NEAR"), { displacementM: 60, floorMs: 6_000, ceilingMs: 25_000 });
    assert.deepEqual(cadenceFor("AT_DROP"), { displacementM: 40, floorMs: 5_000, ceilingMs: 15_000 });
  });

  test("a rider on break has no displacement rule at all: only the ten-minute heartbeat", () => {
    const onBreak = cadenceFor("BREAK");
    assert.equal(onBreak.displacementM, null);
    assert.equal(onBreak.ceilingMs, 600_000);
  });

  test("the battery widens every threshold, once at 15% and harder at 8%", () => {
    assert.equal(batteryScale(15), 1, "exactly fifteen is still normal");
    assert.equal(batteryScale(14), 1.5);
    assert.equal(batteryScale(8), 1.5);
    assert.equal(batteryScale(7), 2.5);
    assert.equal(batteryScale(null), 1, "a device that will not say is not punished");
    assert.deepEqual(cadenceFor("AT_DROP", 6), { displacementM: 100, floorMs: 12_500, ceilingMs: 37_500 });
  });
});

describe("which phase a rider is in", () => {
  const phase = (input: Partial<Parameters<typeof phaseFor>[0]> = {}): RiderPhase =>
    phaseFor({ onBreak: false, carrying: false, distanceToDropM: null, moving: false, ...input });

  test("idle is stationary or moving", () => {
    assert.equal(phase(), "IDLE_STATIONARY");
    assert.equal(phase({ moving: true }), "IDLE_MOVING");
  });

  test("carrying splits at a kilometre and again at the gate", () => {
    assert.equal(phase({ carrying: true, distanceToDropM: 3_400 }), "CARRYING_FAR");
    assert.equal(phase({ carrying: true, distanceToDropM: 1_000 }), "CARRYING_NEAR");
    assert.equal(phase({ carrying: true, distanceToDropM: AT_DROP_RADIUS_M }), "AT_DROP");
  });

  test("break outranks carrying, because the app has been told the rider stopped", () => {
    assert.equal(phase({ onBreak: true, carrying: true, distanceToDropM: 100 }), "BREAK");
  });
});

describe("the six rules", () => {
  test("an inaccurate fix is dropped before the first-fix rule", () => {
    assert.deepEqual(shouldSend(fix({ accuracyM: 61 }), null, profile()), { send: false, reason: "poor_accuracy" });
  });

  test("the first fix after a gap is always sent", () => {
    assert.deepEqual(shouldSend(fix(), null, profile()), { send: true, reason: "first_fix" });
  });

  test("the ceiling forces a write even for a rider who has not moved", () => {
    const last = sent({ sentAtMs: T0 });
    assert.deepEqual(shouldSend(fix({ atMs: T0 + 60_000 }), last, profile()), { send: true, reason: "ceiling" });
  });

  test("inside the floor nothing is sent, however far the rider has moved", () => {
    const last = sent({ sentAtMs: T0 });
    const far = fix({ latE7: atMetresNorth(400), atMs: T0 + 2_000 });
    assert.deepEqual(shouldSend(far, last, profile()), { send: false, reason: "floor" });
  });

  test("displacement buys a write past the floor", () => {
    const last = sent({ sentAtMs: T0 });
    const moved = fix({ latE7: atMetresNorth(100), atMs: T0 + 15_000 });
    assert.deepEqual(shouldSend(moved, last, profile()), { send: true, reason: "displacement" });
  });

  test("a turn at walking pace is informative within the displacement threshold", () => {
    const last = sent({ sentAtMs: T0, bearingDeg: 0 });
    const turned = fix({ latE7: atMetresNorth(40), bearingDeg: 90, atMs: T0 + 15_000 });
    assert.deepEqual(shouldSend(turned, last, profile()), { send: true, reason: "turn" });
  });

  test("a rider who has not moved and has not turned is a stationary drop", () => {
    const last = sent({ sentAtMs: T0 });
    assert.deepEqual(shouldSend(fix({ atMs: T0 + 15_000 }), last, profile()), { send: false, reason: "stationary" });
  });

  test("a change of order state buys a write without waiting for the ceiling", () => {
    const last = sent({ sentAtMs: T0 });
    assert.deepEqual(shouldSend(fix({ atMs: T0 + 15_000 }), last, profile(), true), { send: true, reason: "state_change" });
  });

  test("on break, movement is worth nothing: the heartbeat alone speaks", () => {
    const onBreak = cadenceFor("BREAK");
    const last = sent({ sentAtMs: T0 });
    const moved = fix({ latE7: atMetresNorth(2_000), atMs: T0 + 60_000 });
    assert.deepEqual(shouldSend(moved, last, onBreak), { send: false, reason: "stationary" });
    assert.deepEqual(shouldSend(moved, last, onBreak, true), { send: true, reason: "state_change" });
  });
});

describe("bearings", () => {
  test("the shortest way round the compass", () => {
    assert.equal(angularDeltaDegrees(0, 90), 90);
    assert.equal(angularDeltaDegrees(0, 350), 10);
    assert.equal(angularDeltaDegrees(350, 10), 20);
    assert.equal(angularDeltaDegrees(0, 180), 180);
    assert.equal(angularDeltaDegrees(null, 90), 0);
  });
});

/**
 * Drive a synthetic rider and count the writes.
 *
 * Legs are `[metres, metresPerSecond, phase, extraSeconds]`. A fix is offered at 1 Hz — what a phone actually
 * produces — and the gate decides which ones reach the wire.
 */
function drive(
  legs: readonly (readonly [number, number, RiderPhase, number])[],
  batteryPct?: number | null,
): { writes: number; reasons: Record<string, number> } {
  let t = T0;
  let along = 0;
  let last: SentFix | null = null;
  const reasons: Record<string, number> = {};
  const write = (point: SentFix, reason: string): void => {
    last = point;
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  };

  for (const [metres, mps, phase, dwellSeconds] of legs) {
    const cadence = cadenceFor(phase, batteryPct);
    const steps = Math.max(1, Math.round(metres / mps));
    for (let step = 0; step < steps; step += 1) {
      t += 1_000;
      along += mps;
      const decision = shouldSend(fix({ latE7: atMetresNorth(along), atMs: t }), last, cadence);
      if (decision.send) write({ latE7: atMetresNorth(along), lonE7: LON, bearingDeg: 0, sentAtMs: t }, decision.reason);
    }
    for (let second = 0; second < dwellSeconds; second += 1) {
      t += 1_000;
      const decision = shouldSend(fix({ latE7: atMetresNorth(along), atMs: t }), last, cadence);
      if (decision.send) write({ latE7: atMetresNorth(along), lonE7: LON, bearingDeg: 0, sentAtMs: t }, decision.reason);
    }
  }

  return { writes: Object.values(reasons).reduce((sum, count) => sum + count, 0), reasons };
}

describe("the write budget", () => {
  test("a five-minute idle heartbeat is one write, not sixty", () => {
    // Five minutes of a stationary rider: the opening fix and then exactly one heartbeat.
    const idle = drive([[0, 0.0001, "IDLE_STATIONARY", 300]]);
    assert.deepEqual(idle.reasons, { first_fix: 1, ceiling: 1 });
  });

  test("the documented 3.8 km delivery costs about fifty-four writes", () => {
    // `07 §8.1`, leg by leg: metres, average speed, phase, dwell time at the stop.
    const delivery = drive([
      [1_200, 20_000 / 3_600, "TO_VENDOR", 0],
      [0, 0.0001, "TO_VENDOR", 240],
      [1_600, 22_000 / 3_600, "CARRYING_FAR", 0],
      [800, 18_000 / 3_600, "CARRYING_NEAR", 0],
      [200, 10_000 / 3_600, "AT_DROP", 0],
      [0, 0.0001, "AT_DROP", 60],
    ]);
    assert.equal(
      delivery.writes >= 45 && delivery.writes <= 65,
      true,
      `a delivery drew ${String(delivery.writes)} writes: ${JSON.stringify(delivery.reasons)}`,
    );
    assert.equal((delivery.reasons.displacement ?? 0) > 20, true, "movement is what pays, not the clock");
  });

  test("low battery costs fewer writes, which is the point of the multiplier", () => {
    const leg: readonly (readonly [number, number, RiderPhase, number])[] = [[1_200, 20_000 / 3_600, "TO_VENDOR", 0]];
    const healthy = drive(leg);
    const critical = drive(leg, 6);
    assert.equal(healthy.writes > critical.writes, true, `healthy ${String(healthy.writes)} vs critical ${String(critical.writes)}`);
    // Rounded, because 100 m × 2.5 is 250 and a write lands on the first fix at or past 250 m.
    assert.equal(cadenceFor("TO_VENDOR", 6).displacementM, 250);
  });
});
