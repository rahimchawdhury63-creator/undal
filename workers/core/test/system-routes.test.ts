/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";
import { SYSTEM_ROUTES } from "../src/routes/system.ts";
import type { Ctx, RouteDefinition } from "../src/middleware/context.ts";
import type { Principal } from "../src/rbac/guard.ts";

/**
 * The configuration register, read.
 *
 * The interesting behaviour is not the list; it is that a credential living in a settings table
 * comes back marked redacted rather than silently absent, and that the global default — an
 * all-zero zone id — is named as such instead of being rendered as a zone.
 */

const ADMIN_ID = "0193f2a1-7c3e-7890-abcd-ef0123456789";
const ZONE_ID = new Uint8Array(16).fill(6);
const GLOBAL = new Uint8Array(16);
const ZONE_HEX = "06060606060606060606060606060606";

/** An admin principal. */
function adminPrincipal(): Principal {
  return {
    userId: ADMIN_ID,
    actorType: "ADMIN",
    role: "SUPER_ADMIN",
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
function readRoute(): RouteDefinition {
  const found = SYSTEM_ROUTES.find((entry) => entry.method === "GET" && entry.path === "/v1/system/config");
  assert.notEqual(found, undefined);
  return found as RouteDefinition;
}

/** A configuration row. */
function configRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: "dispatch.propensity",
    zone_id: GLOBAL,
    value: { weights: { distance: 0.31, acceptance: 0.22 } },
    version: "r10.3.1",
    effective_at: "2026-11-01 00:00:00.000000",
    reason: "monthly retune",
    ...overrides,
  };
}

/** A database answering the register's two statements. */
function dbWith(rows: readonly Record<string, unknown>[], total = rows.length) {
  return stubDb([
    { match: /FROM `platform_config` `c` JOIN/u, rows: [...rows] },
    { match: /COUNT\(DISTINCT `key`\)/u, rows: [{ total }] },
  ]);
}

describe("the system route table", () => {
  test("declares one reader, behind the configuration key, and it is not a write", () => {
    assert.deepEqual(
      SYSTEM_ROUTES.map((entry) => `${entry.method} ${entry.path} ${entry.permission}`),
      ["GET /v1/system/config admin.config.edit"],
    );
    assert.equal(readRoute().write, undefined);
  });
});

describe("reading the configuration", () => {
  test("returns the current value with its version and the reason it changed", async () => {
    const db = dbWith([configRow()]);
    const response = await readRoute().run(ctxFor(db, "/v1/system/config"), { params: {}, body: undefined, reason: null });
    const body = (await response.json()) as { data: { entries: Array<Record<string, unknown>> } };
    assert.equal(response.status, 200);
    const entry = body.data.entries[0] as Record<string, unknown>;
    assert.equal(entry["key"], "dispatch.propensity");
    assert.equal(entry["scope"], "GLOBAL");
    assert.deepEqual(entry["value"], { weights: { distance: 0.31, acceptance: 0.22 } });
    assert.equal(entry["version"], "r10.3.1");
    assert.equal(entry["redacted"], false);
  });

  test("names a zone-scoped row as a zone", async () => {
    const db = dbWith([configRow({ zone_id: ZONE_ID })]);
    const response = await readRoute().run(ctxFor(db, "/v1/system/config"), { params: {}, body: undefined, reason: null });
    const body = (await response.json()) as { data: { entries: Array<Record<string, unknown>> } };
    const entry = body.data.entries[0] as Record<string, unknown>;
    assert.equal(entry["scope"], "ZONE");
    assert.equal(entry["zoneId"], ZONE_HEX);
  });

  test("redacts a credential by name and says it did", async () => {
    for (const key of ["auth.otp_pepper", "payments.bkash_api_key", "dispatch.qr_secret"]) {
      const db = dbWith([configRow({ key, value: "s3cr3t" })]);
      const response = await readRoute().run(ctxFor(db, "/v1/system/config"), { params: {}, body: undefined, reason: null });
      const body = (await response.json()) as { data: { entries: Array<Record<string, unknown>> } };
      const entry = body.data.entries[0] as Record<string, unknown>;
      assert.equal(entry["redacted"], true, key);
      assert.equal(entry["value"], null, key);
      // The row is still there: a vanished row would leave a reviewer wondering whether it exists.
      assert.equal(entry["key"], key);
    }
  });

  test("decodes a value that arrives as JSON text", async () => {
    const db = dbWith([configRow({ value: '{"weights":{"distance":0.5}}' })]);
    const response = await readRoute().run(ctxFor(db, "/v1/system/config"), { params: {}, body: undefined, reason: null });
    const body = (await response.json()) as { data: { entries: Array<{ value: unknown }> } };
    assert.deepEqual(body.data.entries[0]?.value, { weights: { distance: 0.5 } });
  });

  test("reports how many keys exist, not how many were returned", async () => {
    const db = dbWith([configRow()], 240);
    const response = await readRoute().run(ctxFor(db, "/v1/system/config?limit=1"), {
      params: {},
      body: undefined,
      reason: null,
    });
    const body = (await response.json()) as { data: { totalKeys: number; limit: number } };
    assert.equal(body.data.totalKeys, 240);
    assert.equal(body.data.limit, 1);
  });

  test("the filters reach the statement as bound parameters", async () => {
    const db = dbWith([]);
    await readRoute().run(ctxFor(db, `/v1/system/config?prefix=dispatch.&zoneId=${ZONE_HEX}&limit=25`), {
      params: {},
      body: undefined,
      reason: null,
    });
    assert.deepEqual(db.calls[0]?.params, ["dispatch.%", ZONE_ID, 25]);
  });

  test("refuses a prefix that is not a key, a zone id that is not an id, and a page size outside the budget", async () => {
    for (const query of ["prefix=Dispatch", "prefix=dispatch%", `zoneId=zzz`, "limit=0", "limit=201"]) {
      const response = await readRoute().run(ctxFor(dbWith([]), `/v1/system/config?${query}`), {
        params: {},
        body: undefined,
        reason: null,
      });
      assert.equal(response.status, 422, query);
    }
  });
});
