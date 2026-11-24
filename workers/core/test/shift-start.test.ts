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
    /** The rider's settlement still under review, as `created_at` text, or absent (D142). */
    pendingClaimAt?: string | null;
    /** When that claim was escalated to a senior reviewer, if it was (D146). */
    escalatedAt?: string | null;
    /** A live declaration's `lifted_until`, when the rider declared an emergency (D148). */
    declaredUntil?: string | null;
  } = {},
): ReturnType<typeof stubDb> {
  const rider = options.rider === undefined ? RIDER_ROW : options.rider;
  const claim =
    options.pendingClaimAt === undefined || options.pendingClaimAt === null
      ? []
      : [{
          id: bytes(SHIFT_HEX),
          rider_id: bytes(RIDER_HEX),
          amount_paisa: 214_000,
          method: "BKASH",
          trx_id: "9H5K2M8P1Q",
          status: "PENDING",
          created_at: options.pendingClaimAt,
          escalated_at: options.escalatedAt ?? null,
        }];
  return stubDb([
    { match: /FROM `riders` WHERE `user_id`/u, rows: rider === null ? [] : [rider] },
    { match: /SELECT `lifted_until` FROM `rider_cash_declarations`/u, rows: options.declaredUntil === undefined || options.declaredUntil === null ? [] : [{ lifted_until: options.declaredUntil }] },
    { match: /`status` = 'PENDING' ORDER BY/u, rows: claim },
    { match: /FROM `rider_cash_settlements` WHERE `rider_id` = \? ORDER BY/u, rows: claim },
    {
      match: /FROM `rider_shifts`/u,
      rows: options.openShift === true ? [{ id: bytes(SHIFT_HEX), zone_id: bytes(ZONE_HEX), started_at: "2026-11-06 09:00:00.000000" }] : [],
    },
    { match: /FROM `rider_zone_assignments`/u, rows: options.assigned === true ? [{ id: bytes(SHIFT_HEX) }] : [] },
    { match: /outstanding_paisa` FROM `rider_cash_balances`/u, rows: [{ outstanding_paisa: 214_000 }] },
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
    const db = shiftDb({
      rider: { ...RIDER_ROW, shift_state: "CASH_LOCKED" },
      pendingClaimAt: new Date().toISOString().replace("T", " ").replace("Z", "000"),
    });
    // The balance row answers the amount; the db stub resolves the first matching statement.
    const withCash = {
      ...db,
      first: async (sql: string, params: readonly unknown[] = []) =>
        sql.includes("outstanding_paisa") ? { outstanding_paisa: 214_000 } : db.first(sql, params),
    } as typeof db;
    const response = await route().run(ctxFor(withCash), { params: {}, body: BODY, reason: null });
    assert.equal(response.status, 409);
    const parsed = (await response.json()) as {
      error: { code: string; details?: { outstanding?: number; due_at?: string | null } };
    };
    assert.equal(parsed.error.code, "SHIFT_CASH_OVERDUE");
    assert.equal(parsed.error.details?.outstanding, 214_000);
    // `08` fixes this refusal's details as `{ outstanding, due_at }`, and a screen that says "settle" without saying
    // since when leaves the rider to guess whether they are early or late (D140).
    assert.ok(parsed.error.details !== undefined && "due_at" in parsed.error.details);
  });

  test("a review that has waited two hours lifts the block at the door, and says who took the decision (D142)", async () => {
    // Submitted three hours ago: `25 §8` says the rider is no longer blocked, and no cron exists to have said so.
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1_000).toISOString().replace("T", " ").replace("Z", "000");
    const db = shiftDb({ rider: { ...RIDER_ROW, shift_state: "CASH_LOCKED" }, pendingClaimAt: threeHoursAgo });
    const served = serveInternal(true);
    let response: Response;
    try {
      response = await route().run(ctxFor(db), { params: {}, body: BODY, reason: null });
    } finally {
      served.restore();
    }
    assert.equal(response.status, 200, "the door opens: the platform was slow, not the rider");
    assert.ok(db.calls.some((call) => call.sql === "UPDATE `riders` SET `shift_state` = ? WHERE `id` = ?" && call.params[0] === "OFFLINE"));
    const audited = db.calls.find((call) => call.sql.startsWith("INSERT INTO `audit_log`"));
    assert.ok(audited !== undefined);
    assert.equal(audited.params[9], "rider.cash.auto_lift", "the chain says the platform lifted it, not the rider");
    assert.equal(audited.params[16], "WARNING", "an auto-lift is a platform failure metric (25 §10)");
  });

  test("a claim submitted five minutes ago still blocks, which is the whole point of the screen", async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1_000).toISOString().replace("T", " ").replace("Z", "000");
    const db = shiftDb({ rider: { ...RIDER_ROW, shift_state: "CASH_LOCKED" }, pendingClaimAt: fiveMinutesAgo });
    const response = await route().run(ctxFor(db), { params: {}, body: BODY, reason: null });
    assert.equal(response.status, 409);
    const parsed = (await response.json()) as { error: { code: string } };
    assert.equal(parsed.error.code, "SHIFT_CASH_OVERDUE");
  });

  test("a rider who never submitted stays blocked however long it has been", async () => {
    const db = shiftDb({ rider: { ...RIDER_ROW, shift_state: "CASH_LOCKED" } });
    const response = await route().run(ctxFor(db), { params: {}, body: BODY, reason: null });
    assert.equal(response.status, 409, "the two-hour rule is about the platform's slowness, not about the rider's");
    assert.ok(!db.calls.some((call) => call.sql.startsWith("UPDATE `riders` SET `shift_state`")));
  });
  test("an escalated claim opens the door without a second audit row (D146)", async () => {
    // Five minutes old, so the two-hour rule is nowhere near it: this rider is let through because a human said so.
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1_000).toISOString().replace("T", " ").replace("Z", "000");
    const db = shiftDb({
      rider: { ...RIDER_ROW, shift_state: "CASH_LOCKED" },
      pendingClaimAt: fiveMinutesAgo,
      escalatedAt: fiveMinutesAgo,
    });
    const served = serveInternal(true);
    let response: Response;
    try {
      response = await route().run(ctxFor(db), { params: {}, body: BODY, reason: null });
    } finally {
      served.restore();
    }
    assert.equal(response.status, 200, "a promise to look is better evidence than a promise that ran out");
    assert.ok(db.calls.some((call) => call.sql === "UPDATE `riders` SET `shift_state` = ? WHERE `id` = ?" && call.params[0] === "OFFLINE"));
    const audits = db.calls.filter((call) => call.sql.startsWith("INSERT INTO `audit_log`"));
    assert.ok(
      !audits.some((call) => call.params[9] === "rider.cash.auto_lift"),
      "the escalation is already the record; a platform-failure row here would blame the wrong party",
    );
    assert.ok(audits.some((call) => call.params[9] === "rider.shift.start"), "the shift itself is still audited");
  });

  test("an emergency declaration opens the door for the day it was granted for (D148)", async () => {
    const inTwentyHours = new Date(Date.now() + 20 * 60 * 60 * 1_000).toISOString().replace("T", " ").replace("Z", "000");
    const db = shiftDb({ rider: { ...RIDER_ROW, shift_state: "CASH_LOCKED" }, declaredUntil: inTwentyHours });
    const served = serveInternal(true);
    let response: Response;
    try {
      response = await route().run(ctxFor(db), { params: {}, body: BODY, reason: null });
    } finally {
      served.restore();
    }
    assert.equal(response.status, 200, "§7: not to punish people who do not have the money");
    assert.ok(db.calls.some((call) => call.sql === "UPDATE `riders` SET `shift_state` = ? WHERE `id` = ?" && call.params[0] === "OFFLINE"));
    assert.ok(
      !db.calls.some((call) => call.sql.startsWith("INSERT INTO `audit_log`") && call.params[9] === "rider.cash.auto_lift"),
      "the declaration is the record; the platform was not slow",
    );
  });

  test("a deployment with no realtime configured cannot claim a shift is trackable", async () => {
    const db = shiftDb();
    const routeDefinition = route();
    const ctx = { ...ctxFor(db), env: testEnv() };
    const response = await routeDefinition.run(ctx, { params: {}, body: BODY, reason: null });
    assert.equal(response.status, 503);
  });
});
