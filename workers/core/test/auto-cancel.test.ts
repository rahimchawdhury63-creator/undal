/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `POST /internal/orders/auto-cancel` — the last rung, answered by the state machine.
 *
 * The suite is about the three ways this can be wrong: cancelling an order a vendor accepted, cancelling one
 * that is not due, and cancelling without the internal token. Each of them leaves the order alone and says
 * which case it was, because the ladder records the answer in its evidence block.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";
import { AUTO_CANCEL_ROUTES } from "../src/routes/auto-cancel.ts";
import type { Ctx } from "../src/middleware/context.ts";

const CODE = "UND-7K2M9QX4";
const TOKEN = "test-internal-token";

const ORDER_ROW = {
  id: new Uint8Array(16).fill(9),
  code: CODE,
  customer_user_id: new Uint8Array(16).fill(3),
  vendor_id: new Uint8Array(16).fill(2),
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

const route = () => {
  const found = AUTO_CANCEL_ROUTES.find((candidate) => candidate.path === "/internal/orders/auto-cancel");
  if (found === undefined) throw new Error("no auto-cancel route");
  return found;
};

/** The statements a successful cancellation touches. */
function cancelDb(state = "PLACED", affectedRows = 1) {
  return stubDb([
    { match: /FROM `orders` WHERE `code`/u, rows: [{ ...ORDER_ROW, state }] },
    // The audience resolves the vendor's owner before the announcement goes out (D106).
    { match: /owner_user_id/u, rows: [{ owner_user_id: new Uint8Array(16).fill(9) }] },
    { match: /UPDATE `orders` SET/u, affectedRows },
    { match: /MAX\(`seq`\)/u, rows: [{ last: 0 }] },
    { match: /INSERT INTO `order_state_events`/u, affectedRows: 1 },
    { match: /FROM `audit_log`/u, rows: [] },
    { match: /INSERT INTO `audit_log`/u, affectedRows: 1 },
  ]);
}

/** A context, with the internal token on the request unless the test says otherwise. */
function ctxFor(db: ReturnType<typeof stubDb>, token: string | null = TOKEN, env = testEnv()): Ctx {
  const request = new Request("https://api.undal.app/internal/orders/auto-cancel", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
  });
  return {
    env,
    db,
    url: new URL(request.url),
    request,
    requestId: "0193f2a1-7c3e-7890-abcd-ef0123456700",
    ip: "1.2.3.4",
    userAgent: "undal-realtime",
    keys: [],
    principal: null,
    locale: "en",
    startedAtMs: 0,
    waitUntil: () => undefined,
  } as Ctx;
}

/** Ask, and parse the answer. */
async function ask(db: ReturnType<typeof stubDb>, body: unknown, token: string | null = TOKEN, env = testEnv()) {
  const response = await route().run(ctxFor(db, token, env), { params: {}, body, reason: null });
  const parsed = (await response.json()) as { data?: { cancelled: boolean; reason: string; state: string | null } };
  return { status: response.status, data: parsed.data };
}

describe("who hears about a cancellation (D106)", () => {
  test("the vendor's own channel hears the ending their silence caused", async () => {
    const db = cancelDb();
    const calls: { url: string; body: string }[] = [];
    const pending: Promise<unknown>[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ ok: true, data: { recorded: 3 } }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const ctx = {
        ...ctxFor(db, TOKEN, testEnv({ REALTIME_BASE: "https://rt.undal.test" })),
        waitUntil: (promise: Promise<unknown>) => pending.push(promise),
      };
      const response = await route().run(ctx, { params: {}, body: { orderCode: CODE, elapsedSeconds: 120 }, reason: null });
      assert.equal(response.status, 200);
      await Promise.all(pending);
    } finally {
      globalThis.fetch = original;
    }
    const broadcast = calls.find((call) => call.url.endsWith("/internal/broadcast"));
    assert.notEqual(broadcast, undefined);
    const body = JSON.parse(broadcast?.body ?? "{}") as { event: string; audience?: { vendorUserId?: string; riderUserId?: string } };
    assert.equal(body.event, "order.cancelled");
    assert.equal(body.audience?.vendorUserId, "09090909090909090909090909090909");
    assert.equal(body.audience?.riderUserId, undefined, "nobody was assigned, so no rider is named");
  });
});

