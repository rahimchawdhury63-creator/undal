/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { ApiError, apiCall, queryString, toApiError } from "../src/lib/api.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Replace `fetch` with one canned envelope. */
function respond(body: unknown, status = 200): { readonly calls: string[] } {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls };
}

describe("query building", () => {
  it("drops null, undefined and empty values rather than sending them", () => {
    assert.equal(queryString({ state: "pending", method: null, cursor: undefined, kind: "" }), "?state=pending");
  });

  it("renders booleans as true, not 1", () => {
    assert.equal(queryString({ breach: true }), "?breach=true");
  });

  it("returns nothing when the filter set is empty", () => {
    assert.equal(queryString({}), "");
    assert.equal(queryString(undefined), "");
  });
});

describe("the console's client", () => {
  it("sends the bearer token and unwraps the envelope", async () => {
    const canned = respond({ ok: true, data: { settlements: [] } });
    const data = await apiCall("/v1/finance/cash/settlements", { token: "abc", query: { state: "pending" } });
    assert.deepEqual(data, { settlements: [] });
    assert.match(canned.calls[0] ?? "", /\/v1\/finance\/cash\/settlements\?state=pending$/u);
  });

  it("keeps the contract code and request id from a refusal", async () => {
    respond({ ok: false, error: { code: "VALIDATION_REQUIRED", message: "reason required" }, meta: { requestId: "req-9" } }, 422);
    await assert.rejects(
      () => apiCall("/v1/finance/cash/settlements/x/reject", { method: "POST", token: "abc", body: {} }),
      (failure: unknown) => {
        assert.equal((failure as ApiError).code, "VALIDATION_REQUIRED");
        assert.equal((failure as ApiError).requestId, "req-9");
        assert.equal((failure as ApiError).retryable, false);
        return true;
      },
    );
  });

  it("reports a 403 as a permission refusal, not a bug", async () => {
    respond({ ok: false, error: { code: "FORBIDDEN", message: "no permission" } }, 403);
    await assert.rejects(
      () => apiCall("/v1/finance/cash/settlements", { token: "abc" }),
      (failure: unknown) => (failure as ApiError).status === 403,
    );
  });

  it("distinguishes a cancellation from an unreachable server", async () => {
    globalThis.fetch = (async () => {
      throw new DOMException("aborted", "AbortError");
    }) as typeof fetch;
    await assert.rejects(
      () => apiCall("/v1/orders", { token: "abc" }),
      (failure: unknown) => (failure as ApiError).code === "ABORTED" && (failure as ApiError).retryable === false,
    );
  });

  it("coerces an unrecognised failure into a retryable NETWORK error", () => {
    const coerced = toApiError(undefined);
    assert.equal(coerced.code, "NETWORK");
    assert.equal(coerced.retryable, true);
  });
});
