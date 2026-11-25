/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";
import { AUDIT_ROUTES } from "../src/routes/audit.ts";
import type { Ctx, RouteDefinition } from "../src/middleware/context.ts";
import type { Principal } from "../src/rbac/guard.ts";

/**
 * The audit register, read back.
 *
 * The register is the one screen whose failure mode is silence: a filter that is accepted and then
 * ignored shows an operator forty innocent rows while the row they were looking for sits on page
 * three. So the filter tests assert on the statement that reached the database, not on the status
 * code — the params are the contract.
 */

const ADMIN_ID = "0193f2a1-7c3e-7890-abcd-ef0123456789";
const ACTOR_ID = new Uint8Array(16).fill(9);
const REQUEST_ID = new Uint8Array(16).fill(3);
const HASH_ONE = new Uint8Array(32).fill(0xab);
const HASH_ZERO = new Uint8Array(32).fill(0x11);

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
function readRoute(): RouteDefinition {
  const found = AUDIT_ROUTES.find((entry) => entry.method === "GET" && entry.path === "/v1/audit");
  assert.notEqual(found, undefined);
  return found as RouteDefinition;
}

/** An audit row as the repository selects it. */
function auditRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    seq: 41,
    occurred_at: "2026-11-24 09:15:02.482113",
    actor_id: ACTOR_ID,
    actor_type: "ADMIN",
    actor_role: "ADMIN",
    action: "vendor.pause",
    resource_type: "VENDOR",
    resource_id: "07070707070707070707070707070707",
    subject_id: null,
    before: { openState: "OPEN" },
    after: { openState: "PAUSED", pausedUntilMs: 1_800_000_000_000 },
    reason: "kitchen out of rice",
    severity: "WARNING",
    request_id: REQUEST_ID,
    prev_hash: HASH_ZERO,
    hash: HASH_ONE,
    ...overrides,
  };
}

/** A database that answers the register query. */
function dbWithRows(rows: readonly Record<string, unknown>[]) {
  return stubDb([{ match: /FROM `audit_log`/u, rows: [...rows] }]);
}

describe("the audit route table", () => {
  test("declares one read behind admin.audit.read and never a write scope", () => {
    assert.deepEqual(
      AUDIT_ROUTES.map((entry) => `${entry.method} ${entry.path} ${entry.permission} ${entry.group}`),
      ["GET /v1/audit admin.audit.read ADMIN_WRITE"],
    );
    assert.equal(readRoute().write, undefined);
  });
});

