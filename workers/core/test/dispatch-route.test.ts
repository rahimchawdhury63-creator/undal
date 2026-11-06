/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * *May this rider be offered this order?* — the route that answers it (`11 §7`, D122).
 *
 * The route's whole value is the shape of a refusal, so most of these tests are about what an operator reads when a
 * wave comes back empty: which filter refused which rider, and whether the reason is a verdict or a data error. The
 * last one is the promise that nothing is written — this rung plans nothing, and a test that only checked the
 * response would not notice if it started.
 */

import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { DISPATCH_ROUTES } from "../src/routes/dispatch.ts";
import type { Ctx, RouteDefinition } from "../src/middleware/context.ts";
import type { Db } from "../src/db/client.ts";
import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";

const ORDER_HEX = "0193f2a17c3e7890abcdef0123456705";
const ZONE_HEX = "0193f2a17c3e7890abcdef0123456703";
const VENDOR_HEX = "0193f2a17c3e7890abcdef0123456709";
const RIDER_HEX = "0193f2a17c3e7890abcdef0123456707";
const USER_HEX = "0193f2a17c3e7890abcdef0123456701";
const OTHER_RIDER_HEX = "0193f2a17c3e7890abcdef0123456711";
const OTHER_USER_HEX = "0193f2a17c3e7890abcdef0123456712";

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

function orderRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: bytes(ORDER_HEX),
    code: "UND-7K2M9QX4",
    state: "RIDER_SEARCH",
    zone_id: bytes(ZONE_HEX),
    vendor_id: bytes(VENDOR_HEX),
    total_paisa: 24_000,
    rider_payout_paisa: 8_400,
    pickup_lat_e7: LAT0,
    pickup_lon_e7: LON0,
    ...overrides,
  };
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

interface Options {
  readonly order?: Record<string, unknown> | null;
  readonly polygon?: unknown;
  readonly candidates?: readonly Record<string, unknown>[];
  readonly rejected?: readonly Record<string, unknown>[];
  readonly notifiable?: readonly Record<string, unknown>[];
  readonly suspended?: readonly Record<string, unknown>[];
}

function dbFor(options: Options = {}): ReturnType<typeof stubDb> {
  const order = options.order === undefined ? orderRow() : options.order;
  return stubDb([
    { match: /FROM `orders` WHERE `code`/u, rows: order === null ? [] : [order] },
    { match: /FROM `zones` WHERE `id`/u, rows: options.polygon === null ? [] : [{ polygon: options.polygon ?? ring() }] },
    { match: /FROM `riders` r/u, rows: [...(options.candidates ?? [candidateRow()])] },
    { match: /FROM `order_offers`/u, rows: [...(options.rejected ?? [])] },
    { match: /FROM `devices` d/u, rows: [...(options.notifiable ?? [{ user_id: bytes(USER_HEX) }])] },
    { match: /FROM `rider_suspensions`/u, rows: [...(options.suspended ?? [])] },
  ]);
}

function feedBody(
  candidates: readonly { riderId: string; latE7?: number; updatedAtMs?: number; staleAfterMs?: number }[],
): Response {
  return Response.json({
    ok: true,
    data: {
      zoneId: ZONE_HEX,
      atMs: 1_700_000_000_000,
      candidates: candidates.map((candidate) => ({
        riderId: candidate.riderId,
        zoneId: ZONE_HEX,
        vehicle: "MOTORBIKE",
        state: "ONLINE",
        latE7: candidate.latE7 ?? LAT0,
        lonE7: LON0,
        accuracyM: 8,
        batteryPct: 70,
        updatedAtMs: candidate.updatedAtMs ?? Date.now() - 3_000,
        staleAfterMs: candidate.staleAfterMs ?? Date.now() + 27_000,
      })),
    },
  });
}

