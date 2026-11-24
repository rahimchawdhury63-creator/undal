/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { assertPaisa, isWholeTaka, paisa, PAISA_MAX, sumPaisa } from "../src/paisa.ts";

describe("Paisa — integer-only money", () => {
  test("rejects a fractional amount, which is the whole point of the brand", () => {
    assert.throws(() => assertPaisa(54_981.5), RangeError);
  });

  test("rejects NaN and Infinity", () => {
    assert.throws(() => assertPaisa(Number.NaN), RangeError);
    assert.throws(() => assertPaisa(Number.POSITIVE_INFINITY), RangeError);
  });

  test("rejects a value past the safe range rather than losing precision", () => {
    assert.throws(() => assertPaisa(PAISA_MAX * 2), RangeError);
  });

  test("sums an order's postings exactly", () => {
    const postings = [paisa(54_900), paisa(-37_400), paisa(-8_370), paisa(-3_000), paisa(-6_130)];
    assert.equal(sumPaisa(postings), 0, "double-entry postings must close to zero");
  });

  test("refuses to sum into lost precision", () => {
    assert.throws(() => sumPaisa([paisa(PAISA_MAX), paisa(PAISA_MAX)]), RangeError);
  });

  test("knows which amounts are whole taka", () => {
    assert.equal(isWholeTaka(paisa(54_900)), true);
    assert.equal(isWholeTaka(paisa(54_981)), false);
  });
});
