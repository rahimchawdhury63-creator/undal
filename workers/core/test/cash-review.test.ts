/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";
import { CASH_REVIEW_ROUTES } from "../src/routes/cash-review.ts";
import type { Ctx } from "../src/middleware/context.ts";
import type { Principal } from "../src/rbac/guard.ts";

/**
 * The reviewer's decision on a cash settlement (D143).
 *
 * `25 §6` describes a human looking at a bKash screenshot and confirming that the money arrived. Until this route existed
 * there was nobody to do it, so these tests defend the three things a reviewer's decision has to be: it moves money in
 * the books and nowhere else, it happens once, and it leaves the rider unblocked only when the debt is actually gone.
 */

const ADMIN_HEX = "0193f2a17c3e7890abcdef0123456731";
const RIDER_HEX = "0193f2a17c3e7890abcdef0123456707";
const SETTLEMENT_HEX = "0193f2a17c3e7890abcdef01234567f0";
const ACCOUNT_HEX = "0193f2a17c3e7890abcdef0123456740";

const bytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
};

const PATH = "/v1/finance/cash/settlements/{id}/approve";

const PRINCIPAL: Principal = {
  userId: ADMIN_HEX,
  actorType: "ADMIN",
  role: "FINANCE",
  zoneScope: null,
  sessionId: "0193f2a17c3e7890abcdef01234567ff",
  stepUpAtMs: Date.now(),
} as unknown as Principal;

function settlementRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: bytes(SETTLEMENT_HEX),
    rider_id: bytes(RIDER_HEX),
    amount_paisa: 214_000,
    method: "BKASH",
    trx_id: "9H5K2M8P1Q",
    status: "PENDING",
    created_at: "2026-11-06 20:41:00.000000",
    confirmed_at: null,
    ...overrides,
  };
}

interface Options {
  /** The row the approval is about; `null` means no such settlement. */
  readonly settlement?: Record<string, unknown> | null;
  /** What the claim-after-approval query finds, for the lost-race case. */
  readonly afterRace?: Record<string, unknown> | null;
  /** Whether the status transition reports that it took the claim. */
  readonly claimed?: boolean;
  /** Whether the rider has a balance row to credit. */
  readonly credited?: boolean;
  /** The outstanding balance the rider is left with, after the deposit. */
  readonly remaining?: number;
  /** The rider's state before the approval. */
  readonly shiftState?: string | null;
  /** The sum the database reports for the entry that was just written. */
  readonly ledgerTotal?: number;
  readonly auditTail?: unknown[];
}

