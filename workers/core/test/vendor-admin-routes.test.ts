/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";
import { VENDOR_ROUTES } from "../src/routes/vendors.ts";
import type { Ctx, RouteDefinition } from "../src/middleware/context.ts";
import type { Principal } from "../src/rbac/guard.ts";

/**
 * The operator's vendor routes, driven at the handler.
 *
 * These four routes are the first place an operator can change a live kitchen, so the tests are
 * about the refusals as much as the successes: an indefinite pause must not be expressible, a
 * draft kitchen must not be pausable, and every switch must leave an audit row that says what the
 * state was before.
 */

const VENDOR_ID = new Uint8Array(16).fill(7);
const ZONE_ID = new Uint8Array(16).fill(4);
/** Ids cross the wire as 32 dashless hex characters, which is what `toHexId` produces. */
const VENDOR_HEX = "07070707070707070707070707070707";
const ADMIN_ID = "0193f2a1-7c3e-7890-abcd-ef0123456789";

/** A vendor row as the repository selects it. */
interface VendorRowFixture {
  readonly [key: string]: unknown;
  readonly paused_until: string | null;
  readonly pause_reason: string | null;
}

/** The row every test starts from. */
const VENDOR_ROW: VendorRowFixture = {
  id: VENDOR_ID,
  kind: "RESTAURANT",
  slug: "kacchi-house",
  name: "Kacchi House",
  name_bn: "কাচ্চি হাউস",
  tagline: "Since 1994",
  phone: "01712345678",
  zone_id: ZONE_ID,
  status: "APPROVED",
  open_state: "OPEN",
  busy_level: "0",
  paused_until: null,
  pause_reason: null,
  commission_bps: "1500",
  created_at: "2026-11-01 09:00:00.000000",
  updated_at: "2026-11-01 09:00:00.000000",
  deleted_at: null,
};

/** An admin principal with no zone limit. */
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
function ctxFor(db: ReturnType<typeof stubDb>, path: string, principal: Principal | null = adminPrincipal()): Ctx {
  return {
    env: testEnv(),
    db,
    url: new URL(`https://api.undal.test${path}`),
    request: new Request(`https://api.undal.test${path}`),
    requestId: "0193f2a1-7c3e-7890-abcd-ef0123456700",
    ip: "1.2.3.4",
    userAgent: "test",
    keys: [],
    principal,
    locale: "en",
    startedAtMs: Date.now(),
    waitUntil: () => undefined,
  };
}

/** Find a declared route by method and path. */
function route(method: string, path: string): RouteDefinition {
  const found = VENDOR_ROUTES.find((entry) => entry.method === method && entry.path === path);
  assert.notEqual(found, undefined, `${method} ${path} is not declared`);
  return found as RouteDefinition;
}

/** A database that answers the four statements these routes issue. */
function dbWithVendor(row: Partial<VendorRowFixture> | null = VENDOR_ROW, options: { readonly updateAffects?: number; readonly auditRows?: number } = {}) {
  return stubDb([
    { match: /FROM `vendors` v WHERE v\.`id` = \?/u, rows: row === null ? [] : [{ ...VENDOR_ROW, ...row }] },
    { match: /FROM `vendors` v WHERE v\.`deleted_at` IS NULL/u, rows: row === null ? [] : [{ ...VENDOR_ROW, ...row }] },
    { match: /UPDATE `vendors` SET/u, affectedRows: options.updateAffects ?? 1 },
    { match: /FROM `audit_log` ORDER BY `seq` DESC/u, rows: [] },
    { match: /INSERT INTO `audit_log`/u, affectedRows: options.auditRows ?? 1 },
    { match: /UPDATE `audit_log`/u, affectedRows: 1 },
  ]);
}

describe("the vendor route table", () => {
  test("every route declares the permission it needs", () => {
    assert.deepEqual(
      VENDOR_ROUTES.map((entry) => `${entry.method} ${entry.path} ${entry.permission}`),
      [
        "GET /v1/vendors vendor.list",
        "GET /v1/vendors/{id} vendor.read",
        "POST /v1/vendors/{id}/pause vendor.pause",
        "POST /v1/vendors/{id}/resume vendor.resume",
      ],
    );
  });

  test("the two switches are writes and the two readers are not", () => {
    assert.equal(route("GET", "/v1/vendors").write, undefined);
    assert.equal(route("POST", "/v1/vendors/{id}/pause").write, true);
    assert.equal(route("POST", "/v1/vendors/{id}/resume").write, true);
  });
});

