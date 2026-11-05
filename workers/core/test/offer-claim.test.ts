/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Claiming an offer (`11 §7.3`, D113).
 *
 * The route is the first thing in the repository that can legally move an order from `RIDER_SEARCH` to
 * `RIDER_ASSIGNED`, so the tests are the transition's preconditions one by one: the offer exists, it is this
 * rider's, it is unanswered, it has not expired, and the order is still searching. Then the two writes that
 * only this route makes — the offer's answer and the sibling withdrawals — and the trailing assignment row.
 *
 * The race is tested as the state change losing, because that is what a race looks like from inside the loser:
 * the order moved between the read and the write, `moveState` reports zero rows, and the rider is told
 * `OFFER_CLAIMED` rather than being assigned an order somebody else is collecting.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { OFFER_ROUTES } from "../src/routes/offers.ts";
import type { Ctx } from "../src/middleware/context.ts";
import type { Principal } from "../src/rbac/guard.ts";
import type { Db } from "../src/db/client.ts";
import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";

const USER_HEX = "0193f2a17c3e7890abcdef0123456701";
const RIDER_HEX = "0193f2a17c3e7890abcdef0123456707";
const OTHER_RIDER_HEX = "0193f2a17c3e7890abcdef0123456711";
const ZONE_HEX = "0193f2a17c3e7890abcdef0123456703";
const VENDOR_HEX = "0193f2a17c3e7890abcdef0123456702";
const ORDER_HEX = "0193f2a17c3e7890abcdef01234567a0";
const OFFER_HEX = "0193f2a17c3e7890abcdef01234567e0";
const OWNER_HEX = "0193f2a17c3e7890abcdef01234567aa";
const ORDER_CODE = "UND-7K2M9QX4";

const bytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
};

const ORDER_ROW = {
  id: bytes(ORDER_HEX),
  code: ORDER_CODE,
  customer_user_id: bytes("0193f2a17c3e7890abcdef012345670c"),
  vendor_id: bytes(VENDOR_HEX),
  zone_id: bytes(ZONE_HEX),
  fulfilment: "DELIVERY",
  state: "RIDER_SEARCH",
  pickup_lat_e7: 248_981_000,
  pickup_lon_e7: 918_712_000,
  rider_id: null,
};

const RIDER_ROW = {
  id: bytes(RIDER_HEX),
  code: "RDR-4K2M",
  status: "APPROVED",
  shift_state: "ONLINE",
  home_zone_id: bytes(ZONE_HEX),
  vehicle: "MOTORBIKE",
};

/** An offer, `secondsFromNow` away from its TTL. */
function offerRow(options: { rider?: string; response?: string | null; secondsFromNow?: number } = {}) {
  const expires = new Date(Date.now() + (options.secondsFromNow ?? 20) * 1_000);
  const sql = expires.toISOString().replace("T", " ").replace("Z", "");
  return {
    id: bytes(OFFER_HEX),
    order_id: bytes(ORDER_HEX),
    rider_id: bytes(options.rider ?? RIDER_HEX),
    wave: 1,
    expires_at: sql,
    response: options.response === undefined ? null : options.response,
    payout_paisa: 8_370,
  };
}

function dbFor(
  options: {
    offer?: ReturnType<typeof offerRow>;
    order?: Record<string, unknown> | null;
    rider?: Record<string, unknown> | null;
    moved?: number;
  } = {},
): ReturnType<typeof stubDb> {
  const order = options.order === undefined ? ORDER_ROW : options.order;
  const rider = options.rider === undefined ? RIDER_ROW : options.rider;
  return stubDb([
    { match: /FROM `orders` WHERE `code`/u, rows: order === null ? [] : [order] },
    { match: /FROM `order_offers` WHERE `id`/u, rows: [options.offer ?? offerRow()] },
    { match: /FROM `riders` WHERE `user_id`/u, rows: rider === null ? [] : [rider] },
    { match: /owner_user_id/u, rows: [{ owner_user_id: bytes(OWNER_HEX) }] },
    { match: /MAX\(`seq`\)/u, rows: [{ last: 6 }] },
    { match: /UPDATE `orders` SET/u, affectedRows: options.moved ?? 1 },
    { match: /UPDATE `order_offers` SET `response` = 'WITHDRAWN'/u, affectedRows: 4 },
    { match: /UPDATE `order_offers` SET/u, affectedRows: 1 },
    { match: /INSERT INTO `order_assignments`/u, affectedRows: 1 },
    { match: /UPDATE `rider_shifts` SET `orders_rejected`/u, affectedRows: 1 },
    { match: /INSERT INTO `order_state_events`/u, affectedRows: 1 },
    { match: /FROM `audit_log`/u, rows: [] },
    { match: /INSERT INTO `audit_log`/u, affectedRows: 1 },
  ]);
}

