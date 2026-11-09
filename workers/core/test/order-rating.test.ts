/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stubDb } from "../src/db/client.ts";
import { sqlDatetime } from "../src/db/time.ts";
import { testEnv } from "./support.ts";
import { ORDER_ROUTES } from "../src/routes/orders.ts";
import type { Ctx } from "../src/middleware/context.ts";
import type { Principal } from "../src/rbac/guard.ts";
import {
  MAX_RATING_COMMENT,
  parseRatingBody,
  RATING_TAGS,
  RATING_WINDOW_MS,
  ratingWindow,
  targetAllowed,
} from "../src/domain/order/rating.ts";
import { riderTally, writeRating } from "../src/repositories/ratings.ts";

/**
 * The rating a customer leaves after a delivery (D137).
 *
 * Three things are worth proving and the rest is plumbing: the body reader refuses the four ways a sheet can send
 * something that is not a rating, the window opens at `delivered_at` and closes seven days later, and the row lands
 * once — a second request inside the window is answered with the first rather than writing a second.
 */

const ORDER_ID = new Uint8Array(16).fill(9);
const ORDER_HEX = "0193f2a1-7c3e-7890-abcd-ef0123456789";
const CUSTOMER_ID = new Uint8Array(16).fill(3);
const CUSTOMER_HEX = "03030303030303030303030303030303";
const RIDER_ID = new Uint8Array(16).fill(5);

const ORDER_ROW = {
  id: ORDER_ID,
  code: "UND-7K2M9QX4",
  customer_user_id: CUSTOMER_ID,
  vendor_id: new Uint8Array(16).fill(2),
  zone_id: new Uint8Array(16).fill(4),
  fulfilment: "DELIVERY",
  state: "DELIVERED",
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
  customer_note: null,
  placed_at: "2026-11-02 10:00:00.000000",
  delivered_at: "2026-11-02 10:40:00.000000",
  created_at: "2026-11-02 10:00:00.000000",
  updated_at: "2026-11-02 10:40:00.000000",
};

function principalFor(actorType: Principal["actorType"], userId = CUSTOMER_HEX): Principal {
  return { userId, actorType, role: null, sessionId: "s", deviceId: "d", zoneScope: null, stepUpAtMs: null, impersonating: false };
}

function ctxFor(db: ReturnType<typeof stubDb>, principal: Principal | null): Ctx {
  const path = "/v1/orders/{id}/rate";
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

const route = () => {
  const found = ORDER_ROUTES.find((candidate) => candidate.path === "/v1/orders/{id}/rate");
  if (found === undefined) throw new Error("the rating route is not registered");
  return found;
};

/** The statements a rating touches: the order, the existing rating, the insert, and the audit chain. */
function ratingDb(overrides: { existing?: boolean; order?: Record<string, unknown> } = {}) {
  return stubDb([
    // The normal fixture must remain inside the seven-day rating window as calendar time advances.
    { match: /FROM `orders` WHERE `id` = \?/u, rows: [{ ...ORDER_ROW, delivered_at: sqlDatetime(new Date(Date.now() - 60_000)), ...overrides.order }] },
    {
      match: /FROM `order_ratings` WHERE `order_id`/u,
      rows: overrides.existing === true
        ? [{ id: new Uint8Array(16).fill(8), stars: 2, comment: null, tags: "[]", created_at: "2026-11-02 10:45:00.000000" }]
        : [],
    },
    { match: /INSERT INTO `order_ratings`/u, affectedRows: 1 },
    { match: /FROM `audit_log`/u, rows: [] },
    { match: /INSERT INTO `audit_log`/u, affectedRows: 1 },
  ]);
}

describe("reading the sheet's answer (D137)", () => {
  test("five taps, an optional sentence and a chip row are a rating", () => {
    const parsed = parseRatingBody({ target: "RIDER", stars: 5, comment: "  Polite and quick ", tags: ["FAST", "POLITE", "FAST"] });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.draft, { target: "RIDER", stars: 5, comment: "Polite and quick", tags: ["FAST", "POLITE"] });
  });

  test("a comment of spaces is not a comment, and the fields are optional", () => {
    const parsed = parseRatingBody({ target: "VENDOR", stars: 4, comment: "   " });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.draft.comment, null);
    assert.deepEqual(parsed.draft.tags, []);
  });

  test("every refusal names the field the app has to highlight", () => {
    const cases: readonly { body: unknown; code: string; field: string }[] = [
      { body: null, code: "VALIDATION_FAILED", field: "body" },
      { body: { target: "COURIER", stars: 5 }, code: "VALIDATION_ENUM", field: "target" },
      { body: { target: "RIDER", stars: 0 }, code: "VALIDATION_RANGE", field: "stars" },
      { body: { target: "RIDER", stars: 4.5 }, code: "VALIDATION_RANGE", field: "stars" },
      { body: { target: "RIDER", stars: 6 }, code: "VALIDATION_RANGE", field: "stars" },
      { body: { target: "RIDER", stars: 5, comment: "x".repeat(MAX_RATING_COMMENT + 1) }, code: "VALIDATION_TOO_LONG", field: "comment" },
      { body: { target: "RIDER", stars: 5, tags: ["SPICY"] }, code: "VALIDATION_ENUM", field: "tags" },
      { body: { target: "RIDER", stars: 5, tags: [...RATING_TAGS, "SPICY"] }, code: "VALIDATION_ENUM", field: "tags" },
    ];
    for (const { body, code, field } of cases) {
      const parsed = parseRatingBody(body);
      assert.equal(parsed.ok, false, JSON.stringify(body));
      if (parsed.ok) continue;
      assert.equal(parsed.code, code);
      assert.equal(parsed.details["field"], field);
    }
  });

  test("a pickup order has no rider to rate", () => {
    assert.equal(targetAllowed("DELIVERY", "RIDER"), true);
    assert.equal(targetAllowed("PICKUP", "VENDOR"), true);
    assert.equal(targetAllowed("PICKUP", "RIDER"), false, "nobody carried it");
  });
});