describe("the internal token", () => {
  test("no token is a refusal, and nothing is read", async () => {
    const { status } = await ask(stubDb([]), { orderCode: CODE, elapsedSeconds: 120 }, null);
    assert.equal(status, 401);
  });

  test("a deployment with no token configured refuses everybody", async () => {
    const { status } = await ask(stubDb([]), { orderCode: CODE, elapsedSeconds: 120 }, TOKEN, testEnv({ INTERNAL_TOKEN: "" }));
    assert.equal(status, 401);
  });
});

describe("cancelling", () => {
  test("a PLACED order 120 seconds old is cancelled, by SYSTEM, and audited", async () => {
    const db = cancelDb();
    const { status, data } = await ask(db, { orderCode: CODE, elapsedSeconds: 120 });
    assert.equal(status, 200);
    assert.deepEqual(data, { cancelled: true, reason: "cancelled", state: "AUTO_CANCELLED" });
    const wrote = db.calls.filter((call) =>
      /UPDATE `orders`|INSERT INTO `order_state_events`|INSERT INTO `audit_log`/u.test(call.sql),
    );
    assert.equal(wrote.length, 3);
  });

  test("the audit row names SYSTEM and the reason, with no user", async () => {
    const db = cancelDb();
    await ask(db, { orderCode: CODE, elapsedSeconds: 120 });
    const auditInsert = db.calls.find((call) => /INSERT INTO `audit_log`/u.test(call.sql));
    assert.ok(auditInsert !== undefined);
    const params = [...auditInsert.params];
    // `actor_id`, `actor_type`, `actor_role`: no user, SYSTEM, no role.
    assert.equal(params[3], null);
    assert.equal(params[4], "SYSTEM");
    assert.equal(params[5], null);
  });
});

describe("refusing", () => {
  test("a vendor who already accepted keeps the order", async () => {
    const { data } = await ask(cancelDb("ACCEPTED"), { orderCode: CODE, elapsedSeconds: 120 });
    assert.deepEqual(data, { cancelled: false, reason: "not_cancellable", state: "ACCEPTED" });
  });

  test("a ladder that fires early is refused by the guard", async () => {
    const { data } = await ask(cancelDb(), { orderCode: CODE, elapsedSeconds: 30 });
    assert.deepEqual(data, { cancelled: false, reason: "not_cancellable", state: "PLACED" });
  });

  test("an order that moved between the read and the write is not cancelled twice", async () => {
    const { data } = await ask(cancelDb("PLACED", 0), { orderCode: CODE, elapsedSeconds: 120 });
    assert.deepEqual(data, { cancelled: false, reason: "raced", state: "PLACED" });
  });

  test("a code that names no order is an answer, not a 404", async () => {
    const db = stubDb([{ match: /FROM `orders` WHERE `code`/u, rows: [] }]);
    const { status, data } = await ask(db, { orderCode: "UND-NOPE0000", elapsedSeconds: 120 });
    assert.equal(status, 200);
    assert.deepEqual(data, { cancelled: false, reason: "order_not_found", state: null });
  });
});

describe("a malformed request", () => {
  test("a missing order code is refused", async () => {
    const { status } = await ask(stubDb([]), { elapsedSeconds: 120 });
    assert.equal(status, 422);
  });

  test("a negative elapsed time is refused", async () => {
    const { status } = await ask(stubDb([]), { orderCode: CODE, elapsedSeconds: -1 });
    assert.equal(status, 422);
  });
});
