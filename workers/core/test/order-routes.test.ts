/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";
import { ORDER_ROUTES } from "../src/routes/orders.ts";
import type { Ctx } from "../src/middleware/context.ts";
import type { Principal } from "../src/rbac/guard.ts";

/**
 * The order routes, driven at the handler.
 *
 * The pipeline around them — rate limit, authentication, authorisation, idempotency — is covered
 * by `app.test.ts`; what these tests prove is the part that is order-specific: a caller who is not
 * party to the order cannot learn it exists, a vendor can only move their own order, the reject
 * path demands a reason, and the state move is guarded rather than assumed.
 */

const VENDOR_ID = new Uint8Array(16).fill(2);
const CUSTOMER_ID = new Uint8Array(16).fill(3);
const ORDER_ID = new Uint8Array(16).fill(9);
const OWNER_ID = "0193f2a1-7c3e-7890-abcd-ef0123456789";

const ORDER_ROW = {
  id: ORDER_ID,
  code: "UND-7K2M9QX4",
  customer_user_id: CUSTOMER_ID,
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
};

function principalFor(actorType: Principal["actorType"], userId = OWNER_ID): Principal {
  return { userId, actorType, role: null, sessionId: "s", deviceId: "d", zoneScope: null, stepUpAtMs: null, impersonating: false };
}

function ctxFor(db: ReturnType<typeof stubDb>, principal: Principal | null, path = "/v1/orders"): Ctx {
  return {
    env: testEnv(),
    db,
    url: new URL(`https://api.undal.test${path}`),
    request: new Request(`https://api.undal.test${path}`),
    requestId: "0193f2a1-7c3e-7890-abcd-ef0123456700",
    ip: "1.2.3.4",
    userAgent: "test",
    keys: [],
    principal,
    locale: "en",
    startedAtMs: 0,
    waitUntil: () => undefined,
  } as Ctx;
}

const route = (path: string, method: string) => {
  const found = ORDER_ROUTES.find((candidate) => candidate.path === path && candidate.method === method);
  if (found === undefined) throw new Error(`no route ${method} ${path}`);
  return found;
};

/** The handlers a vendor move touches: order read, ownership, seq, update, event, audit tail. */
function vendorDb(state = "PLACED", ownerUserId = OWNER_ID) {
  return stubDb([
    { match: /FROM `orders` WHERE `id` = \?/u, rows: [{ ...ORDER_ROW, state }] },
    { match: /FROM `vendors` WHERE `owner_user_id`/u, rows: [{ id: VENDOR_ID, status: "APPROVED", open_state: "OPEN" }] },
    { match: /MAX\(`seq`\)/u, rows: [{ last: 0 }] },
    { match: /UPDATE `orders` SET/u, affectedRows: 1 },
    { match: /INSERT INTO `order_state_events`/u, affectedRows: 1 },
    { match: /FROM `audit_log`/u, rows: [] },
    { match: /INSERT INTO `audit_log`/u, affectedRows: 1 },
  ]);
}

describe("reading an order", () => {
  test("the customer who owns it sees the money as integers", async () => {
    const db = stubDb([{ match: /FROM `orders` WHERE `id`/u, rows: [ORDER_ROW] }]);
    const response = await route("/v1/orders/{id}", "GET").run(ctxFor(db, principalFor("CUSTOMER", "03030303030303030303030303030303")), { params: { id: OWNER_ID }, body: undefined, reason: null });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: { order: { money: { totalPaisa: number } } } };
    assert.equal(body.data.order.money.totalPaisa, 54_900);
    assert.equal(typeof body.data.order.money.totalPaisa, "number");
  });

  test("a stranger is told the order does not exist, not that it is forbidden", async () => {
    const db = stubDb([
      { match: /FROM `orders` WHERE `id`/u, rows: [ORDER_ROW] },
      { match: /FROM `vendors` WHERE `owner_user_id`/u, rows: [{ id: new Uint8Array(16).fill(7), status: "APPROVED", open_state: "OPEN" }] },
    ]);
    const response = await route("/v1/orders/{id}", "GET").run(ctxFor(db, principalFor("VENDOR_OWNER")), { params: { id: OWNER_ID }, body: undefined, reason: null });
    assert.equal(response.status, 404);
  });
});

