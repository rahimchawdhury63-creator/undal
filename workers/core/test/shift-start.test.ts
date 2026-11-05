/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Beginning a shift (`08 §8`, `19 §3`, D109).
 *
 * The route is the only way a rider's live row ever exists, so the tests are about the four questions it asks
 * before writing anything — who, approved, already open, which zone — and about the one thing it must never do:
 * leave a shift open in TiDB whose live row could not be written. That case is tested by making the internal
 * call fail and asserting the shift row was deleted and the rider's state put back.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SHIFT_ROUTES } from "../src/routes/shift.ts";
import type { Ctx } from "../src/middleware/context.ts";
import type { Principal } from "../src/rbac/guard.ts";
import type { Db } from "../src/db/client.ts";
import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";

const USER_HEX = "0193f2a17c3e7890abcdef0123456701";
const RIDER_HEX = "0193f2a17c3e7890abcdef0123456707";
const ZONE_HEX = "0193f2a17c3e7890abcdef0123456703";
const OTHER_ZONE_HEX = "0193f2a17c3e7890abcdef01234567bb";
const SHIFT_HEX = "0193f2a17c3e7890abcdef01234567c0";

const bytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
};

const RIDER_ROW = {
  id: bytes(RIDER_HEX),
  code: "RDR-4K2M",
  status: "APPROVED",
  shift_state: "OFFLINE",
  home_zone_id: bytes(ZONE_HEX),
  vehicle: "MOTORBIKE",
};

