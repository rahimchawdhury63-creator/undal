/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { ApiError, apiRequest, loaded, toApiError } from "../src/lib/api.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Replace `fetch` with one canned response. */
function respond(body: unknown, status = 200): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
}

describe("envelope parsing", () => {
  it("unwraps data from a success envelope", async () => {
    respond({ ok: true, data: { vendors: [] }, meta: { requestId: "r1" } });
    assert.deepEqual(await apiRequest("/v1/public/areas"), { vendors: [] });
  });

  it("throws the contract code from an error envelope", async () => {
    respond({ ok: false, error: { code: "CATALOG_VENDOR_NOT_FOUND", message: "no such vendor", retryable: false } }, 404);
    await assert.rejects(
      () => apiRequest("/v1/public/vendors/nope"),
      (failure: unknown) => {
        assert.equal(failure instanceof ApiError, true);
        assert.equal((failure as ApiError).code, "CATALOG_VENDOR_NOT_FOUND");
        assert.equal((failure as ApiError).status, 404);
        return true;
      },
    );
  });

  it("reports a network failure as NETWORK rather than a TypeError", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await assert.rejects(() => apiRequest("/v1/public/areas"), (failure: unknown) => (failure as ApiError).code === "NETWORK");
  });

  it("distinguishes an abort from a network failure", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => apiRequest("/v1/public/areas", { signal: controller.signal }),
      (failure: unknown) => (failure as ApiError).code === "ABORTED",
    );
  });

  it("coerces an unrecognised throw into a retryable NETWORK error", () => {
    const coerced = toApiError("something odd");
    assert.equal(coerced.code, "NETWORK");
    assert.equal(coerced.retryable, true);
  });

  it("passes an ApiError through unchanged", () => {
    const original = new ApiError({ code: "RATE_LIMITED", status: 429, message: "slow down" });
    assert.equal(toApiError(original), original);
  });
});

describe("loaded", () => {
  it("returns the value on success", async () => {
    assert.deepEqual(await loaded(async () => 42), { ok: true, data: 42 });
  });

  it("returns the error instead of throwing", async () => {
    const result = await loaded(async () => {
      throw new ApiError({ code: "NETWORK", status: 0, message: "offline" });
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.error.code, "NETWORK");
  });
});
