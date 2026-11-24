/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { floorToTaka } from "../src/floor-to-taka.ts";
import { isWholeTaka } from "../src/paisa.ts";

describe("floorToTaka — one floor, at the end", () => {
  test("turns the money law's pre-round total into the cash total", () => {
    const { total, delta } = floorToTaka(54_981);
    assert.equal(total, 54_900);
    assert.equal(delta, -81);
  });

  test("leaves a whole-taka total untouched", () => {
    const { total, delta } = floorToTaka(50_000);
    assert.equal(total, 50_000);
    assert.equal(delta, 0);
  });

  test("the delta is always in (−100, 0] and the result is always whole taka", () => {
    for (let amount = 0; amount <= 300_000; amount += 7) {
      const { total, delta } = floorToTaka(amount);
      assert.ok(delta <= 0 && delta > -100, `delta out of range at ${amount}: ${delta}`);
      assert.ok(isWholeTaka(total), `total not whole taka at ${amount}: ${total}`);
      assert.equal(amount + delta, total, "the delta must account for every paisa");
      assert.ok(!Object.is(delta, -0), `delta must never be -0 at ${amount}`);
    }
  });

  test("refuses a negative amount rather than inventing a refund", () => {
    assert.throws(() => floorToTaka(-1), RangeError);
    assert.throws(() => floorToTaka(-54_981), RangeError);
  });
});
