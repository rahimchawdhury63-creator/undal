/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Ending a shift (`08 §8`, `07 §6.1`, `25 §2`, D110).
 *
 * The route is where three promises meet, so the tests are about the joins rather than the statements: the
 * shift closes only if it was open, the rider ends `OFFLINE` or `CASH_LOCKED`, the live channel is erased in the
 * same breath, and an order still in the rider's hands refuses the whole thing.
 *
 * The erasure is the one that must not be assumed. `07 §6` says the trail goes when the rider taps End shift,
 * so the test asserts the internal call happened with the **identity** the D1 rows are keyed by, and separately
 * that a failed erasure does not trap the rider online — the sweep is the fuse, not the rider's problem.
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
  shift_state: "ONLINE",
  home_zone_id: bytes(ZONE_HEX),
  vehicle: "MOTORBIKE",
};

/** Ten minutes ago, so `online_seconds` is arithmetic a test can predict. */
const STARTED_AT = "2026-11-06 10:00:00.000000";

function endDb(
  options: {
    rider?: Record<string, unknown> | null;
    openShift?: boolean;
    activeOrders?: number;
    outstanding?: number | null;
    closed?: number;
  } = {},
): ReturnType<typeof stubDb> {
  const rider = options.rider === undefined ? RIDER_ROW : options.rider;
  return stubDb([
    { match: /FROM `riders` WHERE `user_id`/u, rows: rider === null ? [] : [rider] },
    {
      match: /FROM `rider_shifts`/u,
      rows: options.openShift === false ? [] : [{ id: bytes(SHIFT_HEX), zone_id: bytes(ZONE_HEX), started_at: STARTED_AT }],
    },
    { match: /COUNT\(\*\) AS `n` FROM `orders`/u, rows: [{ n: options.activeOrders ?? 0 }] },
    { match: /outstanding_paisa` FROM `rider_cash_balances`/u, rows: options.outstanding === undefined || options.outstanding === null ? [] : [{ outstanding_paisa: options.outstanding }] },
    { match: /UPDATE `rider_shifts` SET/u, affectedRows: options.closed ?? 1 },
    { match: /UPDATE `riders` SET/u, affectedRows: 1 },
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

function ctxFor(db: Db): Ctx {
  return {
    env: testEnv({ REALTIME_BASE: "https://rt.undal.test", INTERNAL_TOKEN: "internal-secret" }),
    db,
    url: new URL("https://api.undal.test/v1/rider/shift/end"),
    request: new Request("https://api.undal.test/v1/rider/shift/end", { method: "POST" }),
    requestId: "0193f2a1-7c3e-7890-abcd-ef0123456700",
    ip: "1.2.3.4",
    userAgent: "test",
    keys: [],
    principal: principalFor,
    locale: "en",
    startedAtMs: 0,
    waitUntil: () => undefined,
  } as Ctx;
}

const route = () => {
  const found = SHIFT_ROUTES.find((candidate) => candidate.path === "/v1/rider/shift/end");
  if (found === undefined) throw new Error("no shift end route");
  return found;
};

/** Serve the internal erasure call with a chosen answer, recording what was asked. */
function serveErase(ok: boolean, erased = { positions: 37, current: 1 }): { calls: { url: string; body: string }[]; restore(): void } {
  const calls: { url: string; body: string }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body ?? "") });
    return ok
      ? new Response(JSON.stringify({ ok: true, data: erased }), { status: 200 })
      : new Response(JSON.stringify({ ok: false, error: { code: "SERVICE_DEGRADED" } }), { status: 503 });
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

describe("POST /v1/rider/shift/end", () => {
  test("a rider with no cash ends OFFLINE, and their live location goes before the answer", async () => {
    const db = endDb({ outstanding: 0 });
    const served = serveErase(true);
    try {
      const response = await route().run(ctxFor(db), { params: {}, body: { point: { lat: 24.9, lon: 91.87 } }, reason: null });
      assert.equal(response.status, 200);
      const parsed = (await response.json()) as {
        data: { shiftState: string; settlementRequired: boolean; cashOutstandingPaisa: number; liveLocationErased: { positions: number; current: number } | null; onlineSeconds: number };
      };
      assert.equal(parsed.data.shiftState, "OFFLINE");
      assert.equal(parsed.data.settlementRequired, false);
      assert.equal(parsed.data.cashOutstandingPaisa, 0);
      assert.deepEqual(parsed.data.liveLocationErased, { positions: 37, current: 1 });
      assert.ok(parsed.data.onlineSeconds >= 0);
    } finally {
      served.restore();
    }
    const close = db.calls.find((call) => call.sql.startsWith("UPDATE `rider_shifts` SET `ended_at`"));
    assert.notEqual(close, undefined);
    assert.equal(close?.params[1], "RIDER_ENDED", "the schema's CHECK allows this reason and only this one from the rider");
    assert.equal(typeof close?.params[4], "number", "the shift's own length travels with the close");
    const state = db.calls.find((call) => call.sql.startsWith("UPDATE `riders` SET `shift_state`"));
    assert.equal(state?.params[0], "OFFLINE");
    const erase = served.calls.find((call) => call.url.endsWith("/internal/erase"));
    assert.notEqual(erase, undefined, "07 §6 promises the trail goes when the rider taps End shift");
    const body = JSON.parse(erase?.body ?? "{}") as { riderId: string; reason: string };
    assert.equal(body.riderId, USER_HEX, "D1 is keyed by the identity a flush carries, not the rider row id");
    assert.equal(body.reason, "shift_end");
    const audit = db.calls.find((call) => call.sql.startsWith("INSERT INTO `audit_log`"));
    assert.notEqual(audit, undefined);
  });

  test("cash in hand leaves the rider CASH_LOCKED, which is what refuses their next shift", async () => {
    const db = endDb({ outstanding: 214_000 });
    const served = serveErase(true);
    try {
      const response = await route().run(ctxFor(db), { params: {}, body: {}, reason: null });
      assert.equal(response.status, 200);
      const parsed = (await response.json()) as { data: { shiftState: string; settlementRequired: boolean; cashOutstandingPaisa: number } };
      assert.equal(parsed.data.shiftState, "CASH_LOCKED");
      assert.equal(parsed.data.settlementRequired, true);
      assert.equal(parsed.data.cashOutstandingPaisa, 214_000);
    } finally {
      served.restore();
    }
    const state = db.calls.find((call) => call.sql.startsWith("UPDATE `riders` SET `shift_state`"));
    assert.equal(state?.params[0], "CASH_LOCKED");
  });

  test("an order still in the rider's hands refuses the end", async () => {
    const db = endDb({ activeOrders: 2 });
    const response = await route().run(ctxFor(db), { params: {}, body: {}, reason: null });
    assert.equal(response.status, 409);
    const parsed = (await response.json()) as { error: { code: string; details?: { active_orders?: number } } };
    assert.equal(parsed.error.code, "SHIFT_ORDERS_ACTIVE");
    assert.equal(parsed.error.details?.active_orders, 2);
    assert.ok(!db.calls.some((call) => call.sql.startsWith("UPDATE `rider_shifts`")), "nothing was closed");
  });

  test("a rider with no open shift is told there is none", async () => {
    const response = await route().run(ctxFor(endDb({ openShift: false })), { params: {}, body: {}, reason: null });
    assert.equal(response.status, 404);
    const parsed = (await response.json()) as { error: { code: string } };
    assert.equal(parsed.error.code, "SHIFT_NOT_FOUND");
  });

  test("a second end racing the first reports the shift as already closed", async () => {
    const served = serveErase(true);
    try {
      const response = await route().run(ctxFor(endDb({ closed: 0 })), { params: {}, body: {}, reason: null });
      assert.equal(response.status, 409);
      const parsed = (await response.json()) as { error: { code: string } };
      assert.equal(parsed.error.code, "SHIFT_ALREADY_CLOSED");
    } finally {
      served.restore();
    }
  });

  test("an erasure that fails does not trap the rider online", async () => {
    const db = endDb({ outstanding: 0 });
    const served = serveErase(false);
    try {
      const response = await route().run(ctxFor(db), { params: {}, body: {}, reason: null });
      assert.equal(response.status, 200, "the shift ended; the trail is the sweep's problem");
      const parsed = (await response.json()) as { data: { shiftState: string; liveLocationErased: { positions: number } | null } };
      assert.equal(parsed.data.shiftState, "OFFLINE");
      assert.deepEqual(parsed.data.liveLocationErased, { positions: 0, current: 0 }, "the answer claims nothing was erased");
    } finally {
      served.restore();
    }
    assert.equal(
      db.calls.filter((call) => call.sql.startsWith("UPDATE `riders` SET `shift_state`")).length,
      1,
      "one state write, and it happened",
    );
  });

  test("a malformed point is refused before anything is read", async () => {
    const db = endDb();
    const response = await route().run(ctxFor(db), { params: {}, body: { point: { lat: 999, lon: 0 } }, reason: null });
    assert.equal(response.status, 422);
    assert.deepEqual(db.calls, []);
  });
});
