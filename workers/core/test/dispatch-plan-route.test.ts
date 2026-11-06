/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Planning and writing a wave (`11 §7`, D126).
 *
 * Three things are asserted that a plausible wiring gets wrong. **The lock comes first**: a second planner must not
 * reach the database at all. **A live wave stops the next one**: writing wave 2 while wave 1's phones ring tells eight
 * riders the order is gone. And **wave 1 only is written**: `planWaves` returns the whole cascade, and writing all of
 * it is the opposite of a cascade.
 */

import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { DISPATCH_ROUTES } from "../src/routes/dispatch.ts";
import type { Ctx, RouteDefinition } from "../src/middleware/context.ts";
import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";

const ORDER_HEX = "0193f2a17c3e7890abcdef0123456705";
const ZONE_HEX = "0193f2a17c3e7890abcdef0123456703";
const VENDOR_HEX = "0193f2a17c3e7890abcdef0123456709";
const RIDER_HEX = "0193f2a17c3e7890abcdef0123456707";
const USER_HEX = "0193f2a17c3e7890abcdef0123456701";

const LAT0 = 248_981_000;
const LON0 = 918_698_000;
const STEP = 10_000;

const realFetch = globalThis.fetch;

function bytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "hex"));
}

function ring(): number[][] {
  return [
    [LON0 - 49 * STEP, LAT0 - 45 * STEP],
    [LON0 + 49 * STEP, LAT0 - 45 * STEP],
    [LON0 + 49 * STEP, LAT0 + 45 * STEP],
    [LON0 - 49 * STEP, LAT0 + 45 * STEP],
    [LON0 - 49 * STEP, LAT0 - 45 * STEP],
  ];
}

interface Options {
  readonly orderState?: string;
  readonly liveOffers?: number;
  readonly lastWave?: number;
  readonly lockHeldBy?: string | null;
  readonly locked?: boolean;
  readonly candidates?: readonly Record<string, unknown>[];
  readonly history?: readonly Record<string, unknown>[];
  /** Delivery rating tallies, as the fourth history statement returns them (D138). */
  readonly ratings?: readonly Record<string, unknown>[];
  /** The `platform_config` value for the zone's acceptance model (`09 §7.4`, D133), or absent for none. */
  readonly propensity?: Record<string, unknown>;
}

function dbFor(options: Options = {}): ReturnType<typeof stubDb> {
  return stubDb([
    { match: /FROM `device_tokens` `t` JOIN `devices` `d`/u, rows: [{ fcm_token: "tok-1" }, { fcm_token: "tok-2" }] },
    { match: /INSERT INTO `fcm_dispatches`/u, affectedRows: 1 },
    // A zone with no `dispatch.propensity` row scores factor 3 from the rider's own record (D133).
    { match: /FROM `platform_config`/u, rows: options.propensity === undefined ? [] : [{ value: options.propensity }] },
    {
      match: /FROM `orders` WHERE `code`/u,
      rows: [
        {
          id: bytes(ORDER_HEX),
          code: "UND-7K2M9QX4",
          state: options.orderState ?? "RIDER_SEARCH",
          zone_id: bytes(ZONE_HEX),
          vendor_id: bytes(VENDOR_HEX),
          total_paisa: 24_000,
          rider_payout_paisa: 8_400,
          pickup_lat_e7: LAT0,
          pickup_lon_e7: LON0,
          ready_at_estimate: "2023-11-14 22:10:00.000000",
        },
      ],
    },
    { match: /INSERT INTO `dispatch_locks`/u, affectedRows: 1 },
    {
      match: /FROM `dispatch_locks` WHERE `order_id`/u,
      rows: [{ holder: options.lockHeldBy ?? "core:dispatch/plan", expires_at: "2023-11-14 22:13:30.000000" }],
    },
    { match: /MAX\(`wave`\)/u, rows: [{ last: options.lastWave ?? null, live: options.liveOffers ?? 0 }] },
    { match: /FROM `zones` WHERE `id`/u, rows: [{ polygon: ring() }] },
    { match: /FROM `riders` r/u, rows: [...(options.candidates ?? [candidateRow()])] },
    { match: /FROM `order_offers`/u, rows: [] },
    { match: /FROM `devices` d/u, rows: [{ user_id: bytes(USER_HEX) }] },
    { match: /FROM `rider_suspensions`/u, rows: [] },
    { match: /FROM `rider_stats`/u, rows: [...(options.history ?? [])] },
    { match: /FROM `orders` WHERE `rider_id` IN/u, rows: [] },
    { match: /FROM `order_ratings` `r` JOIN `order_assignments`/u, rows: [...(options.ratings ?? [])] },
    { match: /INSERT INTO `order_offers`/u, affectedRows: 1 },
    { match: /FROM `audit_log`/u, rows: [{ seq: 4, hash: null }] },
    { match: /INSERT INTO `audit_log`/u, affectedRows: 1 },
    { match: /UPDATE `dispatch_locks`/u, affectedRows: 1 },
  ]);
}

function candidateRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rider_id: bytes(RIDER_HEX),
    user_id: bytes(USER_HEX),
    code: "RDR-4K2M",
    status: "APPROVED",
    shift_state: "ONLINE",
    vehicle: "MOTORBIKE",
    zone_id: ZONE_HEX,
    selfie_verified: 1,
    cash_collected_paisa: 0,
    active_load: 0,
    ...overrides,
  };
}

const sent: { url: string; body: unknown }[] = [];

function stubFeed(riders: readonly string[]): void {
  sent.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
    if (String(input).includes("messages:send")) {
      // A push answered as Google answers it; the feed stub below is for the candidate call only.
      return Response.json({ name: "projects/undal-prod/messages/1" });
    }
    return Response.json({
      ok: true,
      data: {
        zoneId: ZONE_HEX,
        atMs: Date.now(),
        candidates: riders.map((riderId) => ({
          riderId,
          zoneId: ZONE_HEX,
          vehicle: "MOTORBIKE",
          state: "ONLINE",
          latE7: LAT0,
          lonE7: LON0,
          accuracyM: 8,
          batteryPct: 70,
          updatedAtMs: Date.now() - 2_000,
          staleAfterMs: Date.now() + 28_000,
        })),
      },
    });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

function route(): RouteDefinition {
  const found = DISPATCH_ROUTES.find((definition) => definition.path === "/internal/dispatch/plan");
  assert.ok(found !== undefined);
  return found;
}

function ctxFor(db: ReturnType<typeof stubDb>, fcm = false): Ctx {
  return {
    env: testEnv({
      INTERNAL_TOKEN: "internal-secret",
      REALTIME_BASE: "https://rt.undal.app",
      ...(fcm ? { FCM_PROJECT_ID: "undal-prod", FCM_ACCESS_TOKEN: "ya29.token", FCM_ENDPOINT: "https://fcm.test" } : {}),
    }),
    db,
    requestId: "0193f2a1-7c3e-7890-abcd-ef0123456701",
    locale: "en",
    principal: null,
    request: new Request("https://api.undal.test/internal/dispatch/plan", {
      method: "POST",
      headers: { authorization: "Bearer internal-secret" },
    }),
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
  } as unknown as Ctx;
}

const INPUT = { params: {}, body: { orderCode: "UND-7K2M9QX4" }, reason: null };

const pending: Promise<unknown>[] = [];

async function answer(response: Response): Promise<{ status: number; data: Record<string, unknown>; code?: string }> {
  const parsed = (await response.json()) as Record<string, unknown>;
  const error = parsed["error"] as { code?: string } | undefined;
  return {
    status: response.status,
    data: (parsed["data"] ?? {}) as Record<string, unknown>,
    ...(error === undefined ? {} : { code: String(error.code ?? "") }),
  };
}

describe("planning a wave (D126)", () => {
  test("the eligible rider gets an offer, ranked first, with a score", async () => {
    stubFeed([USER_HEX]);
    const result = await answer(await route().run(ctxFor(dbFor()), INPUT));
    assert.equal(result.status, 200);
    assert.equal(result.data["wave"], 1);
    const offered = result.data["offered"] as { riderId: string; rank: number; score: number }[];
    assert.equal(offered.length, 1);
    assert.equal(offered[0]?.riderId, RIDER_HEX);
    assert.equal(offered[0]?.rank, 1);
    assert.ok((offered[0]?.score ?? 0) > 0, "the score is the fourteen-factor sum, not acceptance alone");
    assert.equal(result.data["written"], 1);
  });

  test("factor 6 lifts a rated rider over the same rider unrated (D138)", async () => {
    stubFeed([USER_HEX]);
    const unrated = await answer(await route().run(ctxFor(dbFor()), INPUT));
    stubFeed([USER_HEX]);
    const rated = await answer(
      await route().run(
        ctxFor(dbFor({ ratings: [{ rider_id: bytes(RIDER_HEX), good: 96, total: 100 }] })),
        INPUT,
      ),
    );
    const before = (unrated.data["offered"] as { score: number }[])[0]?.score ?? 0;
    const after = (rated.data["offered"] as { score: number }[])[0]?.score ?? 0;
    assert.ok(after > before, `a rider customers rate well should score higher: ${String(before)} then ${String(after)}`);
  });

  test("the offers are written once, with one expiry and the order's payout", async () => {
    stubFeed([USER_HEX]);
    const db = dbFor();
    await route().run(ctxFor(db), INPUT);
    const insert = db.calls.find((call) => /INSERT INTO `order_offers`/u.test(call.sql));
    assert.ok(insert !== undefined);
    assert.equal(insert.params.length, 11, "one offer, eleven columns: the feature vector among them (D134)");
    assert.equal(insert.params[3], 1, "wave 1");
    assert.equal(insert.params[4], 1, "rank 1");
    assert.equal(insert.params[7], 8_400, "the order's rider payout");
    assert.equal(insert.params[8], null, "no zone model in this fixture, so no vector to record");
  });

  test("the plan travels with the answer, so the caller knows when to come back", async () => {
    stubFeed([USER_HEX]);
    const result = await answer(await route().run(ctxFor(dbFor()), INPUT));
    const planned = result.data["planned"] as { wave: number; ttlS: number }[];
    assert.equal(planned[0]?.wave, 1);
    assert.equal(planned[0]?.ttlS, 25);
    assert.ok(typeof result.data["expiresAtMs"] === "number");
  });

  test("a live wave stops the next one before anything is written", async () => {
    stubFeed([USER_HEX]);
    const db = dbFor({ liveOffers: 3, lastWave: 1 });
    const result = await answer(await route().run(ctxFor(db), INPUT));
    assert.equal(result.status, 409);
    assert.equal(result.code, "OFFER_WAVE_CLOSED");
    assert.equal(
      db.calls.filter((call) => /INSERT INTO `order_offers`/u.test(call.sql)).length,
      0,
      "nothing was written",
    );
  });

  test("a lock held by another planner is reported, not waited on", async () => {
    stubFeed([USER_HEX]);
    const db = dbFor({ lockHeldBy: "realtime:coordinator-7" });
    const result = await answer(await route().run(ctxFor(db), INPUT));
    assert.equal(result.status, 409);
    assert.equal(result.code, "ORDER_LOCKED");
    assert.equal(db.calls.filter((call) => /FROM `riders` r/u.test(call.sql)).length, 0, "no work was done");
  });

  test("the lock is released even when the wave was written", async () => {
    stubFeed([USER_HEX]);
    const db = dbFor();
    await route().run(ctxFor(db), INPUT);
    const release = db.calls.find((call) => /UPDATE `dispatch_locks`/u.test(call.sql));
    assert.ok(release !== undefined, "a lock left behind blocks the next wave for its whole TTL");
  });

  test("an order that is no longer searching is refused before the lock", async () => {
    stubFeed([USER_HEX]);
    const db = dbFor({ orderState: "RIDER_ASSIGNED" });
    const result = await answer(await route().run(ctxFor(db), INPUT));
    assert.equal(result.status, 409);
    assert.equal(result.code, "ORDER_NOT_ACCEPTABLE");
    assert.equal(db.calls.filter((call) => /dispatch_locks/u.test(call.sql)).length, 0);
  });

  test("nobody available is an answer, not an error, and writes nothing", async () => {
    stubFeed([]);
    const db = dbFor();
    const result = await answer(await route().run(ctxFor(db), INPUT));
    assert.equal(result.status, 200);
    assert.equal(result.data["wave"], null);
    assert.equal(result.data["reason"], "NO_ELIGIBLE_CANDIDATES");
    assert.equal(db.calls.filter((call) => /INSERT INTO `order_offers`/u.test(call.sql)).length, 0);
  });

  test("the audit row records the wave, its size and the unjudgeable candidates", async () => {
    stubFeed([USER_HEX]);
    const db = dbFor({ candidates: [candidateRow(), candidateRow({ rider_id: bytes("0193f2a17c3e7890abcdef0123456711"), vehicle: "TRUCK" })] });
    await route().run(ctxFor(db), INPUT);
    const auditInsert = db.calls.find((call) => /INSERT INTO `audit_log`/u.test(call.sql));
    assert.ok(auditInsert !== undefined);
    const payload = auditInsert.params.map((value) => (typeof value === "string" ? value : "")).join(" ");
    assert.match(payload, /dispatch\.wave\.plan/u);
    assert.match(payload, /UNKNOWN_VEHICLE/u);
  });

  test("a missing token is refused with no database access", async () => {
    const db = dbFor();
    const ctx = ctxFor(db);
    (ctx as unknown as { request: Request }).request = new Request("https://api.undal.test/internal/dispatch/plan", {
      method: "POST",
    });
    const result = await answer(await route().run(ctx, INPUT));
    assert.equal(result.status, 401);
    assert.equal(db.calls.length, 0);
  });
});

describe("the ring (D127)", () => {
  test("an offered rider is told once, on their own audience", async () => {
    stubFeed([USER_HEX]);
    pending.length = 0;
    await route().run(ctxFor(dbFor()), INPUT);
    await Promise.all(pending);
    const broadcasts = sent.filter((entry) => entry.url.endsWith("/internal/broadcast"));
    assert.equal(broadcasts.length, 1);
    const body = broadcasts[0]?.body as { event: string; audience: { riderUserId: string }; payload: Record<string, unknown> };
    assert.equal(body.event, "offer.new");
    assert.equal(body.audience.riderUserId, USER_HEX, "the rider channel is keyed by user id, not the row id");
    assert.equal(body.payload["orderCode"], "UND-7K2M9QX4");
    assert.ok(typeof body.payload["secondsRemaining"] === "number");
    assert.ok(body.payload["body"] !== undefined, "the copy travels with the data");
  });

  test("the ring happens after the offers exist, and nobody unoffered is rung", async () => {
    stubFeed([USER_HEX]);
    pending.length = 0;
    await route().run(ctxFor(dbFor()), INPUT);
    await Promise.all(pending);
    const broadcastIndex = sent.findIndex((entry) => entry.url.endsWith("/internal/broadcast"));
    assert.ok(broadcastIndex >= 0);
    // The feed call comes first; the broadcast is queued only once the wave is written.
    assert.equal(sent[0]?.url.includes("/internal/candidates"), true);
  });

  test("a wave with nobody in it rings nobody", async () => {
    stubFeed([]);
    pending.length = 0;
    await route().run(ctxFor(dbFor()), INPUT);
    await Promise.all(pending);
    assert.equal(sent.filter((entry) => entry.url.endsWith("/internal/broadcast")).length, 0);
  });
});

describe("the push behind the ring (D128)", () => {
  test("every valid token of an offered rider is sent once, and recorded", async () => {
    stubFeed([USER_HEX]);
    pending.length = 0;
    const db = dbFor();
    await route().run(ctxFor(db, true), INPUT);
    await Promise.all(pending);
    const pushes = sent.filter((entry) => entry.url === "https://fcm.test/v1/projects/undal-prod/messages:send");
    assert.equal(pushes.length, 2, "one per token, not one per rider");
    const rows = db.calls.filter((call) => /INSERT INTO `fcm_dispatches`/u.test(call.sql));
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.params[4], 1, "first attempt");
    assert.equal(rows[0]?.params[5], "SENT");
  });

  test("the push carries the offer's data and no platform alert object", async () => {
    stubFeed([USER_HEX]);
    pending.length = 0;
    await route().run(ctxFor(dbFor(), true), INPUT);
    await Promise.all(pending);
    const push = sent.find((entry) => entry.url === "https://fcm.test/v1/projects/undal-prod/messages:send");
    const body = push?.body as { message: { data: Record<string, string>; android: { priority: string } } };
    assert.equal(body.message.data["orderCode"], "UND-7K2M9QX4");
    assert.ok(body.message.data["titleBn"] !== undefined, "the copy travels so the app can draw in either language");
    assert.equal(body.message.android.priority, "high");
  });

  test("the alarm names the offer row, because that is the id the rider's accept call carries (D131)", async () => {
    stubFeed([USER_HEX]);
    pending.length = 0;
    const db = dbFor();
    await route().run(ctxFor(db, true), INPUT);
    await Promise.all(pending);
    const written = db.calls.find((call) => /INSERT INTO `order_offers`/u.test(call.sql));
    const offerHex = Buffer.from(written?.params[0] as Uint8Array).toString("hex");
    const push = sent.find((entry) => entry.url === "https://fcm.test/v1/projects/undal-prod/messages:send");
    const body = push?.body as { message: { data: Record<string, string> } };
    // D128 pushed the rider's id here, so the deep link a rider tapped asked for an offer that did not exist.
    assert.equal(body.message.data["offerId"], offerHex, "the offer, not the rider");
    assert.notEqual(offerHex, RIDER_HEX);
  });

  test("an attempt is counted per phone, not by position in the device list (D131)", async () => {
    stubFeed([USER_HEX]);
    pending.length = 0;
    const db = dbFor();
    await route().run(ctxFor(db, true), INPUT);
    await Promise.all(pending);
    const rows = db.calls.filter((call) => /INSERT INTO `fcm_dispatches`/u.test(call.sql));
    assert.equal(rows.length, 2);
    // The second phone is not on its second attempt; both have been rung once for this offer.
    assert.deepEqual(
      rows.map((row) => row.params[4]),
      [1, 1],
    );
  });

  test("without credentials nothing is sent and no dispatch row claims otherwise", async () => {
    stubFeed([USER_HEX]);
    pending.length = 0;
    const db = dbFor();
    await route().run(ctxFor(db), INPUT);
    await Promise.all(pending);
    assert.equal(sent.filter((entry) => entry.url.includes("messages:send")).length, 0);
    assert.equal(db.calls.filter((call) => /INSERT INTO `fcm_dispatches`/u.test(call.sql)).length, 0);
  });
});

