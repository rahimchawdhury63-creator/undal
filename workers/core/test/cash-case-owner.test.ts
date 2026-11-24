/* Licensed under PASVL-1.0. SPDX-License-Identifier: LicenseRef-PASVL-1.0 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { stubDb } from "../src/db/client.ts";
import { CASH_CASE_OWNER_ROUTES } from "../src/routes/cash-case-owner.ts";
import { testEnv } from "./support.ts";
import type { Ctx } from "../src/middleware/context.ts";

const CASE = "0193f2a17c3e7890abcdef01234567d1";
const RIDER = "0193f2a17c3e7890abcdef0123456707";
const ADMIN = "0193f2a17c3e7890abcdef0123456731";
const bytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (v) => parseInt(v, 16));

function dbFor(affected = 1, exists = true) {
  return stubDb([
    { match: /FROM `rider_cash_declarations` d JOIN `riders` r/u, rows: exists ? [{ id: bytes(CASE), rider_id: bytes(RIDER) }] : [] },
    { match: /UPDATE `rider_cash_declarations` SET `owner_id`/u, affectedRows: affected },
    { match: /SELECT `seq`, `hash` FROM `audit_log`/u, rows: [] },
    { match: /INSERT INTO `audit_log`/u, affectedRows: 1 },
  ]);
}
async function run(db: ReturnType<typeof dbFor>, action: "claim" | "release", id = CASE) {
  const url = `https://api.undal.test/v1/finance/cash/declarations/${id}/${action}`;
  const ctx = { env: testEnv(), db, url: new URL(url), request: new Request(url), requestId: CASE,
    ip: "1.2.3.4", userAgent: "test", keys: [], principal: { userId: ADMIN, actorType: "ADMIN", role: "FINANCE" },
    locale: "en", startedAtMs: 0, waitUntil: () => undefined } as unknown as Ctx;
  const route = CASH_CASE_OWNER_ROUTES.find((r) => r.path.endsWith(`/${action}`));
  assert.ok(route);
  const response = await route.run(ctx, { params: { id }, body: undefined, reason: null });
  return { status: response.status, body: await response.json() as any };
}

test("claim uses an atomic unowned/open/routed predicate and records the actor", async () => {
  const db = dbFor();
  const answer = await run(db, "claim");
  assert.equal(answer.status, 200);
  assert.equal(answer.body.data.ownerId, ADMIN);
  const update = db.calls.find((c) => c.sql.startsWith("UPDATE"));
  assert.ok(update);
  assert.match(update.sql, /`owner_id` IS NULL AND `resolved_at` IS NULL AND `routed_to_review` = 1/u);
  assert.deepEqual(update.params[0], bytes(ADMIN));
  assert.deepEqual(update.params[2], bytes(CASE));
  assert.ok(db.calls.some((c) => c.sql.startsWith("INSERT INTO `audit_log`")));
});

test("release uses a conditional owner check and does not change money", async () => {
  const db = dbFor();
  const answer = await run(db, "release");
  assert.equal(answer.status, 200);
  assert.equal(answer.body.data.ownerId, null);
  const update = db.calls.find((c) => c.sql.startsWith("UPDATE"));
  assert.ok(update);
  assert.match(update.sql, /`owner_id` = \? AND `resolved_at` IS NULL/u);
  assert.deepEqual(update.params, [bytes(CASE), bytes(ADMIN)]);
  assert.equal(db.calls.filter((c) => c.sql.startsWith("UPDATE")).length, 1);
});

test("a lost claim or a release by a non-owner returns conflict without an audit", async () => {
  for (const action of ["claim", "release"] as const) {
    const db = dbFor(0);
    const answer = await run(db, action);
    assert.equal(answer.status, 409);
    assert.equal(answer.body.error.code, "CASH_CASE_UNAVAILABLE");
    assert.ok(!db.calls.some((c) => c.sql.includes("audit_log")));
  }
});

test("missing and malformed cases do not mutate", async () => {
  const missing = dbFor(1, false);
  assert.equal((await run(missing, "claim")).status, 404);
  assert.ok(!missing.calls.some((c) => c.sql.startsWith("UPDATE")));
  const malformed = dbFor();
  assert.equal((await run(malformed, "claim", "bad")).status, 422);
  assert.equal(malformed.calls.length, 0);
});

test("case actions bind retry hashes to the case without changing existing routes", async () => {
  const { idempotencyInput } = await import("../src/app.ts");
  const { bodyHashOf } = await import("../src/middleware/idempotency.ts");
  const path = "/v1/finance/cash/declarations/{id}/claim";
  const one = await bodyHashOf(idempotencyInput(path, undefined, { id: CASE }));
  const two = await bodyHashOf(idempotencyInput(path, undefined, { id: ADMIN }));
  assert.notEqual(one, two);
  assert.equal(await bodyHashOf(idempotencyInput("/v1/other/{id}", undefined, { id: CASE })), await bodyHashOf(undefined));
});
