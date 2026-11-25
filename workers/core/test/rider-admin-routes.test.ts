/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";
import { RIDER_ADMIN_ROUTES } from "../src/routes/riders.ts";
import type { Ctx, RouteDefinition } from "../src/middleware/context.ts";
import type { Principal } from "../src/rbac/guard.ts";

/**
 * The fleet list, driven at the handler.
 *
 * Three things matter here and none of them is the happy path alone: the cash balance must arrive
 * with the row rather than as a second query per rider, the summary must be arithmetic over exactly
 * the rows returned, and a filter the domain does not have must be refused instead of ignored —
 * an ignored `?shiftState=ONLNE` shows a supervisor an unfiltered fleet and lets them believe it.
 */

const RIDER_ID = new Uint8Array(16).fill(5);
const ZONE_ID = new Uint8Array(16).fill(4);
const RIDER_HEX = "05050505050505050505050505050505";
const ADMIN_ID = "0193f2a1-7c3e-7890-abcd-ef0123456789";

/** A rider row as the repository selects it, with the joined balance. */
interface RiderRowFixture {
  readonly [key: string]: unknown;
  readonly id: Uint8Array;
  readonly outstanding_paisa: number | string;
}

/** The row every test starts from. */
function riderRow(overrides: Partial<RiderRowFixture> = {}): RiderRowFixture {
  return {
    id: RIDER_ID,
    code: "RDR-4K2M",
    full_name: "Rakib Hasan",
    vehicle: "MOTORBIKE",
    home_zone_id: ZONE_ID,
    status: "APPROVED",
    shift_state: "ONLINE",
    payout_method: "BKASH",
    approved_at: "2026-10-01 09:00:00.000000",
    created_at: "2026-09-01 09:00:00.000000",
    updated_at: "2026-11-20 09:00:00.000000",
    outstanding_paisa: 0,
    ...overrides,
  };
}

/** An admin principal. */
function adminPrincipal(): Principal {
  return {
    userId: ADMIN_ID,
    actorType: "ADMIN",
    role: "ADMIN",
    sessionId: "s",
    deviceId: "d",
    zoneScope: null,
    stepUpAtMs: null,
    impersonating: false,
  };
}

/** The context the router would have built. */
function ctxFor(db: ReturnType<typeof stubDb>, path: string): Ctx {
  return {
    env: testEnv(),
    db,
    url: new URL(`https://api.undal.test${path}`),
    request: new Request(`https://api.undal.test${path}`),
    requestId: "0193f2a1-7c3e-7890-abcd-ef0123456700",
    ip: "1.2.3.4",
    userAgent: "test",
    keys: [],
    principal: adminPrincipal(),
    locale: "en",
    startedAtMs: Date.now(),
    waitUntil: () => undefined,
  };
}

/** The single declared route. */
function listRoute(): RouteDefinition {
  const found = RIDER_ADMIN_ROUTES.find((entry) => entry.method === "GET" && entry.path === "/v1/riders");
  assert.notEqual(found, undefined);
  return found as RouteDefinition;
}

/** A database that answers the fleet query. */
function dbWithRiders(rows: readonly RiderRowFixture[]) {
  return stubDb([{ match: /FROM `riders` r LEFT JOIN `rider_cash_balances` b/u, rows: [...rows] }]);
}

describe("the fleet route table", () => {
  test("declares rider.list and nothing else", () => {
    assert.deepEqual(
      RIDER_ADMIN_ROUTES.map((entry) => `${entry.method} ${entry.path} ${entry.permission}`),
      ["GET /v1/riders rider.list"],
    );
    assert.equal(listRoute().write, undefined);
  });
});

