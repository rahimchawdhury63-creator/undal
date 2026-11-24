/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  PAGE_LIMIT,
  decodeCursor,
  encodeCursor,
  nextCursor,
  normalizeLimit,
} from "../src/common/pagination.ts";

interface Row {
  readonly id: string;
  readonly rating: string;
}

describe("cursor pagination", () => {
  test("round-trips a cursor", () => {
    const cursor = { key: "4.8", id: "018f3a2c-7b1e-7c9a-9f2e-1a2b3c4d5e6f" };
    assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor);
  });

  test("produces an opaque, URL-safe token", () => {
    const token = encodeCursor({ key: "2026-11-01T08:00:00.000Z", id: "a" });
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    assert.ok(!token.includes("="));
  });

  test("treats a malformed cursor as 'start from the first page'", () => {
    for (const bad of ["", "not-base64!!", Buffer.from("{}").toString("base64url"), null, undefined]) {
      assert.equal(decodeCursor(bad), null);
    }
  });

  test("rejects a cursor that is not a two-element pair", () => {
    assert.equal(decodeCursor(Buffer.from("[\"only-key\"]").toString("base64url")), null);
    assert.equal(decodeCursor(Buffer.from("[1,2]").toString("base64url")), null);
  });

  test("clamps the requested page size instead of failing the request", () => {
    assert.equal(normalizeLimit(undefined), PAGE_LIMIT.default);
    assert.equal(normalizeLimit("0"), 1);
    assert.equal(normalizeLimit("999"), 100);
    assert.equal(normalizeLimit("7"), 7);
    assert.equal(normalizeLimit("abc"), PAGE_LIMIT.default);
  });

  test("uses the extra fetched row to decide whether a next page exists", () => {
    const rows: Row[] = [
      { id: "018f3a2c-7b1e-7c9a-9f2e-000000000001", rating: "4.9" },
      { id: "018f3a2c-7b1e-7c9a-9f2e-000000000002", rating: "4.8" },
      { id: "018f3a2c-7b1e-7c9a-9f2e-000000000003", rating: "4.7" },
    ];
    const { page, nextCursor: token } = nextCursor(rows, 2, (row) => row.rating, (row) => row.id);
    assert.equal(page.length, 2);
    assert.deepEqual(decodeCursor(token), { key: "4.8", id: rows[1]?.id });
  });

  test("returns no cursor on the last page", () => {
    const rows: Row[] = [{ id: "018f3a2c-7b1e-7c9a-9f2e-000000000001", rating: "4.9" }];
    const { page, nextCursor: token } = nextCursor(rows, 2, (row) => row.rating, (row) => row.id);
    assert.equal(page.length, 1);
    assert.equal(token, null);
  });
});
