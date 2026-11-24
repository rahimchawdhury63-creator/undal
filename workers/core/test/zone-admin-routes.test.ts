/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";
import { ZONE_ROUTES } from "../src/routes/zones.ts";
import type { Ctx, RouteDefinition } from "../src/middleware/context.ts";
import type { Principal } from "../src/rbac/guard.ts";

/**
 * The zone switches, driven at the handler.
 *
 * The refusals are the interesting half. Pausing an area that has orders in flight is the mistake
 * this route exists to prevent, and reopening a retired area is the mistake it exists to refuse —
 * both are asserted with the code and the detail, because "409" alone tells an operator nothing.
 */

const ZONE_ID = new Uint8Array(16).fill(7);
const ZONE_HEX = "07070707070707070707070707070707";
const ADMIN_ID = "0193f2a1-7c3e-7890-abcd-ef0123456789";

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

/** A route from the table. */
function route(method: string, path: string): RouteDefinition {
  const found = ZONE_ROUTES.find((entry) => entry.method === method && entry.path === path);
  assert.notEqual(found, undefined, `${method} ${path}`);
  return found as RouteDefinition;
}

/** A zone row as the repository selects it. */
function zoneRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ZONE_ID,
    code: "SYL-CENTRAL",
    name: "Sylhet Central",
    name_bn: "সিলেট কেন্দ্র",
    city: "Sylhet",
    country: "BD",
    currency: "BDT",
    timezone: "Asia/Dhaka",
    status: "ACTIVE",
    area_sq_km: 12.5,
    polygon_version: 3,
    centroid_lat_e7: 248_000_000,
    centroid_lon_e7: 917_000_000,
    created_at: "2026-01-05 09:00:00.000000",
    updated_at: "2026-11-20 09:00:00.000000",
    vendor_count: 84,
    rider_count: 41,
    ...overrides,
  };
}

/** A database that answers the statements these routes issue. */
function dbWith(options: {
  readonly row?: Record<string, unknown> | null;
  readonly live?: number;
  readonly updateAffects?: number;
  readonly list?: readonly Record<string, unknown>[];
} = {}) {
  return stubDb([
    { match: /FROM `zones` `z` WHERE `z`\.`id` = \?/u, rows: options.row === null ? [] : [options.row ?? zoneRow()] },
    { match: /FROM `zones` `z` WHERE 1 = 1/u, rows: [...(options.list ?? [])] },
    { match: /FROM `zones` WHERE `id` = \?/u, rows: [{ polygon: { type: "Polygon", coordinates: [[[91.7, 24.8]]] }, polygon_version: 3 }] },
    { match: /FROM `orders` WHERE `zone_id`/u, rows: [{ live: options.live ?? 0 }] },
    { match: /UPDATE `zones` SET/u, affectedRows: options.updateAffects ?? 1 },
    { match: /FROM `audit_log` ORDER BY `seq` DESC/u, rows: [] },
    { match: /INSERT INTO `audit_log`/u, affectedRows: 1 },
    { match: /UPDATE `audit_log`/u, affectedRows: 1 },
  ]);
}

describe("the zone route table", () => {
  test("declares four routes, each behind its own permission", () => {
    assert.deepEqual(
      ZONE_ROUTES.map((entry) => `${entry.method} ${entry.path} ${entry.permission}`),
      [
        "GET /v1/zones zone.list",
        "GET /v1/zones/{id} zone.read",
        "POST /v1/zones/{id}/pause zone.deactivate",
        "POST /v1/zones/{id}/activate zone.activate",
      ],
    );
  });

  test("the two switches are writes and the two readers are not", () => {
    assert.equal(route("GET", "/v1/zones").write, undefined);
    assert.equal(route("GET", "/v1/zones/{id}").write, undefined);
    assert.equal(route("POST", "/v1/zones/{id}/pause").write, true);
    assert.equal(route("POST", "/v1/zones/{id}/activate").write, true);
  });
});

