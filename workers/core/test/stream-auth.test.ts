/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `POST /internal/stream/watches` — who may watch an order's events.
 *
 * Two layers are asserted separately because either alone is an open door: the shared token decides
 * whether the question is answered at all, and the order rows decide the answer. The tests below walk the
 * four actor types against one order, and then the ways the question can be malformed or unanswerable.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";
import { STREAM_AUTH_ROUTES } from "../src/routes/stream-auth.ts";
import type { Ctx } from "../src/middleware/context.ts";

const CODE = "UND-7K2M9QX4";
const TOKEN = "test-internal-token";
const CUSTOMER = "03030303030303030303030303030303";
const VENDOR_OWNER = "04040404040404040404040404040404";
const RIDER = "05050505050505050505050505050505";
const STRANGER = "06060606060606060606060606060606";
const ADMIN = "07070707070707070707070707070707";

const VENDOR_ID = new Uint8Array(16).fill(2);
const CUSTOMER_ID = new Uint8Array(16).fill(3);
const RIDER_ID = new Uint8Array(16).fill(5);

const ORDER_ROW = {
  id: new Uint8Array(16).fill(9),
  code: CODE,
  customer_user_id: CUSTOMER_ID,
  vendor_id: VENDOR_ID,
  zone_id: new Uint8Array(16).fill(4),
  fulfilment: "DELIVERY",
  state: "RIDER_ASSIGNED",
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
  rider_id: RIDER_ID,
  customer_note: "ring the bell",
  placed_at: "2026-11-02 10:00:00.000000",
  created_at: "2026-11-02 10:00:00.000000",
  updated_at: "2026-11-02 10:00:00.000000",
};

const route = () => {
  const found = STREAM_AUTH_ROUTES.find((candidate) => candidate.path === "/internal/stream/watches");
  if (found === undefined) throw new Error("no watch route");
  return found;
};