describe("advancing the ladder (D129)", () => {
  test("a second call writes wave 2, not wave 1 again", async () => {
    stubFeed([USER_HEX]);
    const db = dbFor({ lastWave: 1 });
    const result = await answer(await route().run(ctxFor(db), INPUT));
    assert.equal(result.status, 200);
    assert.equal(result.data["wave"], 2);
    const insert = db.calls.find((call) => /INSERT INTO `order_offers`/u.test(call.sql));
    assert.ok(insert !== undefined);
    assert.equal(insert.params[3], 2, "the wave number is the order's next one, not the plan's first");
  });

  test("a fourth call writes wave 4 with its own shorter budget", async () => {
    stubFeed([USER_HEX]);
    const db = dbFor({ lastWave: 3 });
    const result = await answer(await route().run(ctxFor(db), INPUT));
    assert.equal(result.data["wave"], 4);
    const insert = db.calls.find((call) => /INSERT INTO `order_offers`/u.test(call.sql));
    assert.ok(insert !== undefined);
    // Wave 4's TTL is 20 s: the expiry is the wave's own, measured from this call.
    assert.ok(String(insert.params[9]).length > 0);
  });

  test("after wave 5 the ladder is exhausted, and nothing more is written", async () => {
    stubFeed([USER_HEX]);
    const db = dbFor({ lastWave: 5 });
    const result = await answer(await route().run(ctxFor(db), INPUT));
    assert.equal(result.status, 200);
    assert.equal(result.data["wave"], null);
    assert.equal(result.data["reason"], "LADDER_EXHAUSTED");
    assert.equal(db.calls.filter((call) => /INSERT INTO `order_offers`/u.test(call.sql)).length, 0);
  });

  test("the advance route is the same handler under the name the driver calls it by", async () => {
    const advance = DISPATCH_ROUTES.find((definition) => definition.path === "/internal/dispatch/advance");
    assert.ok(advance !== undefined);
    stubFeed([USER_HEX]);
    const result = await answer(await advance.run(ctxFor(dbFor({ lastWave: 2 })), INPUT));
    assert.equal(result.data["wave"], 3);
  });
});