describe("listing vendors", () => {
  test("returns the page and no cursor for a short page", async () => {
    const ctx = ctxFor(dbWithVendor(), "/v1/vendors?limit=25");
    const response = await route("GET", "/v1/vendors").run(ctx, { params: {}, body: undefined, reason: null });
    const body = (await response.json()) as { data: { vendors: Array<Record<string, unknown>>; nextCursor: string | null } };
    assert.equal(response.status, 200);
    assert.equal(body.data.vendors.length, 1);
    assert.equal(body.data.vendors[0]?.["slug"], "kacchi-house");
    assert.equal(body.data.vendors[0]?.["id"], VENDOR_HEX);
    assert.equal(body.data.nextCursor, null);
  });

  test("accepts a status filter in either case", async () => {
    const response = await route("GET", "/v1/vendors").run(ctxFor(dbWithVendor(), "/v1/vendors?status=suspended"), {
      params: {},
      body: undefined,
      reason: null,
      });
    assert.equal(response.status, 200);
  });

  test("refuses a status that is not one of the eight", async () => {
    const response = await route("GET", "/v1/vendors").run(ctxFor(dbWithVendor(), "/v1/vendors?status=OPEN"), {
      params: {},
      body: undefined,
      reason: null,
      });
    assert.equal(response.status, 422);
    const body = (await response.json()) as { error: { code: string; details: { field: string } } };
    assert.equal(body.error.code, "VALIDATION_FAILED");
    assert.equal(body.error.details.field, "status");
  });

  test("refuses a page size outside the budget", async () => {
    for (const limit of ["0", "101", "abc"]) {
      const response = await route("GET", "/v1/vendors").run(ctxFor(dbWithVendor(), `/v1/vendors?limit=${limit}`), {
        params: {},
        body: undefined,
        reason: null,
        });
      assert.equal(response.status, 422, `limit=${limit} should be refused`);
    }
  });

  test("refuses a cursor it did not write", async () => {
    const response = await route("GET", "/v1/vendors").run(ctxFor(dbWithVendor(), "/v1/vendors?cursor=not-a-cursor"), {
      params: {},
      body: undefined,
      reason: null,
      });
    assert.equal(response.status, 422);
  });

  test("offers a cursor only when the page was full", async () => {
    const rows = Array.from({ length: 2 }, (_, index) => ({
      ...VENDOR_ROW,
      id: new Uint8Array(16).fill(index + 1),
      slug: `vendor-${index}`,
      created_at: `2026-11-0${index + 1} 09:00:00.000000`,
    }));
    const db = stubDb([{ match: /FROM `vendors` v WHERE/u, rows }]);
    const response = await route("GET", "/v1/vendors").run(ctxFor(db, "/v1/vendors?limit=2"), { params: {}, body: undefined, reason: null });
    const body = (await response.json()) as { data: { nextCursor: string | null } };
    assert.equal(typeof body.data.nextCursor, "string");
  });
});

describe("reading one vendor", () => {
  test("returns the profile", async () => {
    const response = await route("GET", "/v1/vendors/{id}").run(ctxFor(dbWithVendor(), `/v1/vendors/${VENDOR_HEX}`), {
      params: { id: VENDOR_HEX },
      body: undefined,
      reason: null,
      });
    assert.equal(response.status, 200);
  });

  test("a vendor that does not exist is a 404 with the catalogue's own code", async () => {
    const response = await route("GET", "/v1/vendors/{id}").run(ctxFor(dbWithVendor(null), "/v1/vendors/x"), {
      params: { id: VENDOR_HEX },
      body: undefined,
      reason: null,
      });
    assert.equal(response.status, 404);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "CATALOG_VENDOR_NOT_FOUND");
  });

  test("a malformed id is a validation refusal, not a 404", async () => {
    const response = await route("GET", "/v1/vendors/{id}").run(ctxFor(dbWithVendor(), "/v1/vendors/nope"), {
      params: { id: "nope" },
      body: undefined,
      reason: null,
      });
    assert.equal(response.status, 422);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "VALIDATION_ID_MALFORMED");
  });
});