const principalFor: Principal = {
  userId: USER_HEX,
  actorType: "RIDER",
  role: "RIDER",
  zoneScope: [],
  sessionId: "0193f2a17c3e7890abcdef01234567ff",
} as unknown as Principal;

const SERVE_NEVER = () => {
  throw new Error("a claim with no winning broadcast should not fetch");
};

function ctxFor(db: Db, waitUntil: (promise: Promise<unknown>) => void = () => undefined): Ctx {
  return {
    env: testEnv(),
    db,
    url: new URL(`https://api.undal.test/v1/orders/${ORDER_CODE}/offer/${OFFER_HEX}/accept`),
    request: new Request("https://api.undal.test/x", { method: "POST" }),
    requestId: "0193f2a1-7c3e-7890-abcd-ef0123456700",
    ip: "1.2.3.4",
    userAgent: "test",
    keys: [],
    principal: principalFor,
    locale: "en",
    startedAtMs: 0,
    waitUntil,
  } as Ctx;
}

const route = (kind: "accept" | "reject" = "accept") => {
  const path = `/v1/orders/{code}/offer/{offerId}/${kind}`;
  const found = OFFER_ROUTES.find((candidate) => candidate.path === path);
  if (found === undefined) throw new Error(`no ${kind} route`);
  return found;
};

const claim = (db: Db, waitUntil?: (promise: Promise<unknown>) => void) =>
  route().run(ctxFor(db, waitUntil), { params: { code: ORDER_CODE, offerId: OFFER_HEX }, body: {}, reason: null });

