/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { applyRate } from "../src/apply-rate.ts";
import { generateVectors } from "./vectors.ts";

describe("applyRate — the single rounding point", () => {
  test("reproduces the money law's worked example (vector 01)", () => {
    // ৳450.00 subtotal × 800 bps platform margin = ৳52.20 exactly, no rounding.
    assert.equal(applyRate(45_000, 800), 3_600);
    // ৳1 087.2875 net-fare share at 800 bps: 8 725 × 600 = 5 235 exactly.
    assert.equal(applyRate(8_725, 600), 524);
  });

  test("rounds ties to even, in both directions", () => {
    // 1 250 × 500 = 625 000 → 62.5 → 62 (even).
    assert.equal(applyRate(1_250, 500), 62);
    // 3 750 × 500 = 1 875 000 → 187.5 → 188 (even).
    assert.equal(applyRate(3_750, 500), 188);
    // 3 × 5 000 = 15 000 → 1.5 → 2 (even).
    assert.equal(applyRate(3, 5_000), 2);
    // 1 × 5 000 = 5 000 → 0.5 → 0 (even).
    assert.equal(applyRate(1, 5_000), 0);
  });

  test("matches the fare sheet's hand-computed tax line", () => {
    // ৳87.72 taxable × 500 bps = ৳4.386 → ৳4.39 (438.6 paisa rounds up).
    assert.equal(applyRate(8_772, 500), 439);
    // ৳104.32 × 500 bps = ৳5.216 → ৳5.22.
    assert.equal(applyRate(10_432, 500), 522);
  });

  test("zero rate and zero amount are both exactly zero", () => {
    assert.equal(applyRate(0, 1_500), 0);
    assert.equal(applyRate(123_456, 0), 0);
  });

  test("preserves sign for credits", () => {
    assert.equal(applyRate(-8_772, 500), -439);
    assert.equal(applyRate(-1_250, 500), -62);
  });

  test("is monotonic in the amount — a bigger base never yields less", () => {
    let previous = -1;
    for (let amount = 0; amount <= 200_000; amount += 137) {
      const value = applyRate(amount, 1_500);
      assert.ok(value >= previous, `not monotonic at ${amount}`);
      previous = value;
    }
  });

  test("never drifts more than half a paisa from the exact product", () => {
    for (const vector of generateVectors(5_000)) {
      const value = applyRate(vector.amount, vector.rateBps);
      const exact = (vector.amount * vector.rateBps) / 10_000;
      assert.ok(Math.abs(value - exact) <= 0.5, `drift at ${vector.amount}/${vector.rateBps}`);
    }
  });

  test("rejects non-integer input rather than rounding it silently", () => {
    assert.throws(() => applyRate(100.5, 800), RangeError);
    assert.throws(() => applyRate(100, 8.5), RangeError);
  });
});
