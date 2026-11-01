/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { groupBdt, machineBdt } from "../src/group-bdt.ts";

describe("groupBdt — Bangladeshi lakh/crore grouping", () => {
  test("groups below a thousand with no separators", () => {
    assert.equal(groupBdt(0).amount, "0.00");
    assert.equal(groupBdt(99_999).amount, "999.99");
  });

  test("groups the thousand boundary", () => {
    assert.equal(groupBdt(100_000).amount, "1,000.00");
    assert.equal(groupBdt(999_999).amount, "9,999.99");
  });

  test("groups a lakh as 1,00,000 — not 100,000", () => {
    assert.equal(groupBdt(10_000_000).amount, "1,00,000.00");
    assert.equal(groupBdt(24_999_999).amount, "2,49,999.99");
  });

  test("groups a crore as 1,00,00,000", () => {
    assert.equal(groupBdt(1_000_000_000).amount, "1,00,00,000.00");
    assert.equal(groupBdt(123_456_789_000).amount, "1,23,45,67,890.00");
  });

  test("always shows two decimals, even on a round taka", () => {
    assert.equal(groupBdt(32_000).amount, "320.00");
  });

  test("prefixes the symbol, a thin space, and a real minus", () => {
    assert.equal(groupBdt(5_490_000).withSymbol, "৳\u200954,900.00");
    assert.equal(groupBdt(-1_500).withSymbol, "−৳\u200915.00");
  });

  test("emits the fixed-width machine form for payment files", () => {
    assert.equal(machineBdt(5_490_000), "BDT 54900.00");
    assert.equal(machineBdt(-1_500), "BDT -15.00");
  });
});
