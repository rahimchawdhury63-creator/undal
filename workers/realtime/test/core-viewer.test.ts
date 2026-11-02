/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The order-authorization client, against a stubbed transport.
 *
 * Every test here has the same shape: something other than a clean `allowed:true` arrives, and the viewer
 * says no. That is the only interesting property of a client whose answer decides whether a stranger reads
 * an order, so the suite is a list of ways the answer can fail to arrive.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CORE_WATCH_TIMEOUT_MS, WATCH_PATH, createCoreOrderViewer } from "../src/authority/core-viewer.ts";

const BASE = "https://api.undal.app";
const TOKEN = "internal-secret";
const QUESTION = { actorId: "cust-a", actorType: "CUSTOMER", orderId: "UND-7K2M9QX4" } as const;

/** The transport plus its calls, which is what the tests read. */
function stub(answer: (url: string, init: RequestInit) => Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return answer(url, init ?? {});
  }) as typeof fetch;
  return { calls, transport };
}

describe("the order-authorization client", () => {
  test("a clean yes is a yes, and the request carries the token and the question", async () => {
    const { calls, transport } = stub(async () => Response.json({ ok: true, data: { allowed: true, reason: "owner" } }));
    const viewer = createCoreOrderViewer(BASE, TOKEN, { fetch: transport });
    assert.equal(await viewer.mayWatch(QUESTION), true);
    assert.equal(calls[0]?.url, `${BASE}${WATCH_PATH}`);
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { ...QUESTION });
  });

  test("a trailing slash on the base is not doubled", async () => {
    const { calls, transport } = stub(async () => Response.json({ ok: true, data: { allowed: true } }));
    const viewer = createCoreOrderViewer(`${BASE}/`, TOKEN, { fetch: transport });
    await viewer.mayWatch(QUESTION);
    assert.equal(calls[0]?.url, `${BASE}${WATCH_PATH}`);
  });

  test("an explicit no is a no", async () => {
    const { transport } = stub(async () => Response.json({ ok: true, data: { allowed: false, reason: "not_party" } }));
    assert.equal(await createCoreOrderViewer(BASE, TOKEN, { fetch: transport }).mayWatch(QUESTION), false);
  });

  test("a yes with no allowed flag is a no", async () => {
    const { transport } = stub(async () => Response.json({ ok: true, data: { reason: "owner" } }));
    assert.equal(await createCoreOrderViewer(BASE, TOKEN, { fetch: transport }).mayWatch(QUESTION), false);
  });

  test("an envelope with ok:false is a no, even if it says allowed", async () => {
    const { transport } = stub(async () =>
      Response.json({ ok: false, error: { code: "AUTH_TOKEN_INVALID" }, data: { allowed: true } }),
    );
    assert.equal(await createCoreOrderViewer(BASE, TOKEN, { fetch: transport }).mayWatch(QUESTION), false);
  });

  test("a non-2xx is a no, and its body is never parsed", async () => {
    const { transport } = stub(
      async () => new Response("<html>bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }),
    );
    assert.equal(await createCoreOrderViewer(BASE, TOKEN, { fetch: transport }).mayWatch(QUESTION), false);
  });

  test("a body that is not JSON is a no", async () => {
    const { transport } = stub(async () => new Response("not json", { status: 200 }));
    assert.equal(await createCoreOrderViewer(BASE, TOKEN, { fetch: transport }).mayWatch(QUESTION), false);
  });

  test("a transport that throws is a no", async () => {
    const { transport } = stub(async () => {
      throw new TypeError("fetch failed");
    });
    assert.equal(await createCoreOrderViewer(BASE, TOKEN, { fetch: transport }).mayWatch(QUESTION), false);
  });

  test("a transport that never answers is abandoned at the timeout, as a no", async () => {
    const { transport } = stub(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const started = Date.now();
    const viewer = createCoreOrderViewer(BASE, TOKEN, { fetch: transport, timeoutMs: 20 });
    assert.equal(await viewer.mayWatch(QUESTION), false);
    assert.ok(Date.now() - started < 1_000, "the abandonment is the configured timeout, not the default one");
  });

  test("the default timeout is shorter than a client's patience", () => {
    assert.ok(CORE_WATCH_TIMEOUT_MS > 0 && CORE_WATCH_TIMEOUT_MS <= 1_500);
  });
});