describe("a vendor answering an order", () => {
  test("accepting moves PLACED to ACCEPTED and writes the event", async () => {
    const db = vendorDb();
    const response = await route("/v1/orders/{id}/accept", "POST").run(ctxFor(db, principalFor("VENDOR_OWNER")), {
      params: { id: OWNER_ID },
      body: { prepTimeSeconds: 900 },
      reason: null,
    });
    assert.equal(response.status, 200);
    const writes = db.calls.filter((call) => call.sql.startsWith("UPDATE `orders`"));
    assert.equal(writes.length, 1);
    assert.match(writes[0]?.sql ?? "", /`state` = \?/u);
    assert.ok(db.calls.some((call) => call.sql.includes("INSERT INTO `order_state_events`")));
    assert.ok(db.calls.some((call) => call.sql.includes("INSERT INTO `audit_log`")));
  });

  test("the acceptance reaches the vendor's own channel, by the owner's user id (D105)", async () => {
    const db = vendorDb();
    const pending: Promise<unknown>[] = [];
    const calls: { url: string; body: string }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ ok: true, data: { recorded: 3 } }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const ctx = { ...ctxFor(db, principalFor("VENDOR_OWNER")), env: testEnv({ REALTIME_BASE: "https://rt.undal.test" }), waitUntil: (promise: Promise<unknown>) => pending.push(promise) };
      const response = await route("/v1/orders/{id}/accept", "POST").run(ctx, {
        params: { id: OWNER_ID },
        body: { prepTimeSeconds: 900 },
        reason: null,
      });
      assert.equal(response.status, 200);
      await Promise.all(pending);
    } finally {
      globalThis.fetch = original;
    }
    const broadcast = calls.find((call) => call.url.endsWith("/internal/broadcast"));
    assert.notEqual(broadcast, undefined, "the vendor's other devices are the point of the fan-out");
    const body = JSON.parse(broadcast?.body ?? "{}") as { audience?: { vendorUserId?: string }; event: string };
    assert.equal(body.event, "order.accepted");
    assert.equal(body.audience?.vendorUserId, OWNER_ID);
  });

  test("a prep time outside the window is refused with the field named", async () => {
    const db = vendorDb();
    const response = await route("/v1/orders/{id}/accept", "POST").run(ctxFor(db, principalFor("VENDOR_OWNER")), {
      params: { id: OWNER_ID },
      body: { prepTimeSeconds: 60 },
      reason: null,
    });
    assert.equal(response.status, 422);
    assert.equal(db.calls.some((call) => call.sql.startsWith("UPDATE")), false, "nothing may be written");
  });

  test("rejecting without a reason code is refused", async () => {
    const db = vendorDb();
    const response = await route("/v1/orders/{id}/reject", "POST").run(ctxFor(db, principalFor("VENDOR_OWNER")), {
      params: { id: OWNER_ID },
      body: {},
      reason: null,
    });
    assert.equal(response.status, 422);
  });

  test("rejecting another vendor's order is refused as not yours, and nothing is written", async () => {
    const response = await route("/v1/orders/{id}/reject", "POST").run(
      ctxFor(stubDb([
        { match: /FROM `orders` WHERE `id`/u, rows: [ORDER_ROW] },
        { match: /FROM `vendors` WHERE `owner_user_id`/u, rows: [{ id: new Uint8Array(16).fill(7), status: "APPROVED", open_state: "OPEN" }] },
      ]), principalFor("VENDOR_OWNER")),
      { params: { id: OWNER_ID }, body: { reasonCode: "OUT_OF_STOCK" }, reason: null },
    );
    assert.equal(response.status, 403);
  });

  test("an order already accepted cannot be accepted again", async () => {
    const db = vendorDb("ACCEPTED");
    const response = await route("/v1/orders/{id}/accept", "POST").run(ctxFor(db, principalFor("VENDOR_OWNER")), {
      params: { id: OWNER_ID },
      body: { prepTimeSeconds: 900 },
      reason: null,
    });
    assert.equal(response.status, 409);
  });
});