describe("listing zones", () => {
  test("returns the zone with both counts", async () => {
    const db = dbWith({ list: [zoneRow()] });
    const response = await route("GET", "/v1/zones").run(ctxFor(db, "/v1/zones"), { params: {}, body: undefined, reason: null });
    const body = (await response.json()) as { data: { zones: Array<Record<string, unknown>> } };
    assert.equal(response.status, 200);
    assert.equal(body.data.zones[0]?.["code"], "SYL-CENTRAL");
    assert.deepEqual(body.data.zones[0]?.["counts"], { vendors: 84, riders: 41 });
    assert.equal(body.data.zones[0]?.["nameBn"], "সিলেট কেন্দ্র");
  });

  test("the filter reaches the statement as a bound parameter", async () => {
    const db = dbWith({ list: [] });
    await route("GET", "/v1/zones").run(ctxFor(db, "/v1/zones?status=active&q=sylhet"), {
      params: {},
      body: undefined,
      reason: null,
    });
    const call = db.calls[0];
    assert.equal(call?.params[0], "ACTIVE");
    // Three name patterns and the city, then the page size: nothing is interpolated into the SQL.
    assert.deepEqual(call?.params.slice(1, 5), ["%sylhet%", "%sylhet%", "%sylhet%", "%sylhet%"]);
    assert.equal(call?.params[5], 100);
    assert.match(call?.sql ?? "", /ORDER BY `z`\.`code` ASC LIMIT \?$/u);
  });

  test("refuses a status that is not one of the four, and a page size outside the budget", async () => {
    for (const query of ["status=RUNNING", "limit=0", "limit=201"]) {
      const response = await route("GET", "/v1/zones").run(ctxFor(dbWith({ list: [] }), `/v1/zones?${query}`), {
        params: {},
        body: undefined,
        reason: null,
      });
      assert.equal(response.status, 422, query);
    }
  });
});

describe("reading one zone", () => {
  test("returns the row and its ring", async () => {
    const response = await route("GET", "/v1/zones/{id}").run(ctxFor(dbWith(), `/v1/zones/${ZONE_HEX}`), {
      params: { id: ZONE_HEX },
      body: undefined,
      reason: null,
    });
    const body = (await response.json()) as { data: { zone: Record<string, unknown>; polygon: unknown } };
    assert.equal(response.status, 200);
    assert.equal(body.data.zone["id"], ZONE_HEX);
    assert.deepEqual(body.data.polygon, { type: "Polygon", coordinates: [[[91.7, 24.8]]] });
  });

  test("a zone that does not exist is a 404 that names it", async () => {
    const response = await route("GET", "/v1/zones/{id}").run(ctxFor(dbWith({ row: null }), `/v1/zones/${ZONE_HEX}`), {
      params: { id: ZONE_HEX },
      body: undefined,
      reason: null,
    });
    const body = (await response.json()) as { error: { code: string; details: { zone_id: string } } };
    assert.equal(response.status, 404);
    assert.equal(body.error.code, "ZONE_NOT_FOUND");
    assert.equal(body.error.details.zone_id, ZONE_HEX);
  });

  test("a malformed id is a 422 and never a 404", async () => {
    const response = await route("GET", "/v1/zones/{id}").run(ctxFor(dbWith(), "/v1/zones/nope"), {
      params: { id: "nope" },
      body: undefined,
      reason: null,
    });
    assert.equal(response.status, 422);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "VALIDATION_ID_MALFORMED");
  });
});