/** A request carrying the internal token, unless the test says otherwise. */
function ask(body: unknown, token: string | null = TOKEN): Request {
  return new Request("https://api.undal.app/internal/stream/watches", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
}

/** The context the pipeline would build, minus the parts this handler does not read. */
function ctxFor(request: Request, db: ReturnType<typeof stubDb>, env = testEnv()): Ctx {
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

/** A database that holds the order, and the vendor owned by `ownerId`. */
function dbWith(ownerId = VENDOR_OWNER) {
  return stubDb([
    { match: /FROM `orders` WHERE `code`/u, rows: [ORDER_ROW] },
    { match: /FROM `vendors` WHERE `owner_user_id`/u, rows: [{ id: VENDOR_ID, status: "APPROVED", open_state: "OPEN" }] },
  ]);
}

/** Ask the route and parse the answer. */
async function answer(db: ReturnType<typeof stubDb>, body: unknown, token: string | null = TOKEN, env = testEnv()) {
  const request = ask(body, token);
  const response = await route().run(ctxFor(request, db, env), { params: {}, body, reason: null });
  return { status: response.status, body: (await response.json()) as { data?: { allowed: boolean; reason: string } } };
}

describe("the internal token", () => {
  test("a request with no token is refused", async () => {
    const { status } = await answer(dbWith(), { actorId: CUSTOMER, actorType: "CUSTOMER", orderId: CODE }, null);
    assert.equal(status, 401);
  });

  test("a request with the wrong token is refused", async () => {
    const { status } = await answer(dbWith(), { actorId: CUSTOMER, actorType: "CUSTOMER", orderId: CODE }, "wrong");
    assert.equal(status, 401);
  });

  test("a deployment with no token configured refuses everybody", async () => {
    const env = testEnv({ INTERNAL_TOKEN: "" });
    const { status } = await answer(dbWith(), { actorId: CUSTOMER, actorType: "CUSTOMER", orderId: CODE }, TOKEN, env);
    assert.equal(status, 401);
  });
});

describe("who is party to the order", () => {
  test("the customer who placed it", async () => {
    const { body } = await answer(dbWith(), { actorId: CUSTOMER, actorType: "CUSTOMER", orderId: CODE });
    assert.deepEqual(body.data, { allowed: true, reason: "owner" });
  });

  test("the vendor that cooks it", async () => {
    const { body } = await answer(dbWith(), { actorId: VENDOR_OWNER, actorType: "VENDOR_OWNER", orderId: CODE });
    assert.deepEqual(body.data, { allowed: true, reason: "vendor" });
  });

  test("the rider assigned to it", async () => {
    const { body } = await answer(dbWith(), { actorId: RIDER, actorType: "RIDER", orderId: CODE });
    assert.deepEqual(body.data, { allowed: true, reason: "assigned_rider" });
  });

  test("an admin, without a lookup", async () => {
    // No stub rows at all: `stubDb` throws on an unmatched statement, so this passing means the admin
    // branch never read the order.
    const { body } = await answer(stubDb([]), { actorId: ADMIN, actorType: "ADMIN", orderId: CODE });
    assert.deepEqual(body.data, { allowed: true, reason: "admin" });
  });

  test("a different customer is not", async () => {
    const { body } = await answer(dbWith(), { actorId: STRANGER, actorType: "CUSTOMER", orderId: CODE });
    assert.deepEqual(body.data, { allowed: false, reason: "not_party" });
  });

  test("a vendor who owns another restaurant is not", async () => {
    const db = stubDb([
      { match: /FROM `orders` WHERE `code`/u, rows: [ORDER_ROW] },
      { match: /FROM `vendors` WHERE `owner_user_id`/u, rows: [{ id: new Uint8Array(16).fill(7), status: "APPROVED", open_state: "OPEN" }] },
    ]);
    const { body } = await answer(db, { actorId: STRANGER, actorType: "VENDOR_OWNER", orderId: CODE });
    assert.deepEqual(body.data, { allowed: false, reason: "not_party" });
  });

  test("a vendor with no restaurant yet is not", async () => {
    const db = stubDb([
      { match: /FROM `orders` WHERE `code`/u, rows: [ORDER_ROW] },
      { match: /FROM `vendors` WHERE `owner_user_id`/u, rows: [] },
    ]);
    const { body } = await answer(db, { actorId: VENDOR_OWNER, actorType: "VENDOR_OWNER", orderId: CODE });
    assert.deepEqual(body.data, { allowed: false, reason: "not_party" });
  });

  test("a rider who has not claimed it is not — an offer is a push, not a stream", async () => {
    const { body } = await answer(dbWith(), { actorId: STRANGER, actorType: "RIDER", orderId: CODE });
    assert.deepEqual(body.data, { allowed: false, reason: "not_party" });
  });

  test("an order with no rider yet admits no rider", async () => {
    const db = stubDb([{ match: /FROM `orders` WHERE `code`/u, rows: [{ ...ORDER_ROW, rider_id: null }] }]);
    const { body } = await answer(db, { actorId: RIDER, actorType: "RIDER", orderId: CODE });
    assert.deepEqual(body.data, { allowed: false, reason: "not_party" });
  });

  test("a code that names no order is a no, not a 404", async () => {
    const db = stubDb([{ match: /FROM `orders` WHERE `code`/u, rows: [] }]);
    const { status, body } = await answer(db, { actorId: CUSTOMER, actorType: "CUSTOMER", orderId: "UND-NOPE0000" });
    assert.equal(status, 200);
    assert.deepEqual(body.data, { allowed: false, reason: "order_not_found" });
  });
});

describe("a malformed question", () => {
  test("an actor id that is not 32 hex is refused", async () => {
    const { status } = await answer(stubDb([]), { actorId: "cust-a", actorType: "CUSTOMER", orderId: CODE });
    assert.equal(status, 422);
  });

  test("an actor type that is not one of the four is refused", async () => {
    const { status } = await answer(stubDb([]), { actorId: CUSTOMER, actorType: "COURIER", orderId: CODE });
    assert.equal(status, 422);
  });

  test("a missing order id is refused", async () => {
    const { status } = await answer(stubDb([]), { actorId: CUSTOMER, actorType: "CUSTOMER" });
    assert.equal(status, 422);
  });

  test("an order id too long to be one is refused", async () => {
    const { status } = await answer(stubDb([]), { actorId: CUSTOMER, actorType: "CUSTOMER", orderId: "U".repeat(65) });
    assert.equal(status, 422);
  });
});