describe("POST /v1/orders/{code}/offer/{offerId}/accept", () => {
  test("the winning claim assigns the rider, answers the offer, withdraws its rivals and leaves a trail", async () => {
    const db = dbFor();
    const response = await claim(db);
    assert.equal(response.status, 200);
    const parsed = (await response.json()) as { data: { state: string; event: string; seq: number; riderId: string } };
    assert.equal(parsed.data.state, "RIDER_ASSIGNED");
    assert.equal(parsed.data.event, "order.assigned");
    assert.equal(parsed.data.seq, 7);
    assert.equal(parsed.data.riderId, RIDER_HEX);

    const move = db.calls.find((call) => call.sql.startsWith("UPDATE `orders` SET"));
    assert.notEqual(move, undefined);
    assert.match(move?.sql ?? "", /WHERE `id` = \? AND `state` = \?/u, "the order decides the race, conditionally");
    assert.match(move?.sql ?? "", /`state` = \?, `updated_at` = \?, `rider_id` = \?/u, "the rider column moves with the state");
    assert.deepEqual(move?.params.slice(-1), ["RIDER_SEARCH"]);

    const answer = db.calls.find((call) => call.sql.startsWith("UPDATE `order_offers` SET `response` = ?"));
    assert.equal(answer?.params[0], "ACCEPTED");
    assert.match(answer?.sql ?? "", /AND `response` IS NULL/u, "an answer is written once");

    const withdraw = db.calls.find((call) => call.sql.includes("'WITHDRAWN'"));
    assert.notEqual(withdraw, undefined, "a wave ends early the moment anyone claims (11 §7.2)");

    assert.ok(db.calls.some((call) => call.sql.startsWith("INSERT INTO `order_assignments`")));
    assert.ok(db.calls.some((call) => call.sql.startsWith("INSERT INTO `audit_log`")));
  });

  test("an offer addressed to another rider is a refusal, not an assignment", async () => {
    const db = dbFor({ offer: offerRow({ rider: OTHER_RIDER_HEX }) });
    const response = await claim(db);
    assert.equal(response.status, 403);
    const parsed = (await response.json()) as { error: { code: string } };
    assert.equal(parsed.error.code, "OFFER_NOT_TARGETED");
    assert.ok(!db.calls.some((call) => call.sql.startsWith("UPDATE `orders`")));
  });

  test("an expired offer is refused and recorded as expired, so the rider's screen agrees with the sweep", async () => {
    const db = dbFor({ offer: offerRow({ secondsFromNow: -5 }) });
    const response = await claim(db);
    assert.equal(response.status, 410);
    const parsed = (await response.json()) as { error: { code: string } };
    assert.equal(parsed.error.code, "OFFER_EXPIRED");
    const answer = db.calls.find((call) => call.sql.startsWith("UPDATE `order_offers` SET `response` = ?"));
    assert.equal(answer?.params[0], "EXPIRED");
    assert.ok(!db.calls.some((call) => call.sql.startsWith("UPDATE `orders`")));
  });

  test("an order that stopped searching is claimed by somebody else", async () => {
    const db = dbFor({ order: { ...ORDER_ROW, state: "RIDER_ASSIGNED" } });
    const response = await claim(db);
    assert.equal(response.status, 409);
    const parsed = (await response.json()) as { error: { code: string } };
    assert.equal(parsed.error.code, "OFFER_CLAIMED");
    assert.ok(!db.calls.some((call) => call.sql.startsWith("UPDATE `order_offers` SET `response` = ?")));
  });

  test("losing the state change is a race, and the offer is left for whoever won", async () => {
    const db = dbFor({ moved: 0 });
    const response = await claim(db);
    assert.equal(response.status, 409);
    const parsed = (await response.json()) as { error: { code: string } };
    assert.equal(parsed.error.code, "OFFER_CLAIMED");
    assert.ok(!db.calls.some((call) => call.sql.startsWith("UPDATE `order_offers` SET `response` = ?")));
    assert.ok(!db.calls.some((call) => call.sql.startsWith("INSERT INTO `order_assignments`")));
  });

  test("a rider who already won and taps again gets the same answer without a second write", async () => {
    const db = dbFor({ offer: offerRow({ response: "ACCEPTED" }), order: { ...ORDER_ROW, state: "RIDER_ASSIGNED" } });
    const response = await claim(db);
    assert.equal(response.status, 200);
    const parsed = (await response.json()) as { data: { repeated: boolean; state: string } };
    assert.equal(parsed.data.repeated, true);
    assert.ok(!db.calls.some((call) => call.sql.startsWith("UPDATE `orders`")));
  });

  test("a rider who already declined is told so rather than re-offered the delivery", async () => {
    const db = dbFor({ offer: offerRow({ response: "REJECTED" }) });
    const response = await claim(db);
    assert.equal(response.status, 409);
    const parsed = (await response.json()) as { error: { code: string } };
    assert.equal(parsed.error.code, "OFFER_ALREADY_REJECTED");
  });

  test("an offer that belongs to another order reads as not found here", async () => {
    // Same code path a crafted url would take: the offer is real, the order is real, and they are not each other's.
    const db = dbFor({ order: { ...ORDER_ROW, id: bytes("0193f2a17c3e7890abcdef01234567a0").slice(1) } });
    const response = await claim(db);
    assert.equal(response.status, 404);
    const parsed = (await response.json()) as { error: { code: string } };
    assert.equal(parsed.error.code, "OFFER_NOT_FOUND");
    assert.ok(!db.calls.some((call) => call.sql.startsWith("UPDATE `orders`")));
  });

  test("an unknown offer is not found, and nothing is moved", async () => {
    const db = dbFor();
    const response = await route().run(ctxFor(db), { params: { code: ORDER_CODE, offerId: "not-a-uuid" }, body: {}, reason: null });
    assert.equal(response.status, 404);
    assert.ok(!db.calls.some((call) => call.sql.startsWith("UPDATE `orders`")));
  });

  test("the assignment is announced with the rider's identity and the vendor's owner", async () => {
    const calls: { url: string; body: string }[] = [];
    const pending: Promise<unknown>[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ ok: true, data: { recorded: 4 } }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const db = dbFor();
      const response = await route().run(
        { ...ctxFor(db, (promise) => pending.push(promise)), env: testEnv({ REALTIME_BASE: "https://rt.undal.test", INTERNAL_TOKEN: "internal-secret" }) },
        { params: { code: ORDER_CODE, offerId: OFFER_HEX }, body: {}, reason: null },
      );
      assert.equal(response.status, 200);
      await Promise.all(pending);
    } finally {
      globalThis.fetch = original;
    }
    const broadcast = calls.find((call) => call.url.endsWith("/internal/broadcast"));
    assert.notEqual(broadcast, undefined);
    const body = JSON.parse(broadcast?.body ?? "{}") as { event: string; audience?: { riderUserId?: string; vendorUserId?: string } };
    assert.equal(body.event, "order.assigned");
    assert.equal(body.audience?.riderUserId, USER_HEX, "the rider hears it by the identity their own stream resolves");
    assert.equal(body.audience?.vendorUserId, OWNER_HEX);
  });
});

