/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { applyRate } from "../src/apply-rate.ts";
import { floorToTaka } from "../src/floor-to-taka.ts";
import { groupBdt } from "../src/group-bdt.ts";

/**
 * The refusals, which are the half of the money law that is easiest to lose.
 *
 * A rounding bug produces a number that is wrong; a missing refusal produces a number that is
 * *plausible* — one and a half paisa, a float, a negative total that the schema then refuses
 * three layers later with a message nobody can act on. Each of these paths exists to fail at
 * the call site with the offending value in the message, so the money coverage gate treats
 * them as code that has to run, not as defensive noise.
 */

describe("applyRate refuses what is not integer money", () => {
  test("a fractional amount is rejected, with the value", () => {
    assert.throws(() => applyRate(1_234.5, 1_500), /amount must be integer paisa, got 1234\.5/u);
  });

  test("a fractional rate is rejected", () => {
    assert.throws(() => applyRate(10_000, 12.5), /rate must be integer basis points/u);
  });

  test("a product that leaves the safe integer range is rejected rather than rounded", () => {
    assert.throws(() => applyRate(Number.MAX_SAFE_INTEGER, 10_000), /left the safe integer range/u);
  });

  test("the ties still round to even on both signs", () => {
    assert.equal(applyRate(5, 1_000), 0, "0.5 rounds to even zero");
    assert.equal(applyRate(15, 1_000), 2, "1.5 rounds to even two");
    assert.ok(Object.is(applyRate(-5, 1_000), 0), "a tie to zero is +0, never -0");
    assert.equal(applyRate(-15, 1_000), -2);
  });
});

describe("floorToTaka refuses what it cannot floor honestly", () => {
  test("a non-integer is rejected", () => {
    assert.throws(() => floorToTaka(2_000.5), /expected integer paisa/u);
  });

  test("a negative total is rejected, because a refund is not a floored negative", () => {
    assert.throws(() => floorToTaka(-1), /customer totals are never negative/u);
  });

  test("zero floors to zero with no delta", () => {
    assert.deepEqual(floorToTaka(0), { total: 0, delta: 0 });
  });
});

describe("groupBdt refuses a float and groups the digits", () => {
  test("a non-integer is rejected", () => {
    assert.throws(() => groupBdt(1.5), /expected integer paisa/u);
  });

  test("lakh grouping is a comma every two digits after the first group", () => {
    assert.equal(groupBdt(1_234_500)["amount"], "12,345.00");
    assert.equal(groupBdt(0)["amount"], "0.00");
  });
});