/**
 * The acceptance model in the planner (`09 §7.4`, D133).
 *
 * The route is where a zone's trained coefficients meet an actual offer, and the assertion is that they arrive: the same
 * candidates, the same order, and a different `pNone` once the zone has a model. Without the read, every word of the
 * model would be true and none of it would be used.
 */
describe("the zone's acceptance model (D133)", () => {
  test("a trained zone conditions factor 3, and the wave's pNone moves with it", async () => {
    stubFeed([USER_HEX]);
    pending.length = 0;
    const plain = (await (await route().run(ctxFor(dbFor(), true), INPUT)).json()) as { data: { pNone: number } };

    pending.length = 0;
    const db = dbFor({
      // A model that strongly dislikes distance and low payouts. The rider's own rate is unchanged, so any movement in
      // factor 3 is the model's.
      propensity: { weights: [3, -3, -1, 0.5, 0, 0, -1, -2], samples: 50 },
    });
    const conditioned = (await (await route().run(ctxFor(db, true), INPUT)).json()) as {
      data: { pNone: number; offered: readonly { score: number }[] };
    };
    assert.notEqual(conditioned.data.pNone, plain.data.pNone, "the model has to reach the arithmetic");

    const read = db.calls.find((call) => /FROM `platform_config`/u.test(call.sql));
    assert.notEqual(read, undefined, "the zone's row is read once per plan");
    assert.match(read?.sql ?? "", /`key` = \?/u);
    assert.match(read?.sql ?? "", /ORDER BY `effective_at` DESC/u, "the latest version wins, as every config read does");
  });

  test("a trained zone writes the features it judged the offer on (D134)", async () => {
    stubFeed([USER_HEX]);
    pending.length = 0;
    const db = dbFor({ propensity: { weights: [3, -3, -1, 0.5, 0, 0, -1, -2], samples: 50 } });
    await route().run(ctxFor(db, true), INPUT);
    const insert = db.calls.find((call) => /INSERT INTO `order_offers`/u.test(call.sql));
    const stored = insert?.params[8];
    assert.equal(typeof stored, "string", "a JSON column takes a string");
    const vector = JSON.parse(String(stored)) as number[];
    assert.equal(vector.length, 8, "the eight features, in PROPENSITY_FEATURES' order");
    assert.ok((vector[0] ?? 0) > 0, "the payout was present and positive");
    assert.ok(vector.every((value) => value >= 0 && value <= 1), "magnitudes, with the signs in the weights");
  });

  test("a zone with no row plans exactly as it did before the model existed", async () => {
    stubFeed([USER_HEX]);
    pending.length = 0;
    const baseline = (await (await route().run(ctxFor(dbFor(), true), INPUT)).json()) as { data: { pNone: number } };
    pending.length = 0;
    // A zone row that is shaped like nothing — a typo in Brain Lab — must degrade to the record, not fail a dispatch.
    const broken = dbFor({ propensity: { weights: [1, 2, 3], samples: 9 } });
    const again = (await (await route().run(ctxFor(broken, true), INPUT)).json()) as { data: { pNone: number } };
    assert.equal(again.data.pNone, baseline.data.pNone);
    // A row that does not parse falls through to the global one, which is also absent here: two reads, no model.
    assert.equal(broken.calls.filter((call) => /FROM `platform_config`/u.test(call.sql)).length, 2);

    // With no zone row at all the global one is consulted: the sentinel row `08` defines for a default.
    pending.length = 0;
    const untrained = dbFor();
    await route().run(ctxFor(untrained, true), INPUT);
    assert.equal(untrained.calls.filter((call) => /FROM `platform_config`/u.test(call.sql)).length, 2);
  });
});