describe("the window (D137)", () => {
  const delivered = Date.parse("2026-11-02T10:40:00.000Z");

  test("it opens at delivery and closes seven days later", () => {
    assert.equal(ratingWindow(delivered, delivered).open, true, "the instant it lands, the sheet is already open");
    const almost = ratingWindow(delivered, delivered + RATING_WINDOW_MS - 1_000);
    assert.equal(almost.open, true);
    assert.equal(almost.closesAtMs, delivered + RATING_WINDOW_MS);
    assert.equal(ratingWindow(delivered, delivered + RATING_WINDOW_MS).open, false, "the boundary belongs to the refusal");
  });
});

describe("leaving the rating", () => {
  test("the row is written once, with the vector of chips the sheet sent", async () => {
    const db = ratingDb();
    const response = await route().run(ctxFor(db, principalFor("CUSTOMER")), {
      params: { id: ORDER_HEX },
      body: { target: "RIDER", stars: 5, tags: ["FAST"] },
      reason: null,
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: { rating: { stars: number; created: boolean; subject: string } } };
    assert.equal(body.data.rating.created, true);
    assert.equal(body.data.rating.subject, "UND-7K2M9QX4:RIDER");
    const insert = db.calls.find((call) => call.sql.startsWith("INSERT INTO `order_ratings`"));
    assert.equal(Buffer.from(insert?.params[1] as Uint8Array).toString("hex"), ORDER_HEX.replaceAll("-", ""));
    assert.equal(insert?.params[2], "RIDER");
    assert.equal(insert?.params[3], 5);
    assert.equal(insert?.params[4], null, "the column takes null, not an empty string");
    assert.equal(insert?.params[5], "[\"FAST\"]", "tags are JSON in the column and an array in the code");
    assert.ok(db.calls.some((call) => call.sql.includes("INSERT INTO `audit_log`")), "a rating is a decision worth a row");
  });

  test("a second rating is the first one, and writes nothing", async () => {
    const db = ratingDb({ existing: true });
    const response = await route().run(ctxFor(db, principalFor("CUSTOMER")), {
      params: { id: ORDER_HEX },
      body: { target: "RIDER", stars: 5 },
      reason: null,
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: { rating: { stars: number; created: boolean } } };
    assert.equal(body.data.rating.created, false);
    assert.equal(body.data.rating.stars, 2, "the answer the customer already gave is the answer the order has");
    assert.ok(!db.calls.some((call) => call.sql.startsWith("INSERT INTO `order_ratings`")));
    assert.ok(!db.calls.some((call) => call.sql.includes("INSERT INTO `audit_log`")), "nothing changed, so nothing is audited");
  });

  test("an order nobody delivered has no rating to leave", async () => {
    const db = ratingDb({ order: { state: "RIDER_ASSIGNED", delivered_at: null } });
    const response = await route().run(ctxFor(db, principalFor("CUSTOMER")), {
      params: { id: ORDER_HEX },
      body: { target: "RIDER", stars: 5 },
      reason: null,
    });
    assert.equal(response.status, 404);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "ORDER_NOT_FOUND", "the resource does not exist yet, which is not the same as forbidden");
  });

  test("a stranger is told the order does not exist, and nothing is read further", async () => {
    const db = ratingDb();
    const response = await route().run(ctxFor(db, principalFor("CUSTOMER", "0193f2a1-7c3e-7890-abcd-ef0123450000")), {
      params: { id: ORDER_HEX },
      body: { target: "RIDER", stars: 5 },
      reason: null,
    });
    assert.equal(response.status, 404);
    assert.ok(!db.calls.some((call) => call.sql.includes("`order_ratings`")));
  });

  test("a rating a week old cannot be left", async () => {
    const deliveredAt = Date.parse("2020-01-01T10:00:00.000Z");
    const db = ratingDb({ order: { delivered_at: "2020-01-01 10:00:00.000000" } });
    const response = await route().run(ctxFor(db, principalFor("CUSTOMER")), {
      params: { id: ORDER_HEX },
      body: { target: "VENDOR", stars: 4 },
      reason: null,
    });
    assert.equal(response.status, 409);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "ORDER_RATING_WINDOW_CLOSED");
    assert.ok(Date.now() > deliveredAt + RATING_WINDOW_MS);
  });

  test("a pickup order refuses a rider rating with the allowed list", async () => {
    const db = ratingDb({ order: { fulfilment: "PICKUP" } });
    const response = await route().run(ctxFor(db, principalFor("CUSTOMER")), {
      params: { id: ORDER_HEX },
      body: { target: "RIDER", stars: 5 },
      reason: null,
    });
    assert.equal(response.status, 422);
    const body = (await response.json()) as { error: { code: string; details: { allowed: string[] } } };
    assert.equal(body.error.code, "VALIDATION_ENUM");
    assert.deepEqual(body.error.details.allowed, ["VENDOR"]);
  });
});

