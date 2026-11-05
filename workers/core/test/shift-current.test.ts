/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The rider's current shift and their break toggle (`08 §8`, D111).
 *
 * The read route's shape is the claim worth testing: **an offline rider is a `200` with `shift: null`.** The app
 * calls this on every launch, most riders are offline most of the time, and a `404` for the normal case would
 * teach the client that an error means "go to the shift screen". The 404 stays where asking is a mistake — ending
 * a shift that is not open.
 *
 * The break toggle is tested for the two things it can get wrong: writing a flag for a rider with no shift, and
 * writing the wrong one of the two audit actions.
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

const SHIFT_ROW = {
  id: bytes(SHIFT_HEX),
  zone_id: bytes(ZONE_HEX),
  started_at: "2026-11-06 10:00:00.000000",
  orders_completed: 4,
  distance_m: 12_480,
};

function dbFor(options: { rider?: Record<string, unknown> | null; openShift?: boolean; outstanding?: number | null } = {}): ReturnType<typeof stubDb> {
  const rider = options.rider === undefined ? RIDER_ROW : options.rider;
  return stubDb([
    { match: /FROM `riders` WHERE `user_id`/u, rows: rider === null ? [] : [rider] },
    { match: /FROM `rider_shifts`/u, rows: options.openShift === false ? [] : [SHIFT_ROW] },
    { match: /outstanding_paisa` FROM `rider_cash_balances`/u, rows: options.outstanding === undefined || options.outstanding === null ? [] : [{ outstanding_paisa: options.outstanding }] },
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

function ctxFor(db: Db, path = "/v1/rider/shift/current"): Ctx {
  return {
    env: testEnv(),
    db,
    url: new URL(`https://api.undal.test${path}`),
    request: new Request(`https://api.undal.test${path}`, { method: "GET" }),
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

const route = (path: string) => {
  const found = SHIFT_ROUTES.find((candidate) => candidate.path === path);
  if (found === undefined) throw new Error(`no route ${path}`);
  return found;
};

describe("GET /v1/rider/shift/current", () => {
  test("an open shift answers with its totals and the clock since the tap", async () => {
    const response = await route("/v1/rider/shift/current").run(ctxFor(dbFor()), { params: {}, body: null, reason: null });
    assert.equal(response.status, 200);
    const parsed = (await response.json()) as {
      data: {
        shiftState: string;
        settlementRequired: boolean;
        shift: { shiftId: string; zoneId: string; vehicle: string; ordersCompleted: number; distanceM: number; onlineSeconds: number } | null;
      };
    };
    assert.equal(parsed.data.shiftState, "ONLINE");
    assert.equal(parsed.data.shift?.shiftId, SHIFT_HEX);
    assert.equal(parsed.data.shift?.zoneId, ZONE_HEX);
    assert.equal(parsed.data.shift?.vehicle, "MOTORBIKE");
    assert.equal(parsed.data.shift?.ordersCompleted, 4);
    assert.equal(parsed.data.shift?.distanceM, 12_480);
    assert.ok((parsed.data.shift?.onlineSeconds ?? -1) >= 0);
    assert.equal(parsed.data.settlementRequired, false);
  });

  test("an offline rider is a 200 with no shift, because that is the normal case", async () => {
    const response = await route("/v1/rider/shift/current").run(
      ctxFor(dbFor({ openShift: false, rider: { ...RIDER_ROW, shift_state: "OFFLINE" } })),
      { params: {}, body: null, reason: null },
    );
    assert.equal(response.status, 200);
    const parsed = (await response.json()) as { data: { shift: unknown; shiftState: string } };
    assert.equal(parsed.data.shift, null);
    assert.equal(parsed.data.shiftState, "OFFLINE");
  });

  test("cash owed is visible on the read, so the app can warn before the end locks them", async () => {
    const response = await route("/v1/rider/shift/current").run(ctxFor(dbFor({ outstanding: 214_000 })), {
      params: {},
      body: null,
      reason: null,
    });
    const parsed = (await response.json()) as { data: { cashOutstandingPaisa: number; settlementRequired: boolean } };
    assert.equal(parsed.data.cashOutstandingPaisa, 214_000);
    assert.equal(parsed.data.settlementRequired, true);
  });

  test("a token with no rider row behind it is refused", async () => {
    const response = await route("/v1/rider/shift/current").run(ctxFor(dbFor({ rider: null })), { params: {}, body: null, reason: null });
    assert.equal(response.status, 403);
  });
});

describe("POST /v1/rider/shift/break", () => {
  const onBreak = (db: Db, body: unknown) =>
    route("/v1/rider/shift/break").run(ctxFor(db, "/v1/rider/shift/break"), { params: {}, body, reason: null });

  test("taking a break flips the state and says so in the audit log", async () => {
    const db = dbFor();
    const response = await onBreak(db, { onBreak: true });
    assert.equal(response.status, 200);
    const parsed = (await response.json()) as { data: { shiftState: string; onBreak: boolean; shiftId: string } };
    assert.equal(parsed.data.shiftState, "BREAK");
    assert.equal(parsed.data.onBreak, true);
    assert.equal(parsed.data.shiftId, SHIFT_HEX);
    const state = db.calls.find((call) => call.sql.startsWith("UPDATE `riders` SET `shift_state`"));
    assert.equal(state?.params[0], "BREAK");
    const audit = db.calls.find((call) => call.sql.startsWith("INSERT INTO `audit_log`"));
    assert.match(audit?.params.join("|") ?? "", /rider\.shift\.break\.start/u);
  });

  test("coming back is the same route with the other value, and a different action", async () => {
    const db = dbFor({ rider: { ...RIDER_ROW, shift_state: "BREAK" } });
    const response = await onBreak(db, { onBreak: false });
    assert.equal(response.status, 200);
    const state = db.calls.find((call) => call.sql.startsWith("UPDATE `riders` SET `shift_state`"));
    assert.equal(state?.params[0], "ONLINE");
    const audit = db.calls.find((call) => call.sql.startsWith("INSERT INTO `audit_log`"));
    assert.match(audit?.params.join("|") ?? "", /rider\.shift\.break\.end/u);
  });

  test("a break with no shift to be on is refused, and writes nothing", async () => {
    const db = dbFor({ openShift: false, rider: { ...RIDER_ROW, shift_state: "OFFLINE" } });
    const response = await onBreak(db, { onBreak: true });
    assert.equal(response.status, 404);
    const parsed = (await response.json()) as { error: { code: string } };
    assert.equal(parsed.error.code, "SHIFT_NOT_FOUND");
    assert.ok(!db.calls.some((call) => call.sql.startsWith("UPDATE `riders`")));
    assert.ok(!db.calls.some((call) => call.sql.startsWith("INSERT INTO `audit_log`")));
  });

  test("a body without a boolean is refused before anything is read", async () => {
    const db = dbFor();
    const response = await onBreak(db, { onBreak: "yes" });
    assert.equal(response.status, 422);
    assert.deepEqual(db.calls, []);
  });
});
