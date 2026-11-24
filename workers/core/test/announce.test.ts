/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Telling the watchers.
 *
 * The property that matters is the one that is easy to lose: a broadcast that fails must never fail the
 * order. Every test below is a way the stream can misbehave — unconfigured, unreachable, 500, slow — and the
 * assertion is always the same, that the caller got its answer and nothing threw.
 */

import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { announce } from "../src/bindings/announce.ts";
import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";
import { ORDER_ROUTES } from "../src/routes/orders.ts";
import type { Ctx } from "../src/middleware/context.ts";

const ORDER_ID = "0193f2a1-7c3e-7890-abcd-ef0123456789";
const OWNER_ID = "03030303030303030303030303030303";
const VENDOR_ID = new Uint8Array(16).fill(2);

const realFetch = globalThis.fetch;

/** Replace `fetch` for one test and remember what was sent. */
function stubFetch(make: (url: string, init: RequestInit) => Promise<Response>): { readonly calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return make(String(input), init ?? {});
  }) as typeof fetch;
  return { calls };
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A context that records what it was told to wait for. */
function ctxWith(env = testEnv({ REALTIME_BASE: "https://rt.undal.example", INTERNAL_TOKEN: "internal" }), db = stubDb([])): {
  ctx: Ctx;
  readonly pending: Promise<unknown>[];
} {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    env,
    db,
    url: new URL("https://api.undal.example/v1/orders"),
    request: new Request("https://api.undal.example/v1/orders"),
    requestId: "0193f2a1-7c3e-7890-abcd-ef0123456700",
    ip: "1.2.3.4",
    userAgent: "test",
    keys: [],
    principal: null,
    locale: "en",
    startedAtMs: 0,
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
  } as Ctx;
  return { ctx, pending };
}

describe("the announcer", () => {
  test("posts the catalogue event, the zone and the sequence to the stream", async () => {
    const stub = stubFetch(async () => Response.json({ ok: true, data: { recorded: 2 } }));
    const { ctx, pending } = ctxWith();
    announce(ctx, {
      zoneId: "sylhet",
      orderId: "UND-7K2M9QX4",
      event: "order.accepted",
      payload: { orderId: "UND-7K2M9QX4", state: "ACCEPTED" },
      seq: 7,
    });
    await Promise.all(pending);
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0]?.url, "https://rt.undal.example/internal/broadcast");
    const body = JSON.parse(String(stub.calls[0]?.init.body)) as Record<string, unknown>;
    assert.equal(body["zoneId"], "sylhet");
    assert.equal(body["orderId"], "UND-7K2M9QX4");
    assert.equal(body["event"], "order.accepted");
    assert.equal(body["seq"], 7);
    assert.deepEqual(body["payload"], { orderId: "UND-7K2M9QX4", state: "ACCEPTED" });
    assert.equal((stub.calls[0]?.init.headers as Record<string, string>).authorization, "Bearer internal");
  });

  test("carries the audience it was given, by user id (D104)", async () => {
    const stub = stubFetch(async () => Response.json({ ok: true, data: { recorded: 3 } }));
    const { ctx, pending } = ctxWith();
    announce(ctx, {
      zoneId: "sylhet",
      orderId: "UND-7K2M9QX4",
      event: "order.placed",
      payload: {},
      seq: 1,
      audience: { vendorUserId: "0a1b2c3d4e5f60718293a4b5c6d7e8f9" },
    });
    await Promise.all(pending);
    const body = JSON.parse(String(stub.calls[0]?.init.body)) as Record<string, unknown>;
    assert.deepEqual(body["audience"], { vendorUserId: "0a1b2c3d4e5f60718293a4b5c6d7e8f9" });
  });

  test("sends no audience field when it has none, rather than an empty one", async () => {
    const stub = stubFetch(async () => Response.json({ ok: true, data: { recorded: 2 } }));
    const { ctx, pending } = ctxWith();
    announce(ctx, { zoneId: "sylhet", orderId: "UND-7K2M9QX4", event: "order.accepted", payload: {} });
    await Promise.all(pending);
    const body = JSON.parse(String(stub.calls[0]?.init.body)) as Record<string, unknown>;
    assert.equal("audience" in body, false);
  });

  test("does nothing when the stream is not configured", async () => {
    const stub = stubFetch(async () => Response.json({ ok: true }));
    const { ctx, pending } = ctxWith(testEnv({ INTERNAL_TOKEN: "internal" }));
    announce(ctx, { zoneId: "sylhet", orderId: "UND-7K2M9QX4", event: "order.accepted", payload: {} });
    await Promise.all(pending);
    assert.equal(stub.calls.length, 0);
  });

  test("does nothing without an internal token", async () => {
    const stub = stubFetch(async () => Response.json({ ok: true }));
    const { ctx, pending } = ctxWith(testEnv({ REALTIME_BASE: "https://rt.undal.example", INTERNAL_TOKEN: "" }));
    announce(ctx, { zoneId: "sylhet", orderId: "UND-7K2M9QX4", event: "order.accepted", payload: {} });
    await Promise.all(pending);
    assert.equal(stub.calls.length, 0);
  });

  test("a 500 is swallowed: the client answers with a Result, and the Result is dropped", async () => {
    stubFetch(async () => new Response("bad gateway", { status: 502 }));
    const { ctx, pending } = ctxWith();
    announce(ctx, { zoneId: "sylhet", orderId: "UND-7K2M9QX4", event: "order.accepted", payload: {} });
    await assert.doesNotReject(Promise.all(pending));
  });

  test("a transport that throws is swallowed too", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const { ctx, pending } = ctxWith();
    announce(ctx, { zoneId: "sylhet", orderId: "UND-7K2M9QX4", event: "order.accepted", payload: {} });
    await assert.doesNotReject(Promise.all(pending));
  });
});