describe("POST /v1/orders/{code}/offer/{offerId}/reject", () => {
  const reject = (db: Db, body: unknown) =>
    route("reject").run(ctxFor(db), { params: { code: ORDER_CODE, offerId: OFFER_HEX }, body, reason: null });

  test("a reason is recorded, the shift's counter moves, and the order does not", async () => {
    const db = dbFor();
    const response = await reject(db, { reason: "TOO_FAR" });
    assert.equal(response.status, 200);
    const parsed = (await response.json()) as { data: { response: string; reason: string; state: string } };
    assert.equal(parsed.data.response, "REJECTED");
    assert.equal(parsed.data.reason, "TOO_FAR");
    assert.equal(parsed.data.state, "RIDER_SEARCH", "the order is still searching: rejecting is not withdrawing it");

    const answer = db.calls.find((call) => call.sql.startsWith("UPDATE `order_offers` SET `response` = ?"));
    assert.deepEqual(answer?.params.slice(0, 3), ["REJECTED", answer?.params[1], "TOO_FAR"]);
    assert.ok(db.calls.some((call) => call.sql.startsWith("UPDATE `rider_shifts` SET `orders_rejected`")));
    assert.ok(!db.calls.some((call) => call.sql.startsWith("UPDATE `orders`")), "nothing about the order changes");
    assert.ok(!db.calls.some((call) => call.sql.includes("'WITHDRAWN'")), "a decline does not end the wave for anyone else");
    const audit = db.calls.find((call) => call.sql.startsWith("INSERT INTO `audit_log`"));
    assert.match(audit?.params.join("|") ?? "", /order\.offer\.reject/u);
  });

  test("OTHER without free text is refused with the list of reasons", async () => {
    const db = dbFor();
    const response = await reject(db, { reason: "OTHER", note: "   " });
    assert.equal(response.status, 422);
    const parsed = (await response.json()) as { error: { code: string; details?: { allowed?: string[] } } };
    assert.equal(parsed.error.code, "OFFER_REASON_REQUIRED");
    assert.ok(parsed.error.details?.allowed?.includes("TOO_FAR"));
    assert.ok(!parsed.error.details?.allowed?.includes("NO_ALTERNATIVE_FORCED"), "the system's reason is not the rider's to give");
    assert.deepEqual(db.calls, []);
  });

  test("a reason the rider invented gets the list back rather than a bare rejection", async () => {
    const response = await reject(dbFor(), { reason: "DONT_WANT_TO" });
    assert.equal(response.status, 422);
    const parsed = (await response.json()) as { error: { details?: { allowed?: string[] } } };
    assert.equal(parsed.error.details?.allowed?.length, 9);
  });

  test("OTHER with text records both", async () => {
    const db = dbFor();
    const response = await reject(db, { reason: "OTHER", note: "gate code is wrong" });
    assert.equal(response.status, 200);
    const answer = db.calls.find((call) => call.sql.startsWith("UPDATE `order_offers` SET `response` = ?"));
    assert.equal(answer?.params[2], "OTHER");
  });

  test("a rider who already declined is told so", async () => {
    const response = await reject(dbFor({ offer: offerRow({ response: "REJECTED" }) }), { reason: "TOO_FAR" });
    assert.equal(response.status, 409);
    const parsed = (await response.json()) as { error: { code: string } };
    assert.equal(parsed.error.code, "OFFER_ALREADY_REJECTED");
  });

  test("an offer another rider won cannot be declined after the fact", async () => {
    const response = await reject(dbFor({ offer: offerRow({ response: "ACCEPTED" }) }), { reason: "TOO_FAR" });
    assert.equal(response.status, 409);
    const parsed = (await response.json()) as { error: { code: string; details?: { state?: string } } };
    assert.equal(parsed.error.code, "OFFER_REJECT_NOT_ALLOWED");
    assert.equal(parsed.error.details?.state, "RIDER_SEARCH");
  });

  test("a decline that arrives after the TTL is an expiry, and is recorded as one", async () => {
    const db = dbFor({ offer: offerRow({ secondsFromNow: -1 }) });
    const response = await reject(db, { reason: "TOO_FAR" });
    assert.equal(response.status, 410);
    const answer = db.calls.find((call) => call.sql.startsWith("UPDATE `order_offers` SET `response` = ?"));
    assert.equal(answer?.params[0], "EXPIRED");
    assert.ok(!db.calls.some((call) => call.sql.startsWith("UPDATE `rider_shifts` SET `orders_rejected`")));
  });

  test("an offer addressed to somebody else is refused", async () => {
    const response = await reject(dbFor({ offer: offerRow({ rider: OTHER_RIDER_HEX }) }), { reason: "TOO_FAR" });
    assert.equal(response.status, 403);
    const parsed = (await response.json()) as { error: { code: string } };
    assert.equal(parsed.error.code, "OFFER_NOT_TARGETED");
  });

  test("an order that was claimed while the sheet was open cannot be declined", async () => {
    const response = await reject(dbFor({ order: { ...ORDER_ROW, state: "RIDER_ASSIGNED" } }), { reason: "TOO_FAR" });
    assert.equal(response.status, 409);
    const parsed = (await response.json()) as { error: { code: string } };
    assert.equal(parsed.error.code, "OFFER_REJECT_NOT_ALLOWED");
  });
});