describe("the register", () => {
  test("returns newest first with the diff, the hashes and the actor", async () => {
    const db = dbWithRows([auditRow()]);
    const response = await readRoute().run(ctxFor(db, "/v1/audit"), { params: {}, body: undefined, reason: null });
    const body = (await response.json()) as {
      data: { entries: Array<Record<string, unknown>>; nextCursor: string | null; limit: number };
    };
    assert.equal(response.status, 200);
    const entry = body.data.entries[0] as Record<string, unknown>;
    assert.equal(entry["seq"], 41);
    assert.deepEqual(entry["before"], { openState: "OPEN" });
    assert.deepEqual(entry["after"], { openState: "PAUSED", pausedUntilMs: 1_800_000_000_000 });
    assert.deepEqual(entry["actor"], { id: "09090909090909090909090909090909", type: "ADMIN", role: "ADMIN" });
    assert.deepEqual(entry["resource"], { type: "VENDOR", id: "07070707070707070707070707070707", subjectId: null });
    assert.equal(entry["hash"], "ab".repeat(32));
    assert.equal(entry["prevHash"], "11".repeat(32));
    assert.equal(entry["requestId"], "03030303030303030303030303030303");
    assert.equal(body.data.nextCursor, null);
    assert.equal(body.data.limit, 50);
  });

  test("parses before and after that arrive as JSON text", async () => {
    const db = dbWithRows([auditRow({ before: '{"openState":"OPEN"}', after: '{"openState":"CLOSED"}' })]);
    const response = await readRoute().run(ctxFor(db, "/v1/audit"), { params: {}, body: undefined, reason: null });
    const body = (await response.json()) as { data: { entries: Array<{ before: unknown; after: unknown }> } };
    assert.deepEqual(body.data.entries[0]?.before, { openState: "OPEN" });
    assert.deepEqual(body.data.entries[0]?.after, { openState: "CLOSED" });
  });

  test("a row with no diff is still a row", async () => {
    const db = dbWithRows([auditRow({ before: null, after: null, actor_id: null, reason: null })]);
    const response = await readRoute().run(ctxFor(db, "/v1/audit"), { params: {}, body: undefined, reason: null });
    const body = (await response.json()) as { data: { entries: Array<Record<string, unknown>> } };
    assert.equal(response.status, 200);
    assert.equal(body.data.entries[0]?.["before"], null);
    assert.deepEqual(body.data.entries[0]?.["actor"], { id: null, type: "ADMIN", role: "ADMIN" });
  });

  test("every filter reaches the statement as a bound parameter", async () => {
    const db = dbWithRows([]);
    await readRoute().run(
      ctxFor(
        db,
        "/v1/audit?action=vendor.pause&resourceType=VENDOR&resourceId=07070707070707070707070707070707&actorType=admin&severity=warning&before=900&limit=10",
      ),
      { params: {}, body: undefined, reason: null },
    );
    const call = db.calls[0];
    assert.notEqual(call, undefined);
    // Five filters plus the cursor, then the page size: six bound values and nothing interpolated.
    assert.deepEqual(call?.params, [
      "vendor.pause",
      "VENDOR",
      "07070707070707070707070707070707",
      "ADMIN",
      "WARNING",
      900,
      10,
    ]);
    assert.match(call?.sql ?? "", /ORDER BY `seq` DESC LIMIT \?$/u);
    assert.match(call?.sql ?? "", /`seq` < \?/u);
  });

  test("a full page offers the sequence to continue from", async () => {
    const db = dbWithRows([auditRow({ seq: 900 }), auditRow({ seq: 899 })]);
    const response = await readRoute().run(ctxFor(db, "/v1/audit?limit=2"), { params: {}, body: undefined, reason: null });
    const body = (await response.json()) as { data: { nextCursor: string | null } };
    assert.equal(body.data.nextCursor, "899");
  });

  test("a short page offers nothing more", async () => {
    const db = dbWithRows([auditRow({ seq: 900 })]);
    const response = await readRoute().run(ctxFor(db, "/v1/audit?limit=2"), { params: {}, body: undefined, reason: null });
    const body = (await response.json()) as { data: { nextCursor: string | null } };
    assert.equal(body.data.nextCursor, null);
  });

  test("refuses an action that is not a lookup key", async () => {
    for (const action of ["Vendor.Pause", "vendor pause", "a", "vendor.pause; DROP TABLE audit_log"]) {
      const response = await readRoute().run(ctxFor(dbWithRows([]), `/v1/audit?action=${encodeURIComponent(action)}`), {
        params: {},
        body: undefined,
        reason: null,
      });
      assert.equal(response.status, 422, action);
      const body = (await response.json()) as { error: { details: { field: string } } };
      assert.equal(body.error.details.field, "action");
    }
  });

  test("refuses a resource id that is not an id, and a malformed severity", async () => {
    const badId = await readRoute().run(ctxFor(dbWithRows([]), "/v1/audit?resourceId=7"), {
      params: {},
      body: undefined,
      reason: null,
    });
    assert.equal(badId.status, 422);

    const badSeverity = await readRoute().run(ctxFor(dbWithRows([]), "/v1/audit?severity=LOUD"), {
      params: {},
      body: undefined,
      reason: null,
    });
    assert.equal(badSeverity.status, 422);
    const body = (await badSeverity.json()) as { error: { details: { field: string } } };
    assert.equal(body.error.details.field, "severity");
  });

  test("refuses a page size or a cursor outside the budget", async () => {
    for (const query of ["limit=0", "limit=201", "before=0", "before=2.5", "before=abc"]) {
      const response = await readRoute().run(ctxFor(dbWithRows([]), `/v1/audit?${query}`), {
        params: {},
        body: undefined,
        reason: null,
      });
      assert.equal(response.status, 422, query);
    }
  });

  test("asks the database nothing it does not need: one statement per request", async () => {
    const db = dbWithRows([auditRow()]);
    await readRoute().run(ctxFor(db, "/v1/audit"), { params: {}, body: undefined, reason: null });
    assert.equal(db.calls.length, 1);
  });
});