describe("what the row is worth to dispatch (D137)", () => {
  test("four and five stars are the good count, and the join is the assignment that delivered", async () => {
    const db = stubDb([{ match: /FROM `order_ratings` `r` JOIN `order_assignments`/u, rows: [{ good: "18", total: "21" }] }]);
    const tally = await riderTally(db, RIDER_ID);
    assert.deepEqual(tally, { good: 18, total: 21 });
    const call = db.calls[0];
    assert.deepEqual(call?.params[0], RIDER_ID);
    assert.match(call?.sql ?? "", /`a`\.`end_reason` = 'DELIVERED'/u, "orders.rider_id moves; the assignment does not");
    assert.match(call?.sql ?? "", /`r`\.`stars` >= 4/u);
  });

  test("a rider nobody rated has no evidence, not a zero", async () => {
    const db = stubDb([{ match: /FROM `order_ratings`/u, rows: [{ good: null, total: 0 }] }]);
    assert.deepEqual(await riderTally(db, RIDER_ID), { good: 0, total: 0 });
  });

  test("a tally that makes no sense is clamped rather than trusted", async () => {
    const db = stubDb([{ match: /FROM `order_ratings`/u, rows: [{ good: "9", total: "3" }] }]);
    assert.deepEqual(await riderTally(db, RIDER_ID), { good: 3, total: 3 });
  });

  test("the writer reads before it writes, so a duplicate cannot become a second row", async () => {
    const db = stubDb([
      { match: /FROM `order_ratings`/u, rows: [{ id: new Uint8Array(16).fill(8), stars: 4, comment: null, tags: ["HOT"], created_at: "x" }] },
      { match: /INSERT INTO `order_ratings`/u, affectedRows: 1 },
    ]);
    const written = await writeRating(db, ORDER_ID, { target: "VENDOR", stars: 5, comment: null, tags: [] }, 0);
    assert.equal(written.created, false);
    assert.deepEqual(written.stored?.tags, ["HOT"], "JSON in the column, array in the code");
    assert.equal(db.calls.length, 1);
  });
});