function dbFor(options: Options = {}): ReturnType<typeof stubDb> {
  const settlement = options.settlement === undefined ? settlementRow() : options.settlement;
  return stubDb([
    { match: /FROM `rider_cash_settlements` WHERE `id`/u, rows: settlement === null ? [] : [settlement] },
    { match: /UPDATE `rider_cash_settlements` SET `status` = 'CONFIRMED'/u, affectedRows: options.claimed === false ? 0 : 1 },
    { match: /UPDATE `rider_cash_settlements` SET `status` = 'PENDING'/u, affectedRows: 1 },
    { match: /UPDATE `rider_cash_balances`/u, affectedRows: options.credited === false ? 0 : 1 },
    { match: /outstanding_paisa` FROM `rider_cash_balances`/u, rows: [{ outstanding_paisa: options.remaining ?? 0 }] },
    { match: /FROM `riders` WHERE `id` = \? LIMIT 1/u, rows: options.shiftState === null ? [] : [{ shift_state: options.shiftState ?? "CASH_LOCKED" }] },
    { match: /UPDATE `riders` SET `shift_state`/u, affectedRows: 1 },
    { match: /INSERT IGNORE INTO `ledger_accounts`/u, affectedRows: 1 },
    { match: /SELECT COUNT\(\*\) AS entries FROM `ledger_entries`/u, rows: [{ entries: 12 }] },
    { match: /INSERT INTO `ledger_entries`/u, affectedRows: 1 },
    { match: /FROM `ledger_accounts` WHERE `code`/u, rows: [{ id: bytes(ACCOUNT_HEX) }] },
    { match: /INSERT INTO `ledger_postings`/u, affectedRows: 2 },
    { match: /SUM\(`amount_paisa`\) AS total FROM `ledger_postings`/u, rows: [{ total: options.ledgerTotal ?? 0 }] },
    { match: /DELETE FROM `ledger_postings`/u, affectedRows: 2 },
    { match: /DELETE FROM `ledger_entries`/u, affectedRows: 1 },
    { match: /FROM `audit_log`/u, rows: options.auditTail ?? [] },
    { match: /INSERT INTO `audit_log`/u, affectedRows: 1 },
  ]);
}

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
    principal: PRINCIPAL,
    locale: "en",
    startedAtMs: 0,
    waitUntil: () => undefined,
  } as Ctx;
}

const route = (): (typeof CASH_REVIEW_ROUTES)[number] => {
  const found = CASH_REVIEW_ROUTES.find((candidate) => candidate.path === PATH);
  if (found === undefined) throw new Error(`no route ${PATH}`);
  return found;
};

async function run(db: ReturnType<typeof stubDb>, body: unknown = null): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await route().run(ctxFor(db, "/v1/finance/cash/settlements/x/approve"), {
    params: { id: SETTLEMENT_HEX },
    body,
    reason: null,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** Every statement the route sent, for the assertions about what it did and did not write. */
const sqls = (db: ReturnType<typeof stubDb>): string[] => db.calls.map((call) => call.sql);

describe("approving a settlement (D143)", () => {
  test("the money moves in the ledger, once, and the rider is released", async () => {
    const db = dbFor();
    const answer = await run(db);
    assert.equal(answer.status, 200);
    const data = answer.body["data"] as Record<string, unknown>;
    assert.equal(data["released"], true);
    assert.equal(data["outstandingPaisa"], 0);

    const postings = db.calls.find((call) => call.sql.includes("INSERT INTO `ledger_postings`"));
    assert.ok(postings !== undefined, "the approval must post to the ledger");
    assert.equal(postings.params[3], -214_000, "RIDER_CASH falls by the amount handed over");
    assert.equal(postings.params[8], 214_000, "PLATFORM:BANK rises by the same");

    const entry = db.calls.find((call) => call.sql.includes("INSERT INTO `ledger_entries`"));
    assert.ok(entry !== undefined);
    assert.deepEqual(entry.params[1], "CASH_SETTLED");
    assert.deepEqual(entry.params[4], bytes(SETTLEMENT_HEX), "the entry names the settlement it settles");

    const rider = db.calls.find((call) => call.sql.includes("UPDATE `riders` SET `shift_state`"));
    assert.deepEqual(rider?.params, ["OFFLINE", bytes(RIDER_HEX)]);
  });

  test("the audit row is the decision: who, what, and the entry it wrote", async () => {
    const db = dbFor();
    await run(db);
    const auditRow = db.calls.find((call) => call.sql.includes("INSERT INTO `audit_log`"));
    assert.ok(auditRow !== undefined);
    const after = JSON.parse(String(auditRow.params[14])) as Record<string, unknown>;
    assert.equal(after["status"], "CONFIRMED");
    assert.equal(after["outstandingPaisa"], 0);
    assert.equal(typeof after["ledgerEntryId"], "string");
    assert.equal(auditRow.params[9], "finance.cash.approve_settlement");
  });

  test("a debt that is not fully cleared does not release the rider", async () => {
    const db = dbFor({ remaining: 40_000 });
    const answer = await run(db);
    assert.equal(answer.status, 200);
    assert.equal((answer.body["data"] as Record<string, unknown>)["released"], false);
    assert.equal(
      sqls(db).some((sql) => sql.includes("UPDATE `riders` SET `shift_state`")),
      false,
      "an approval that leaves cash outstanding must not open the door",
    );
  });

  test("a claim somebody already decided is a conflict, not a second posting", async () => {
    const db = dbFor({
      settlement: settlementRow({ status: "CONFIRMED", confirmed_at: "2026-11-06 21:02:00.000000" }),
    });
    const answer = await run(db);
    assert.equal(answer.status, 409);
    assert.equal((answer.body["error"] as Record<string, unknown>)["code"], "CASH_ALREADY_SETTLED");
    assert.equal(
      sqls(db).some((sql) => sql.includes("INSERT INTO `ledger_postings`")),
      false,
      "nothing is posted for a decision that was already taken",
    );
  });

  test("losing the race between the read and the write is the same conflict", async () => {
    const db = dbFor({ claimed: false, afterRace: settlementRow({ status: "CONFIRMED" }) });
    const answer = await run(db);
    assert.equal(answer.status, 409);
    assert.equal((answer.body["error"] as Record<string, unknown>)["code"], "CASH_ALREADY_SETTLED");
    assert.equal(sqls(db).some((sql) => sql.includes("INSERT INTO `ledger_entries`")), false);
  });

  test("an entry that does not close unwinds the deposit and leaves the claim pending", async () => {
    const db = dbFor({ ledgerTotal: 5 });
    const answer = await run(db);
    assert.equal(answer.status, 500);
    assert.equal((answer.body["error"] as Record<string, unknown>)["code"], "INTERNAL");

    const credits = db.calls.filter((call) => call.sql.includes("UPDATE `rider_cash_balances`"));
    assert.equal(credits.length, 2, "the deposit is credited, then given back");
    assert.equal(credits[1]?.params[0], -214_000);
    assert.equal(
      sqls(db).some((sql) => sql.includes("UPDATE `rider_cash_settlements` SET `status` = 'PENDING'")),
      true,
      "the claim is handed back so a reviewer can retry",
    );
    assert.equal(sqls(db).some((sql) => sql.includes("UPDATE `riders` SET `shift_state`")), false);
  });

  test("the reasons a reviewer may cite are the register's, and a clean approval cites none", async () => {
    const clean = await run(dbFor());
    assert.equal(clean.status, 200);

    const flagged = dbFor();
    const flaggedAnswer = await run(flagged, { reason: "CASH_COUNTED_SHORT", note: "counted 2140, claimed 2140" });
    assert.equal(flaggedAnswer.status, 200);
    const auditRow = flagged.calls.find((call) => call.sql.includes("INSERT INTO `audit_log`"));
    assert.equal(auditRow?.params[15], "CASH_COUNTED_SHORT");
    assert.equal(auditRow?.params[16], "NOTICE");

    const invented = await run(dbFor(), { reason: "BKASH_TRANSFER_CONFIRMED" });
    assert.equal(invented.status, 422, "a payout's reason is not a settlement's reason");
    assert.equal((invented.body["error"] as Record<string, unknown>)["code"], "VALIDATION_REQUIRED");
  });

  test("a malformed id and a missing settlement are refused before anything is written", async () => {
    const db = dbFor();
    const response = await route().run(ctxFor(db, "/v1/finance/cash/settlements/x/approve"), {
      params: { id: "not-a-uuid" },
      body: null,
      reason: null,
    });
    assert.equal(response.status, 422);
    assert.equal(db.calls.length, 0, "the id is judged before a query is spent");

    const missing = await run(dbFor({ settlement: null }));
    assert.equal(missing.status, 404);
    assert.equal((missing.body["error"] as Record<string, unknown>)["code"], "MONEY_PAYOUT_NOT_FOUND");
  });
});
