/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";
import { CASH_DECLARATION_ROUTES } from "../src/routes/cash-declaration.ts";
import type { Ctx } from "../src/middleware/context.ts";
import type { Principal } from "../src/rbac/guard.ts";

/**
 * One cash case, read back (D156).
 *
 * The list (D154) is a queue and the write-off (D155) is a receipt; neither is the record. These tests defend the record:
 * that a dispute arrives with the arithmetic it disputed *and* the balance now, that a closed case says who closed it and
 * in what words, and that an id naming nothing is a `404` rather than an empty `200` — because an empty record and a
 * missing one are the same thing to a reviewer only if nobody looks.
 */

const ADMIN_HEX = "0193f2a17c3e7890abcdef0123456731";
const RIDER_HEX = "0193f2a17c3e7890abcdef0123456707";
const CASE_HEX = "0193f2a17c3e7890abcdef01234567d1";

const bytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
};

const CASE_SQL = /FROM `rider_cash_declarations` d JOIN `riders` r ON/u;

function dbFor(rows: readonly Record<string, unknown>[]): ReturnType<typeof stubDb> {
  return stubDb([{ match: CASE_SQL, rows: [...rows] }]);
}

const PRINCIPAL = {
  userId: ADMIN_HEX,
  actorType: "ADMIN",
  role: "FINANCE",
  zoneScope: null,
  sessionId: "0193f2a17c3e7890abcdef01234567ff",
  stepUpAtMs: Date.now(),
} as unknown as Principal;

function ctxFor(db: ReturnType<typeof stubDb>, path: string): Ctx {
  const url = `https://api.undal.test${path}`;
  return {
    env: testEnv(),
    db,
    url: new URL(url),
    request: new Request(url),
    requestId: "0193f2a1-7c3e-7890-abcd-ef0123456700",
    ip: "1.2.3.4",
    userAgent: "test",
    keys: [],
    principal: PRINCIPAL,
    locale: "en",
    startedAtMs: 0,
    waitUntil: () => undefined,
  } as Ctx;
}

const route = () => {
  const found = CASH_DECLARATION_ROUTES.find((candidate) => candidate.path === "/v1/finance/cash/declarations/{id}");
  if (found === undefined) throw new Error("no case route");
  return found;
};

const run = async (
  db: ReturnType<typeof stubDb>,
  id = CASE_HEX,
): Promise<{ status: number; body: Record<string, any>; sql: string; params: readonly unknown[] }> => {
  const ctx = ctxFor(db, `/v1/finance/cash/declarations/${id}`);
  const response = await route().run(ctx, { params: { id }, body: null, reason: null });
  const parsed = (await response.json()) as { data?: Record<string, any>; error?: Record<string, any> };
  const call = db.calls[db.calls.length - 1];
  return {
    status: response.status,
    body: parsed.data ?? { error: parsed.error },
    sql: String(call?.sql ?? ""),
    params: call?.params ?? [],
  };
};

const AT = "2026-11-06 21:40:00.000000";

function caseRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: bytes(CASE_HEX),
    rider_id: bytes(RIDER_HEX),
    full_name: "Karim Rahman",
    code: "RDR-4K2M",
    phone: "+8801712345678",
    kind: "DISPUTE",
    note: "I only collected eight thousand",
    lifted_until: null,
    routed_to_review: 1,
    snapshot_lines_paisa: 84_000,
    snapshot_difference_paisa: 130_000,
    created_at: AT,
    resolved_at: null,
    resolution_note: null,
    resolved_by_name: null,
    outstanding_paisa: 214_000,
    ...overrides,
  };
}

describe("one cash case, read back (D156)", () => {
  test("a dispute arrives whole: the rider, both figures, and the lift it granted", async () => {
    const answer = await run(dbFor([caseRow({ owner_id: bytes(ADMIN_HEX), claimed_at: AT })]));
    assert.equal(answer.status, 200);

    const data = answer.body;
    assert.equal(data.case.id, CASE_HEX);
    assert.equal(data.case.kind, "DISPUTE");
    assert.equal(data.case.note, "I only collected eight thousand");
    assert.equal(data.case.ownerId, ADMIN_HEX);
    assert.equal(data.case.claimedAt, AT);
    assert.equal(data.case.open, true, "nobody has finished with it");
    assert.equal(data.case.snapshot.differencePaisa, 130_000, "what the platform claimed when they objected");
    assert.equal(data.case.snapshot.linesPaisa, 84_000);
    assert.equal(data.resolution, null);
    assert.equal(data.rider.name, "Karim Rahman");
    assert.equal(data.rider.phone, "+8801712345678", "§7 promises somebody rings them back");
    assert.equal(data.rider.outstandingPaisa, 214_000, "and what it claims now");

    assert.match(answer.sql, /WHERE d\.`id` = \? LIMIT 1/u, "one case, by id");
    assert.match(answer.sql, /LEFT JOIN `user_profiles` p/u, "the decider's name, not their id");
    assert.deepEqual(answer.params.slice(0, 1), [bytes(CASE_HEX)]);
  });

  test("a closed case says who closed it, when, and in what words", async () => {
    const answer = await run(
      dbFor([
        caseRow({
          kind: "ROBBED",
          lifted_until: null,
          snapshot_lines_paisa: null,
          snapshot_difference_paisa: null,
          resolved_at: "2026-11-07 09:05:00.000000",
          resolution_note: "Report filed; written off in full",
          resolved_by_name: "Nusrat Jahan",
          outstanding_paisa: 0,
        }),
      ]),
    );
    assert.equal(answer.status, 200);

    const data = answer.body;
    assert.equal(data.case.open, false, "`resolved_at`, not the balance, is what closes a case");
    assert.equal(data.case.snapshot, null, "a robbery was never about a number");
    assert.equal(data.resolution.resolvedAt, "2026-11-07 09:05:00.000000");
    assert.equal(data.resolution.resolvedByName, "Nusrat Jahan");
    assert.equal(data.resolution.note, "Report filed; written off in full");
  });

  test("an id that names nothing is a 404, and one that is not an id never reaches the database", async () => {
    const missing = await run(dbFor([]));
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "CASH_DECLARATION_NOT_FOUND");
    assert.equal(missing.body.error.details.declaration_id, CASE_HEX);

    const empty = dbFor([]);
    const malformed = await run(empty, "not-a-uuid");
    assert.equal(malformed.status, 422);
    assert.equal(malformed.body.error.code, "VALIDATION_ID_MALFORMED");
    assert.equal(empty.calls.length, 0, "a malformed id is judged before any row is read");
  });
});