function stubFeed(make: () => Response): void {
  globalThis.fetch = (async () => make()) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

function route(): RouteDefinition {
  const found = DISPATCH_ROUTES.find((definition) => definition.path === "/internal/dispatch/eligibility");
  assert.ok(found !== undefined);
  return found;
}

function ctxFor(db: Db, body: Record<string, unknown> = { orderCode: "UND-7K2M9QX4" }): Ctx {
  return {
    env: testEnv({ INTERNAL_TOKEN: "internal-secret", REALTIME_BASE: "https://rt.undal.app" }),
    db,
    requestId: "req-1",
    locale: "en",
    principal: null,
    body,
    params: {},
    request: new Request("https://api.undal.test/internal/dispatch/eligibility", {
      method: "POST",
      headers: { authorization: "Bearer internal-secret" },
    }),
    waitUntil: () => undefined,
  } as unknown as Ctx;
}

function input(body: Record<string, unknown> = { orderCode: "UND-7K2M9QX4" }): { params: Record<string, string>; body: unknown; reason: string | null } {
  return { params: {}, body, reason: null };
}

async function answer(response: Response): Promise<{ status: number; data: Record<string, unknown>; code?: string }> {
  const parsed = (await response.json()) as Record<string, unknown>;
  const data = (parsed["data"] ?? {}) as Record<string, unknown>;
  return {
    status: response.status,
    data,
    ...(parsed["error"] === undefined ? {} : { code: String((parsed["error"] as { code?: string }).code ?? "") }),
  };
}

describe("the eligibility answer (D122)", () => {
  test("a rider who passes every filter is eligible, and the count says so", async () => {
    stubFeed(() => feedBody([{ riderId: USER_HEX }]));
    const result = await answer(await route().run(ctxFor(dbFor()), input()));
    assert.equal(result.status, 200);
    assert.equal(result.data["eligibleCount"], 1);
    const candidates = result.data["candidates"] as { riderId: string; eligible: boolean; filter: number | null }[];
    assert.deepEqual(candidates, [{ riderId: RIDER_HEX, eligible: true, filter: null, reason: null }]);
  });

  test("a rider with no live position is refused by filter 4, by name", async () => {
    stubFeed(() => feedBody([]));
    const result = await answer(await route().run(ctxFor(dbFor()), input()));
    const candidates = result.data["candidates"] as { eligible: boolean; filter: number | null; reason: string }[];
    assert.equal(result.data["eligibleCount"], 0);
    assert.equal(candidates[0]?.filter, 4);
    assert.equal(candidates[0]?.reason, "POSITION_FRESH");
  });

  test("a rider with no push device is refused by filter 14, not silently dropped", async () => {
    stubFeed(() => feedBody([{ riderId: USER_HEX }]));
    const result = await answer(await route().run(ctxFor(dbFor({ notifiable: [] })), input()));
    const candidates = result.data["candidates"] as { filter: number | null; reason: string }[];
    assert.equal(candidates[0]?.filter, 14);
    assert.equal(candidates[0]?.reason, "NOTIFICATIONS_ENABLED");
  });

  test("a suspended rider is refused by filter 6", async () => {
    stubFeed(() => feedBody([{ riderId: USER_HEX }]));
    const result = await answer(
      await route().run(ctxFor(dbFor({ suspended: [{ rider_id: bytes(RIDER_HEX) }] })), input()),
    );
    const candidates = result.data["candidates"] as { filter: number | null }[];
    assert.equal(candidates[0]?.filter, 6);
  });

  test("a rider who already said no to wave 1 is refused by filter 12", async () => {
    stubFeed(() => feedBody([{ riderId: USER_HEX }]));
    const result = await answer(
      await route().run(ctxFor(dbFor({ rejected: [{ rider_id: bytes(RIDER_HEX), wave: 1 }] })), input()),
    );
    const candidates = result.data["candidates"] as { filter: number | null }[];
    assert.equal(candidates[0]?.filter, 12);
  });

  test("an order carrying more cash than the cap allows is a filter 11 refusal", async () => {
    stubFeed(() => feedBody([{ riderId: USER_HEX }]));
    const db = dbFor({ candidates: [candidateRow({ cash_collected_paisa: 340_000 })] });
    const result = await answer(await route().run(ctxFor(db), input()));
    const candidates = result.data["candidates"] as { filter: number | null }[];
    assert.equal(candidates[0]?.filter, 11, "340 000 + 24 000 exceeds the 350 000 default ceiling");
  });

  test("an unknown vehicle is reported as unjudgeable, not as a filter refusal", async () => {
    stubFeed(() => feedBody([{ riderId: USER_HEX }]));
    const result = await answer(await route().run(ctxFor(dbFor({ candidates: [candidateRow({ vehicle: "TRUCK" })] })), input()));
    assert.deepEqual(result.data["unjudgeable"], [{ riderId: RIDER_HEX, reason: "UNKNOWN_VEHICLE" }]);
    assert.deepEqual(result.data["candidates"], []);
  });

  test("two riders, one eligible and one refused: both are reported, with the right ids", async () => {
    stubFeed(() => feedBody([{ riderId: USER_HEX }]));
    const result = await answer(
      await route().run(
        ctxFor(
          dbFor({
            candidates: [
              candidateRow(),
              candidateRow({ rider_id: bytes(OTHER_RIDER_HEX), user_id: bytes(OTHER_USER_HEX), code: "RDR-99" }),
            ],
          }),
        ),
        input(),
      ),
    );
    const candidates = result.data["candidates"] as { riderId: string; eligible: boolean }[];
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0]?.eligible, true);
    assert.equal(candidates[1]?.eligible, false, "the second rider has no fix");
    assert.equal(result.data["eligibleCount"], 1);
  });
});

