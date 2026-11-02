/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The typed client for `undal-realtime`, against a stubbed `fetch`.
 *
 * The client's whole job is to turn four outcomes — envelope, failure envelope, non-2xx, no answer —
 * into two Results the caller can act on without thinking. The broadcast is a notification, so every
 * failure degrades; none of them throws into an order transition.
 */

import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { createRealtimeClient } from "../src/bindings/realtime.ts";

const BASE = "https://rt.undal.app";
const TOKEN = "internal-secret";

const realFetch = globalThis.fetch;

/** Replace `fetch` for one test and remember what was sent. */
function stubFetch(make: (url: string, init: RequestInit) => Promise<Response>): { readonly calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return make(url, init ?? {});
  }) as typeof fetch;
  return { calls };
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("realtime client", () => {
  test("a broadcast sends the token and body to the internal path", async () => {
    const stub = stubFetch(async () => Response.json({ ok: true, data: { recorded: 2 } }));
    const client = createRealtimeClient(BASE, TOKEN);
    const result = await client.broadcast({
      zoneId: "zone-1",
      orderId: "UND-7K2M9QX4",
      event: "order.assigned",
      payload: { riderId: "r1" },
    });
    assert.deepEqual(result, { ok: true, value: true });
    assert.equal(stub.calls[0]?.url, `${BASE}/internal/broadcast`);
    const headers = stub.calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(headers["content-type"], "application/json");
    assert.equal(JSON.parse(String(stub.calls[0]?.init.body)).orderId, "UND-7K2M9QX4");
  });

  test("a presence answer is unwrapped from the envelope", async () => {
    stubFetch(async () =>
      Response.json({ ok: true, data: { online: true, lastSeenAt: "2026-11-02T09:00:00.000Z" } }),
    );
    const result = await createRealtimeClient(BASE, TOKEN).presenceOf({ zoneId: "zone-1", riderId: "rider-a" });
    assert.equal(result.ok, true);
    assert.deepEqual(result.ok ? result.value : null, {
      online: true,
      lastSeenAt: "2026-11-02T09:00:00.000Z",
    });
  });

  test("a 500 degrades instead of throwing", async () => {
    stubFetch(async () => new Response("upstream on fire", { status: 500 }));
    const result = await createRealtimeClient(BASE, TOKEN).broadcast({
      zoneId: "zone-1",
      orderId: "o1",
      event: "order.placed",
      payload: {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, "SERVICE_DEGRADED");
  });

  test("a refusal the Worker explains is not mistaken for a success", async () => {
    stubFetch(async () =>
      Response.json(
        { ok: false, error: { code: "PERM_DENIED", message: "no", messageBn: "না", field: null, retryable: false, details: {} } },
        { status: 403 },
      ),
    );
    const result = await createRealtimeClient(BASE, TOKEN).presenceOf({ zoneId: "zone-1", riderId: "rider-a" });
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, "SERVICE_DEGRADED");
  });

  test("a network failure is a timeout, which is retryable", async () => {
    stubFetch(async () => {
      throw new Error("connection reset");
    });
    const result = await createRealtimeClient(BASE, TOKEN).broadcast({
      zoneId: "zone-1",
      orderId: "o1",
      event: "order.placed",
      payload: {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.ok ? null : result.error.code, "DEPENDENCY_TIMEOUT");
  });

  test("a 2xx that is not an envelope is refused rather than passed through", async () => {
    stubFetch(async () => Response.json({ online: true }));
    const result = await createRealtimeClient(BASE, TOKEN).presenceOf({ zoneId: "zone-1", riderId: "rider-a" });
    assert.equal(result.ok, false);
  });
});
