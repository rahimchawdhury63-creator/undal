/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ERROR_COUNT, ERRORS, isErrorCode } from "@undal/contracts";

/**
 * The console's error register is the contract's, not a copy of it.
 *
 * This file exists because "the screen reads the register" is a claim, and a claim about the one
 * table a support agent reads aloud to a customer deserves a test. If somebody reintroduces a
 * local list of codes, the count assertion here is the tripwire.
 */

describe("the error register the console renders", () => {
  test("carries every code the contract defines, and no others", () => {
    assert.equal(Object.keys(ERRORS).length, ERROR_COUNT);
    assert.equal(ERROR_COUNT, 187);
  });

  test("every row is complete: a status, both languages, a payload shape and a retry flag", () => {
    for (const [code, definition] of Object.entries(ERRORS)) {
      assert.equal(definition.code, code);
      assert.ok(Number.isInteger(definition.status) && definition.status >= 400, `${code} status`);
      assert.ok(definition.en.trim().length > 0, `${code} en`);
      assert.ok(definition.bn.trim().length > 0, `${code} bn`);
      assert.ok(definition.details.trim().length > 0, `${code} details`);
      assert.equal(typeof definition.retryable, "boolean", `${code} retryable`);
    }
  });

  test("the copy is not the same string in both languages", () => {
    // A row whose Bangla copy is its English copy is a row nobody translated; the register test in
    // the contracts package checks this too, and the console fails with it rather than after it.
    for (const [code, definition] of Object.entries(ERRORS)) {
      assert.notEqual(definition.bn, definition.en, `${code} is untranslated`);
    }
  });

  test("the guest-facing codes the storefront depends on are present", () => {
    for (const code of [
      "AUTH_TOKEN_MISSING",
      "VALIDATION_ID_MALFORMED",
      "CATALOG_OUTSIDE_ZONE",
      "ORDER_NOT_FOUND",
      "ZONE_NOT_FOUND",
      "INTERNAL",
    ]) {
      assert.equal(isErrorCode(code), true, code);
    }
  });
});
