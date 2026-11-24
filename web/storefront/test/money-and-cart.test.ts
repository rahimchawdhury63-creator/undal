/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lineKey, lineTotalPaisa, itemCount, subtotalPaisa, type CartLine } from "../src/lib/cart.ts";

/** A line with the fields under test; everything else is a fixed, plausible value. */
function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    key: "k",
    itemId: "i1",
    name: "Kacchi",
    nameBn: "কাচ্চি",
    unitPricePaisa: 32_000,
    modifiers: [],
    quantity: 1,
    note: null,
    imageUrl: null,
    ...overrides,
  };
}

describe("cart arithmetic", () => {
  it("multiplies unit price by quantity in integer paisa", () => {
    assert.equal(lineTotalPaisa(line({ quantity: 3 })), 96_000);
  });

  it("adds modifier deltas before multiplying, so a modifier is charged per item", () => {
    const withCheese = line({
      quantity: 2,
      modifiers: [{ id: "m1", nameEn: "Cheese", nameBn: "চিজ", priceDeltaPaisa: 4_000 }],
    });
    assert.equal(lineTotalPaisa(withCheese), 72_000);
  });

  it("never produces a fractional amount", () => {
    const total = subtotalPaisa([line({ quantity: 7, unitPricePaisa: 9_999 })]);
    assert.equal(Number.isInteger(total), true);
    assert.equal(total, 69_993);
  });

  it("sums a basket", () => {
    assert.equal(subtotalPaisa([line(), line({ key: "b", unitPricePaisa: 15_000, quantity: 2 })]), 62_000);
  });

  it("counts items by quantity, not by line", () => {
    assert.equal(itemCount([line({ quantity: 2 }), line({ key: "b", quantity: 5 })]), 7);
  });
});

describe("cart line identity", () => {
  it("treats the same dish with the same options as one line", () => {
    assert.equal(lineKey("i1", ["a", "b"], null), lineKey("i1", ["b", "a"], null));
  });

  it("separates the same dish with different options", () => {
    assert.notEqual(lineKey("i1", ["a"], null), lineKey("i1", ["a", "b"], null));
  });

  it("separates the same dish with a different note", () => {
    assert.notEqual(lineKey("i1", [], "no onion"), lineKey("i1", [], null));
  });
});