describe("an accepted order announces itself", () => {
  test("the accept route broadcasts order.accepted with its sequence", async () => {
    const stub = stubFetch(async () => Response.json({ ok: true, data: { recorded: 2 } }));
    const db = stubDb([
      {
        match: /FROM `orders` WHERE `id`/u,
        rows: [
          {
            id: new Uint8Array(16).fill(9),
            code: "UND-7K2M9QX4",
            customer_user_id: new Uint8Array(16).fill(3),
            vendor_id: VENDOR_ID,
            zone_id: new Uint8Array(16).fill(4),
            fulfilment: "DELIVERY",
            state: "PLACED",
            subtotal_paisa: "45000",
            discount_paisa: "0",
            delivery_fee_paisa: "7042",
            small_order_fee_paisa: "2500",
            tax_paisa: "439",
            tip_paisa: "0",
            rounding_paisa: "-81",
            total_paisa: "54900",
            cash_collected_paisa: null,
            commission_paisa: "6750",
            rider_bonus_paisa: "1350",
            rider_payout_paisa: "8370",
            vendor_payout_paisa: "37400",
            surge_bps: "10000",
            prep_time_s: null,
            rider_id: null,
            customer_note: null,
            placed_at: "2026-11-02 10:00:00.000000",
            created_at: "2026-11-02 10:00:00.000000",
            updated_at: "2026-11-02 10:00:00.000000",
          },
        ],
      },
      { match: /FROM `vendors` WHERE `owner_user_id`/u, rows: [{ id: VENDOR_ID, status: "APPROVED", open_state: "OPEN" }] },
      { match: /MAX\(`seq`\)/u, rows: [{ last: 0 }] },
      { match: /UPDATE `orders` SET/u, affectedRows: 1 },
      { match: /INSERT INTO `order_state_events`/u, affectedRows: 1 },
      { match: /FROM `audit_log`/u, rows: [] },
      { match: /INSERT INTO `audit_log`/u, affectedRows: 1 },
    ]);
    const { ctx, pending } = ctxWith(undefined, db);
    const route = ORDER_ROUTES.find((candidate) => candidate.path === "/v1/orders/{id}/accept");
    assert.ok(route !== undefined);
    const response = await route.run({ ...ctx, principal: { userId: OWNER_ID, actorType: "VENDOR_OWNER", role: null, sessionId: "s", deviceId: "d", zoneScope: null, stepUpAtMs: null, impersonating: false } } as Ctx, {
      params: { id: ORDER_ID },
      body: { prepTimeSeconds: 900 },
      reason: null,
    });
    assert.equal(response.status, 200);

    await Promise.all(pending);
    assert.equal(stub.calls.length, 1);
    const body = JSON.parse(String(stub.calls[0]?.init.body)) as Record<string, unknown>;
    assert.equal(body["event"], "order.accepted");
    assert.equal(body["orderId"], "UND-7K2M9QX4");
    assert.equal(typeof body["seq"], "number");
    assert.deepEqual(body["payload"], { orderId: "UND-7K2M9QX4", state: "ACCEPTED", seq: body["seq"], prepTimeSeconds: 900 });
  });
});