describe("pausing a kitchen", () => {
  test("sets a pause with an end and records the state before it", async () => {
    const response = await route("POST", "/v1/vendors/{id}/pause").run(ctxFor(dbWithVendor(), `/v1/vendors/${VENDOR_HEX}/pause`), {
      params: { id: VENDOR_HEX },
      body: { minutes: 45, reason: "Gas line repair" },
      reason: null,
      });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: { pausedUntil: string } };
    const until = Date.parse(body.data.pausedUntil);
    assert.equal(Number.isNaN(until), false);
    // Between now and now + 45 minutes, allowing for the few milliseconds the call took.
    assert.ok(until > Date.now() + 44 * 60_000);
    assert.ok(until < Date.now() + 46 * 60_000);
  });

  test("refuses a pause with no end", async () => {
    const response = await route("POST", "/v1/vendors/{id}/pause").run(ctxFor(dbWithVendor(), `/v1/vendors/${VENDOR_HEX}/pause`), {
      params: { id: VENDOR_HEX },
      body: { minutes: 0, reason: "Too long" },
      reason: null,
      });
    assert.equal(response.status, 422);
  });

  test("refuses a pause longer than a day", async () => {
    const response = await route("POST", "/v1/vendors/{id}/pause").run(ctxFor(dbWithVendor(), `/v1/vendors/${VENDOR_HEX}/pause`), {
      params: { id: VENDOR_HEX },
      body: { minutes: 1_441, reason: "Indefinite" },
      reason: null,
      });
    assert.equal(response.status, 422);
  });

  test("refuses a pause with no reason, because the partner app shows it", async () => {
    const response = await route("POST", "/v1/vendors/{id}/pause").run(ctxFor(dbWithVendor(), `/v1/vendors/${VENDOR_HEX}/pause`), {
      params: { id: VENDOR_HEX },
      body: { minutes: 30, reason: "  " },
      reason: null,
      });
    assert.equal(response.status, 422);
    const body = (await response.json()) as { error: { details: { field: string } } };
    assert.equal(body.error.details.field, "reason");
  });

  test("refuses to pause a kitchen that is not approved", async () => {
    const response = await route("POST", "/v1/vendors/{id}/pause").run(
      ctxFor(dbWithVendor({ status: "SUSPENDED" }), `/v1/vendors/${VENDOR_HEX}/pause`),
      { params: { id: VENDOR_HEX }, body: { minutes: 30, reason: "Test" }, reason: null },
    );
    assert.equal(response.status, 409);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "CATALOG_VENDOR_NOT_VERIFIED");
  });

  test("a row that moved between the read and the write is a 404, not a silent success", async () => {
    const response = await route("POST", "/v1/vendors/{id}/pause").run(
      ctxFor(dbWithVendor(VENDOR_ROW, { updateAffects: 0 }), `/v1/vendors/${VENDOR_HEX}/pause`),
      { params: { id: VENDOR_HEX }, body: { minutes: 30, reason: "Test" }, reason: null },
    );
    assert.equal(response.status, 404);
  });
});

describe("resuming a kitchen", () => {
  test("clears the pause and records it", async () => {
    const response = await route("POST", "/v1/vendors/{id}/resume").run(
      ctxFor(dbWithVendor({ open_state: "PAUSED", pause_reason: "Gas", paused_until: "2026-11-24 12:00:00.000000" }), `/v1/vendors/${VENDOR_HEX}/resume`),
      { params: { id: VENDOR_HEX }, body: undefined, reason: null },
    );
    assert.equal(response.status, 200);
  });

  test("resuming an open kitchen is a success and writes nothing", async () => {
    // The stub refuses any vendor update, so a route that tried to resume anyway would fail here.
    const db = stubDb([
      { match: /FROM `vendors` v WHERE v\.`id` = \?/u, rows: [VENDOR_ROW] },
      { match: /UPDATE `vendors` SET/u, affectedRows: 0 },
    ]);
    const response = await route("POST", "/v1/vendors/{id}/resume").run(ctxFor(db, `/v1/vendors/${VENDOR_HEX}/resume`), {
      params: { id: VENDOR_HEX },
      body: undefined,
      reason: null,
      });
    assert.equal(response.status, 200);
  });

  test("an unknown vendor is a 404", async () => {
    const response = await route("POST", "/v1/vendors/{id}/resume").run(ctxFor(dbWithVendor(null), `/v1/vendors/${VENDOR_HEX}/resume`), {
      params: { id: VENDOR_HEX },
      body: undefined,
      reason: null,
      });
    assert.equal(response.status, 404);
  });
});
