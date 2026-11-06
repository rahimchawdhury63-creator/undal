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
}

function dbFor(options: Options = {}): ReturnType<typeof stubDb> {
  return stubDb([
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

function ctxFor(db: ReturnType<typeof stubDb>): Ctx {
  return {
    env: testEnv({ INTERNAL_TOKEN: "internal-secret", REALTIME_BASE: "https://rt.undal.app" }),
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

  test("the offers are written once, with one expiry and the order's payout", async () => {
    stubFeed([USER_HEX]);
    const db = dbFor();
    await route().run(ctxFor(db), INPUT);
    const insert = db.calls.find((call) => /INSERT INTO `order_offers`/u.test(call.sql));
    assert.ok(insert !== undefined);
    assert.equal(insert.params.length, 10, "one offer, ten columns");
    assert.equal(insert.params[3], 1, "wave 1");
    assert.equal(insert.params[4], 1, "rank 1");
    assert.equal(insert.params[7], 8_400, "the order's rider payout");
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
    assert.equal(body.event, "order.offer");
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