describe("pausing a zone", () => {
  const pause = route("POST", "/v1/zones/{id}/pause");

  test("pauses an active, empty zone and records why", async () => {
    const db = dbWith({ live: 0 });
    const response = await pause.run(ctxFor(db, `/v1/zones/${ZONE_HEX}/pause`), {
      params: { id: ZONE_HEX },
      body: { reasonCode: "WEATHER_EMERGENCY", note: "waterlogging on Zindabazar road" },
      reason: null,
    });
    const body = (await response.json()) as { data: { changed: boolean } };
    assert.equal(response.status, 200);
    assert.equal(body.data.changed, true);
    const update = db.calls.find((call) => /UPDATE `zones` SET/u.test(call.sql));
    assert.deepEqual(update?.params.slice(0, 1), ["PAUSED"]);
    // The write only lands if the row is still ACTIVE — the guard is the fourth parameter.
    assert.equal(update?.params[3], "ACTIVE");
    assert.deepEqual(update?.params[2], ZONE_ID);
  });

  test("refuses to pause a zone that still has orders, and says how many", async () => {
    const db = dbWith({ live: 7 });
    const response = await pause.run(ctxFor(db, `/v1/zones/${ZONE_HEX}/pause`), {
      params: { id: ZONE_HEX },
      body: { reasonCode: "ZONE_UNSAFE" },
      reason: null,
    });
    const body = (await response.json()) as { error: { code: string; details: { active_orders: number } } };
    assert.equal(response.status, 409);
    assert.equal(body.error.code, "ZONE_HAS_ACTIVE_ORDERS");
    assert.equal(body.error.details.active_orders, 7);
  });

  test("refuses a reason the register does not accept for this action", async () => {
    for (const reasonCode of ["SOMETHING_CAME_UP", "CASH_COUNTED_SHORT", ""]) {
      const response = await pause.run(ctxFor(dbWith(), `/v1/zones/${ZONE_HEX}/pause`), {
        params: { id: ZONE_HEX },
        body: { reasonCode },
        reason: null,
      });
      assert.equal(response.status, 422, reasonCode);
      const body = (await response.json()) as { error: { details: { field: string } } };
      assert.equal(body.error.details.field, "reasonCode");
    }
  });

  test("a draft zone has nothing to pause", async () => {
    const response = await pause.run(ctxFor(dbWith({ row: zoneRow({ status: "DRAFT" }) }), `/v1/zones/${ZONE_HEX}/pause`), {
      params: { id: ZONE_HEX },
      body: { reasonCode: "ZONE_UNSAFE" },
      reason: null,
    });
    assert.equal(response.status, 409);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "ZONE_INACTIVE");
  });

  test("pausing an already paused zone succeeds and writes nothing", async () => {
    const db = dbWith({ row: zoneRow({ status: "PAUSED" }) });
    const response = await pause.run(ctxFor(db, `/v1/zones/${ZONE_HEX}/pause`), {
      params: { id: ZONE_HEX },
      body: { reasonCode: "ZONE_UNSAFE" },
      reason: null,
    });
    const body = (await response.json()) as { data: { changed: boolean } };
    assert.equal(response.status, 200);
    assert.equal(body.data.changed, false);
    assert.equal(db.calls.some((call) => /INSERT INTO `audit_log`/u.test(call.sql)), false);
  });

  test("a zone that moved under the write is a conflict, not a success", async () => {
    const response = await pause.run(ctxFor(dbWith({ updateAffects: 0 }), `/v1/zones/${ZONE_HEX}/pause`), {
      params: { id: ZONE_HEX },
      body: { reasonCode: "ZONE_UNSAFE" },
      reason: null,
    });
    assert.equal(response.status, 409);
  });
});

describe("reopening a zone", () => {
  const activate = route("POST", "/v1/zones/{id}/activate");

  test("reopens a paused zone and records the note", async () => {
    const db = dbWith({ row: zoneRow({ status: "PAUSED" }) });
    const response = await activate.run(ctxFor(db, `/v1/zones/${ZONE_HEX}/activate`), {
      params: { id: ZONE_HEX },
      body: { note: "roads cleared" },
      reason: null,
    });
    const body = (await response.json()) as { data: { changed: boolean } };
    assert.equal(response.status, 200);
    assert.equal(body.data.changed, true);
    const auditInsert = db.calls.find((call) => /INSERT INTO `audit_log`/u.test(call.sql));
    assert.equal(auditInsert?.params[15], "OPERATOR_REOPEN: roads cleared");
  });

  test("an active zone is already open, so nothing changes", async () => {
    const db = dbWith();
    const response = await activate.run(ctxFor(db, `/v1/zones/${ZONE_HEX}/activate`), {
      params: { id: ZONE_HEX },
      body: undefined,
      reason: null,
    });
    const body = (await response.json()) as { data: { changed: boolean } };
    assert.equal(body.data.changed, false);
    assert.equal(db.calls.some((call) => /INSERT INTO `audit_log`/u.test(call.sql)), false);
  });

  test("a retired zone stays retired", async () => {
    const response = await activate.run(ctxFor(dbWith({ row: zoneRow({ status: "RETIRED" }) }), `/v1/zones/${ZONE_HEX}/activate`), {
      params: { id: ZONE_HEX },
      body: undefined,
      reason: null,
    });
    assert.equal(response.status, 409);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "ZONE_INACTIVE");
  });
});