describe("what the route refuses before it looks at riders (D122)", () => {
  test("no such order", async () => {
    const result = await answer(await route().run(ctxFor(dbFor({ order: null })), input()));
    assert.equal(result.status, 404);
    assert.equal(result.code, "ORDER_NOT_FOUND");
  });

  test("an order that is not searching for a rider", async () => {
    const result = await answer(await route().run(ctxFor(dbFor({ order: orderRow({ state: "RIDER_ASSIGNED" }) })), input()));
    assert.equal(result.status, 409);
    assert.equal(result.code, "ORDER_NOT_ACCEPTABLE");
  });

  test("a zone row that does not exist", async () => {
    const result = await answer(await route().run(ctxFor(dbFor({ polygon: null })), input()));
    assert.equal(result.status, 404);
    assert.equal(result.code, "ZONE_NOT_FOUND");
  });

  test("a polygon that will not parse", async () => {
    const result = await answer(await route().run(ctxFor(dbFor({ polygon: [[1, 2]] })), input()));
    assert.equal(result.status, 422);
    assert.equal(result.code, "ZONE_TOO_FEW_POINTS");
  });

  test("a body with no order code", async () => {
    const result = await answer(await route().run(ctxFor(dbFor()), input({})));
    assert.equal(result.status, 422);
    assert.equal(result.code, "VALIDATION_FAILED");
  });

  test("a deployment with no realtime base says so instead of answering that nobody is online", async () => {
    const ctx = ctxFor(dbFor());
    (ctx.env as { REALTIME_BASE?: string }).REALTIME_BASE = "";
    const result = await answer(await route().run(ctx, input()));
    assert.equal(result.status, 503);
    assert.equal(result.code, "SERVICE_DEGRADED");
  });

  test("a feed that answers no list is a degraded dependency, not an empty zone", async () => {
    stubFeed(() => Response.json({ ok: true, data: { zoneId: ZONE_HEX } }));
    const result = await answer(await route().run(ctxFor(dbFor()), input()));
    assert.equal(result.status, 503);
    assert.equal(result.code, "SERVICE_DEGRADED");
  });

  test("a missing internal token is refused with no database access at all", async () => {
    const db = dbFor();
    const ctx = ctxFor(db);
    (ctx as unknown as { request: Request }).request = new Request("https://api.undal.test/internal/dispatch/eligibility", {
      method: "POST",
    });
    const result = await answer(await route().run(ctx, input()));
    assert.equal(result.status, 401);
    assert.equal(db.calls.length, 0);
  });

  test("the route only reads: no insert, no update, no delete", async () => {
    stubFeed(() => feedBody([{ riderId: USER_HEX }]));
    const db = dbFor();
    await route().run(ctxFor(db), input());
    for (const call of db.calls) {
      assert.doesNotMatch(call.sql, /^\s*(INSERT|UPDATE|DELETE)/iu, `wrote: ${call.sql}`);
    }
  });
});