/** The statements a start touches, with the order rows a test needs to vary. */
function shiftDb(
  options: {
    rider?: Record<string, unknown> | null;
    openShift?: boolean;
    assigned?: boolean;
  } = {},
): ReturnType<typeof stubDb> {
  const rider = options.rider === undefined ? RIDER_ROW : options.rider;
  return stubDb([
    { match: /FROM `riders` WHERE `user_id`/u, rows: rider === null ? [] : [rider] },
    {
      match: /FROM `rider_shifts`/u,
      rows: options.openShift === true ? [{ id: bytes(SHIFT_HEX), zone_id: bytes(ZONE_HEX), started_at: "2026-11-06 09:00:00.000000" }] : [],
    },
    { match: /FROM `rider_zone_assignments`/u, rows: options.assigned === true ? [{ id: bytes(SHIFT_HEX) }] : [] },
    { match: /INSERT INTO `rider_shifts`/u, affectedRows: 1 },
    { match: /UPDATE `riders` SET/u, affectedRows: 1 },
    { match: /DELETE FROM `rider_shifts`/u, affectedRows: 1 },
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

function ctxFor(db: Db, waitUntil: (promise: Promise<unknown>) => void = () => undefined): Ctx {
  return {
    env: testEnv({ REALTIME_BASE: "https://rt.undal.test", INTERNAL_TOKEN: "internal-secret" }),
    db,
    url: new URL("https://api.undal.test/v1/rider/shift/start"),
    request: new Request("https://api.undal.test/v1/rider/shift/start", { method: "POST" }),
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

const BODY = {
  selfieUrl: "https://i.ibb.co/abc123/selfie.jpg",
  point: { lat: 24.894215, lon: 91.868912 },
};

const route = () => {
  const found = SHIFT_ROUTES.find((candidate) => candidate.path === "/v1/rider/shift/start");
  if (found === undefined) throw new Error("no shift start route");
  return found;
};

/** Serve every internal call with a chosen answer, and record what was asked. */
function serveInternal(ok: boolean): { calls: { url: string; body: string }[]; restore(): void } {
  const calls: { url: string; body: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body ?? "") });
    return ok
      ? new Response(JSON.stringify({ ok: true, data: { opened: true, shiftId: SHIFT_HEX, staleAfterMs: 1 } }), { status: 200 })
      : new Response(JSON.stringify({ ok: false, error: { code: "SERVICE_DEGRADED" } }), { status: 503 });
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

describe("POST /v1/rider/shift/start", () => {
  test("an approved rider with no open shift opens one, seeds the live row, and audits it", async () => {
    const db = shiftDb();
    const served = serveInternal(true);
    try {
      const response = await route().run(ctxFor(db), { params: {}, body: BODY, reason: null });
      assert.equal(response.status, 200);
      const parsed = (await response.json()) as { data: { shiftId: string; zoneId: string; shiftState: string; vehicle: string } };
      assert.equal(parsed.data.shiftState, "ONLINE");
      assert.equal(parsed.data.zoneId, ZONE_HEX, "the home zone is the default");
      assert.equal(parsed.data.vehicle, "MOTORBIKE");
      assert.match(parsed.data.shiftId, /^[0-9a-f]{32}$/u);
    } finally {
      served.restore();
    }
    const insert = db.calls.find((call) => call.sql.startsWith("INSERT INTO `rider_shifts`"));
    assert.notEqual(insert, undefined);
    assert.match(insert?.params.join("|") ?? "", /i\.ibb\.co/u);
    const state = db.calls.find((call) => call.sql.startsWith("UPDATE `riders` SET `shift_state`"));
    assert.equal(state?.params[0], "ONLINE");
    assert.deepEqual(state?.params[1], bytes(RIDER_HEX), "the row id, not the user id");
    assert.ok(db.calls.some((call) => call.sql.startsWith("INSERT INTO `audit_log`")));
    assert.ok(
      served.calls.some((call) => call.url.endsWith("/internal/shift/open")),
      "the live row is the reason this route exists",
    );
    const seeded = JSON.parse(served.calls.find((call) => call.url.endsWith("/internal/shift/open"))?.body ?? "{}") as {
      riderId: string;
      zoneId: string;
      vehicle: string;
      point: { lat: number };
    };
    // The identity, not the row: D1's `rider_current.rider_id` is the token's `sub`, which is what every flush
    // carries. D109 seeded this with `riders.id` and every flush still answered SHIFT_NOT_OPEN (D110).
    assert.equal(seeded.riderId, USER_HEX, "the seed is keyed by the user id, which is what a flush carries");
    assert.notEqual(seeded.riderId, RIDER_HEX, "a rider row id here writes a row nothing reads");
    assert.equal(seeded.zoneId, ZONE_HEX);
    assert.equal(seeded.vehicle, "MOTORBIKE");
    assert.equal(seeded.point.lat, 24.894215);
  });

  test("a second tap is refused with the shift that is already open", async () => {
    const response = await route().run(ctxFor(shiftDb({ openShift: true })), { params: {}, body: BODY, reason: null });
    assert.equal(response.status, 409);
    const parsed = (await response.json()) as { error: { code: string; details?: { shift_id?: string } } };
    assert.equal(parsed.error.code, "SHIFT_ALREADY_OPEN");
    assert.equal(parsed.error.details?.shift_id, SHIFT_HEX);
  });

  test("an application still under review cannot start a shift", async () => {
    const response = await route().run(
      ctxFor(shiftDb({ rider: { ...RIDER_ROW, status: "UNDER_REVIEW" } })),
      { params: {}, body: BODY, reason: null },
    );
    assert.equal(response.status, 409);
    const parsed = (await response.json()) as { error: { code: string } };
    assert.equal(parsed.error.code, "SHIFT_KYC_PENDING");
  });

  test("a suspended rider is told the account is suspended, not that KYC is pending", async () => {
    const response = await route().run(
      ctxFor(shiftDb({ rider: { ...RIDER_ROW, status: "SUSPENDED" } })),
      { params: {}, body: BODY, reason: null },
    );
    assert.equal(response.status, 451);
    const parsed = (await response.json()) as { error: { code: string } };
    assert.equal(parsed.error.code, "AUTH_ACCOUNT_SUSPENDED");
  });

  test("a token with no rider row behind it is a broken account", async () => {
    const response = await route().run(ctxFor(shiftDb({ rider: null })), { params: {}, body: BODY, reason: null });
    assert.equal(response.status, 403);
    const parsed = (await response.json()) as { error: { details?: { reason?: string } } };
    assert.equal(parsed.error.details?.reason, "not_a_rider");
  });

  test("a selfie that is not an https URL is a missing selfie", async () => {
    const response = await route().run(ctxFor(shiftDb()), {
      params: {},
      body: { ...BODY, selfieUrl: "http://example.test/selfie.jpg" },
      reason: null,
    });
    assert.equal(response.status, 422);
    const parsed = (await response.json()) as { error: { code: string; details?: { field?: string } } };
    assert.equal(parsed.error.code, "SHIFT_SELFIE_REQUIRED");
    assert.equal(parsed.error.details?.field, "selfieUrl");
  });

  test("a zone the rider is not assigned to is refused, and nothing is written", async () => {
    const db = shiftDb({ assigned: false });
    const response = await route().run(ctxFor(db), {
      params: {},
      body: { ...BODY, zoneId: OTHER_ZONE_HEX },
      reason: null,
    });
    assert.equal(response.status, 409);
    const parsed = (await response.json()) as { error: { code: string } };
    assert.equal(parsed.error.code, "SHIFT_ZONE_NOT_ASSIGNED");
    assert.ok(!db.calls.some((call) => call.sql.startsWith("INSERT INTO `rider_shifts`")));
  });

  test("an assigned rider may start in the zone they were moved to", async () => {
    const served = serveInternal(true);
    try {
      const response = await route().run(ctxFor(shiftDb({ assigned: true })), {
        params: {},
        body: { ...BODY, zoneId: OTHER_ZONE_HEX },
        reason: null,
      });
      assert.equal(response.status, 200);
      const parsed = (await response.json()) as { data: { zoneId: string } };
      assert.equal(parsed.data.zoneId, OTHER_ZONE_HEX);
    } finally {
      served.restore();
    }
  });

  test("a live row that cannot be written undoes the shift rather than leaving one invisible", async () => {
    const db = shiftDb();
    const served = serveInternal(false);
    try {
      const response = await route().run(ctxFor(db), { params: {}, body: BODY, reason: null });
      assert.equal(response.status, 503);
      const parsed = (await response.json()) as { error: { code: string; details?: { reason?: string } } };
      assert.equal(parsed.error.code, "SERVICE_DEGRADED");
      assert.equal(parsed.error.details?.reason, "live_position_unavailable");
    } finally {
      served.restore();
    }
    const deleted = db.calls.find((call) => call.sql.startsWith("DELETE FROM `rider_shifts`"));
    assert.notEqual(deleted, undefined, "the shift row is removed");
    const restored = db.calls.filter((call) => call.sql.startsWith("UPDATE `riders` SET `shift_state`"));
    assert.deepEqual(restored.map((call) => call.params[0]), ["ONLINE", "OFFLINE"]);
    assert.ok(!db.calls.some((call) => call.sql.startsWith("INSERT INTO `audit_log`")), "a shift that did not open is not audited as opened");
  });

  test("a rider locked for cash is refused with the amount they owe", async () => {
    const db = shiftDb({ rider: { ...RIDER_ROW, shift_state: "CASH_LOCKED" } });
    // The balance row answers the amount; the db stub resolves the first matching statement.
    const withCash = {
      ...db,
      first: async (sql: string, params: readonly unknown[] = []) =>
        sql.includes("outstanding_paisa") ? { outstanding_paisa: 214_000 } : db.first(sql, params),
    } as typeof db;
    const response = await route().run(ctxFor(withCash), { params: {}, body: BODY, reason: null });
    assert.equal(response.status, 409);
    const parsed = (await response.json()) as { error: { code: string; details?: { outstanding?: number } } };
    assert.equal(parsed.error.code, "SHIFT_CASH_OVERDUE");
    assert.equal(parsed.error.details?.outstanding, 214_000);
  });

  test("a deployment with no realtime configured cannot claim a shift is trackable", async () => {
    const db = shiftDb();
    const routeDefinition = route();
    const ctx = { ...ctxFor(db), env: testEnv() };
    const response = await routeDefinition.run(ctx, { params: {}, body: BODY, reason: null });
    assert.equal(response.status, 503);
  });
});
