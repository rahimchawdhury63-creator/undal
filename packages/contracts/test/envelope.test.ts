/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { failure, statusFor, success } from "../src/envelope/build.ts";
import { ERRORS } from "../src/errors/registry.ts";

describe("the response envelope", () => {
  test("success carries data and meta with a UTC timestamp", () => {
    const envelope = success({ vendors: [] }, { requestId: "req-1", ts: "2026-11-01T08:23:17.482Z" });
    assert.equal(envelope.ok, true);
    assert.deepEqual(envelope.data, { vendors: [] });
    assert.equal(envelope.meta.requestId, "req-1");
    assert.match(envelope.meta.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("failure copies both messages from the registry, not from the caller", () => {
    const envelope = failure("ORDER_ALREADY_CANCELLED", { requestId: "req-2" });
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, "ORDER_ALREADY_CANCELLED");
    assert.equal(envelope.error.message, ERRORS.ORDER_ALREADY_CANCELLED.en);
    assert.equal(envelope.error.messageBn, ERRORS.ORDER_ALREADY_CANCELLED.bn);
    assert.equal(envelope.error.retryable, false);
    assert.equal(envelope.error.field, null);
    assert.deepEqual(envelope.error.details, {});
  });

  test("failure carries the field path for validation errors", () => {
    const envelope = failure("VALIDATION_PHONE_INVALID", {
      requestId: "req-3",
      field: "customer.phone",
      details: { field: "customer.phone" },
    });
    assert.equal(envelope.error.field, "customer.phone");
    assert.deepEqual(envelope.error.details, { field: "customer.phone" });
  });

  test("the HTTP status is a property of the code", () => {
    assert.equal(statusFor("INTERNAL"), 500);
    assert.equal(statusFor("RATE_LIMITED"), 429);
    assert.equal(statusFor("AUTH_ACCOUNT_SUSPENDED"), 451);
    assert.equal(statusFor("QUOTE_EXPIRED"), 410);
    assert.equal(statusFor("CATALOG_VENDOR_NOT_FOUND"), 404);
  });

  test("an injected clock makes a failure reproducible in tests", () => {
    const envelope = failure("INTERNAL", {
      requestId: "req-4",
      now: new Date("2026-11-01T00:00:00.000Z"),
    });
    assert.equal(envelope.meta.ts, "2026-11-01T00:00:00.000Z");
  });
});