describe("the fleet list", () => {
  test("returns the rider, the joined balance and the summary", async () => {
    const db = dbWithRiders([
      riderRow({ shift_state: "ONLINE", outstanding_paisa: 0 }),
      riderRow({ id: new Uint8Array(16).fill(6), code: "RDR-9XQ2", shift_state: "CASH_LOCKED", outstanding_paisa: "234000" }),
    ]);
    const response = await listRoute().run(ctxFor(db, "/v1/riders"), { params: {}, body: undefined, reason: null });
    const body = (await response.json()) as {
      data: {
        riders: Array<Record<string, unknown>>;
        summary: { total: number; online: number; cashLocked: number; outstandingPaisa: number };
      };
    };
    assert.equal(response.status, 200);
    assert.equal(body.data.riders.length, 2);
    assert.equal(body.data.riders[0]?.["id"], RIDER_HEX);
    assert.equal(body.data.riders[1]?.["outstandingPayoutPaisa"], 234_000);
    assert.deepEqual(body.data.summary, { total: 2, online: 1, cashLocked: 1, outstandingPaisa: 234_000, limit: 25 });
  });

  test("counts a rider on an order as online", async () => {
    const db = dbWithRiders([riderRow({ shift_state: "ON_ORDER" })]);
    const response = await listRoute().run(ctxFor(db, "/v1/riders"), { params: {}, body: undefined, reason: null });
    const body = (await response.json()) as { data: { summary: { online: number } } };
    assert.equal(body.data.summary.online, 1);
  });

  test("accepts a shift-state filter in either case", async () => {
    const response = await listRoute().run(ctxFor(dbWithRiders([riderRow()]), "/v1/riders?shiftState=cash_locked"), {
      params: {},
      body: undefined,
      reason: null,
    });
    assert.equal(response.status, 200);
  });

  test("refuses a shift state that is not one of the six", async () => {
    const response = await listRoute().run(ctxFor(dbWithRiders([]), "/v1/riders?shiftState=ONLNE"), {
      params: {},
      body: undefined,
      reason: null,
    });
    assert.equal(response.status, 422);
    const body = (await response.json()) as { error: { details: { field: string } } };
    assert.equal(body.error.details.field, "shiftState");
  });

  test("refuses a status that is not a rider status", async () => {
    const response = await listRoute().run(ctxFor(dbWithRiders([]), "/v1/riders?status=ONLINE"), {
      params: {},
      body: undefined,
      reason: null,
    });
    assert.equal(response.status, 422);
  });

  test("refuses a page size outside the budget", async () => {
    for (const limit of ["0", "101"]) {
      const response = await listRoute().run(ctxFor(dbWithRiders([]), `/v1/riders?limit=${limit}`), {
        params: {},
        body: undefined,
        reason: null,
      });
      assert.equal(response.status, 422);
    }
  });

  test("refuses a zone id that is not an id", async () => {
    const response = await listRoute().run(ctxFor(dbWithRiders([]), "/v1/riders?zoneId=nope"), {
      params: {},
      body: undefined,
      reason: null,
    });
    assert.equal(response.status, 422);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "VALIDATION_ID_MALFORMED");
  });

  test("an empty fleet is a 200 with zeros, not an error", async () => {
    const response = await listRoute().run(ctxFor(dbWithRiders([]), "/v1/riders"), { params: {}, body: undefined, reason: null });
    const body = (await response.json()) as { data: { riders: unknown[]; summary: { total: number }; nextCursor: string | null } };
    assert.equal(response.status, 200);
    assert.deepEqual(body.data.riders, []);
    assert.equal(body.data.summary.total, 0);
    assert.equal(body.data.nextCursor, null);
  });

  test("a full page offers a cursor", async () => {
    const rows = Array.from({ length: 2 }, (_, index) =>
      riderRow({ id: new Uint8Array(16).fill(index + 1), created_at: `2026-10-0${index + 1} 09:00:00.000000` }),
    );
    const response = await listRoute().run(ctxFor(dbWithRiders(rows), "/v1/riders?limit=2"), {
      params: {},
      body: undefined,
      reason: null,
    });
    const body = (await response.json()) as { data: { nextCursor: string | null } };
    assert.equal(typeof body.data.nextCursor, "string");
  });
});
