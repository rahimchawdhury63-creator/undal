/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ERROR_COUNT, ERRORS, errorDefinition, isErrorCode } from "../src/errors/registry.ts";

/** The per-prefix counts `08 §11` registers. If these change, the contract changed. */
const EXPECTED_COUNTS: Readonly<Record<string, number>> = {
  AUTH_: 21,
  PERM_: 8,
  VALIDATION_: 14,
  CATALOG_: 17,
  QUOTE_: 9,
  ORDER_: 31,
  OFFER_: 11,
  QR_: 6,
  SHIFT_: 13,
  CASH_: 11,
  MONEY_: 13,
  KYC_: 10,
  MEDIA_: 8,
  ZONE_: 7,
  RATE_: 3,
};

const BENGALI = /[\u0980-\u09FF]/;

describe("error registry — 187 codes, six fields each", () => {
  test("registers exactly the number the specification promised", () => {
    assert.equal(ERROR_COUNT, 187);
  });

  test("matches the per-prefix counts of 08 §11", () => {
    const actual: Record<string, number> = {};
    for (const code of Object.keys(ERRORS)) {
      const match = /^(AUTH_|OAUTH_|PERM_|VALIDATION_|CATALOG_|QUOTE_|ORDER_|OFFER_|QR_|SHIFT_|CASH_|MONEY_|KYC_|MEDIA_|ZONE_|RATE_)/.exec(code);
      // `08 §11` groups the three OAUTH_ codes inside its AUTH_ row, so the test
      // folds them together rather than inventing a sixteenth group.
      const prefix = match?.[1] === "OAUTH_" ? "AUTH_" : (match?.[1] ?? "BARE");
      actual[prefix] = (actual[prefix] ?? 0) + 1;
    }
    for (const [prefix, expected] of Object.entries(EXPECTED_COUNTS)) {
      assert.equal(actual[prefix], expected, `${prefix} count`);
    }
    // The five platform-wide codes are bare strings; see rows/system.ts.
    assert.equal(actual.BARE, 5);
  });

  test("every code carries English and Bangla copy that differ", () => {
    for (const [code, definition] of Object.entries(ERRORS)) {
      assert.ok(definition.en.length > 0, `${code} has no English message`);
      assert.ok(definition.bn.length > 0, `${code} has no Bangla message`);
      assert.match(definition.bn, BENGALI, `${code} Bangla message is not in Bangla script`);
      assert.notEqual(definition.en, definition.bn, `${code} is untranslated`);
    }
  });

  test("every code documents its details shape", () => {
    for (const [code, definition] of Object.entries(ERRORS)) {
      assert.ok(
        definition.details.startsWith("{") && definition.details.endsWith("}"),
        `${code} details shape is not an object description`,
      );
    }
  });

  test("no copy mentions TODO, lorem ipsum or a placeholder", () => {
    for (const [code, definition] of Object.entries(ERRORS)) {
      for (const text of [definition.en, definition.bn]) {
        assert.ok(!/todo|lorem|placeholder|xxx/i.test(text), `${code} contains placeholder copy`);
      }
    }
  });

  test("retryable is honest about what a second attempt can achieve", () => {
    /** Arithmetic the platform got wrong: retrying reproduces it exactly. */
    const deterministicFaults = new Set([
      "MONEY_INVOICE_UNBALANCED",
      "MONEY_ROUNDING_INVARIANT",
      "MONEY_SETTLEMENT_MISMATCH",
    ]);

    for (const [code, definition] of Object.entries(ERRORS)) {
      if (definition.status === 501) {
        assert.equal(definition.retryable, false, `${code} is not built yet; a retry cannot fix that`);
      }
      if (definition.status === 502 || definition.status === 504) {
        assert.equal(definition.retryable, true, `${code} is a transient dependency failure`);
      }
      if (deterministicFaults.has(code)) {
        assert.equal(definition.retryable, false, `${code} reproduces on every retry`);
      }
      // `INTERNAL` (500) is retryable because an unhandled fault may well be
      // transient, and 503 is unpinned: `RATE_LIMITED_GLOBAL` is worth retrying
      // while `OAUTH_NOT_CONFIGURED` stays broken until an admin acts.
    }
  });

  test("the lookup helpers agree with the registry", () => {
    assert.equal(isErrorCode("ORDER_NOT_FOUND"), true);
    assert.equal(isErrorCode("ORDER_NOT_A_CODE"), false);
    assert.equal(errorDefinition("QR_TOO_FAR").status, 422);
    assert.throws(() => errorDefinition("NOPE" as never), RangeError);
  });
});
