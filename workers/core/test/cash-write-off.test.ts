/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";
import { CASH_WRITE_OFF_ROUTES } from "../src/routes/cash-write-off.ts";
import { restoreWriteOffBalance, writeOffBalance } from "../src/repositories/cash.ts";
import type { Ctx } from "../src/middleware/context.ts";
import type { Principal } from "../src/rbac/guard.ts";

/**
 * Writing off money the platform was wrong to expect (D155).
 *
 * The route exists for the one decision `25 §7` had no answer for: a rider disputes a number, a reviewer agrees, and the
 * balance has to come down. What these tests defend is that the money moves through the ledger and nowhere else, that a
 * write-off cannot be larger than the balance it reduces and the declaration is scoped to the rider. The write-off is
 * not transactional and a guarded case close alone does not prevent duplicate concurrent financial adjustments.
 */

const ADMIN_HEX = "0193f2a17c3e7890abcdef0123456731";
const RIDER_HEX = "0193f2a17c3e7890abcdef0123456707";
const DECLARATION_HEX = "0193f2a17c3e7890abcdef01234567d1";
const ACCOUNT_HEX = "0193f2a17c3e7890abcdef0123456740";

const bytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
};

interface Options {
  readonly collected?: number;
  readonly outstanding?: number;
  readonly outstandingBefore?: number;
  readonly outstandingAfterFailedUpdate?: number;
  readonly declarationRider?: string;
  readonly shiftState?: string | null;
  /** The declaration a write-off names; `null` means no such row. */
  readonly declaration?: Record<string, unknown> | null;
  readonly resolved?: boolean;
  readonly ledgerTotal?: number;
  readonly balanceWritten?: boolean;
}

function dbFor(options: Options = {}): ReturnType<typeof stubDb> {
  const declaration = options.declaration === undefined ? { resolved_at: null } : options.declaration;
  const db = stubDb([
    { match: /SELECT `collected_paisa` FROM `rider_cash_balances`/u, rows: [{ collected_paisa: options.collected ?? 214_000 }] },
    { match: /FROM `rider_cash_declarations` WHERE `id`/u, rows: declaration === null ? [] : [declaration] },
    { match: /UPDATE `rider_cash_balances` SET `collected_paisa`/u, affectedRows: options.balanceWritten === false ? 0 : 1 },
    { match: /UPDATE `rider_cash_declarations` SET `resolved_at`/u, affectedRows: options.resolved === false ? 0 : 1 },
    { match: /outstanding_paisa` FROM `rider_cash_balances`/u, rows: [{ outstanding_paisa: options.outstanding ?? 0 }] },
    { match: /FROM `riders` WHERE `id` = \? LIMIT 1/u, rows: options.shiftState === null ? [] : [{ shift_state: options.shiftState ?? "CASH_LOCKED" }] },
    { match: /UPDATE `riders` SET `shift_state`/u, affectedRows: 1 },
    { match: /INSERT IGNORE INTO `ledger_accounts`/u, affectedRows: 1 },
    { match: /SELECT COUNT\(\*\) AS entries FROM `ledger_entries`/u, rows: [{ entries: 4 }] },
    { match: /INSERT INTO `ledger_entries`/u, affectedRows: 1 },
    { match: /FROM `ledger_accounts` WHERE `code`/u, rows: [{ id: bytes(ACCOUNT_HEX) }] },
    { match: /INSERT INTO `ledger_postings`/u, affectedRows: 2 },
    { match: /SUM\(`amount_paisa`\) AS total FROM `ledger_postings`/u, rows: [{ total: options.ledgerTotal ?? 0 }] },
    { match: /DELETE FROM `ledger_postings`/u, affectedRows: 2 },
    { match: /DELETE FROM `ledger_entries`/u, affectedRows: 1 },
    { match: /FROM `audit_log`/u, rows: [] },
    { match: /INSERT INTO `audit_log`/u, affectedRows: 1 },
  ]);
  let outstandingReads = 0;
  return {
    ...db,
    async first<T>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
      const row = await db.first<T>(sql, params);
      if (sql.includes("outstanding_paisa` FROM `rider_cash_balances`")) {
        outstandingReads += 1;
        const value = outstandingReads === 1
          ? options.outstandingBefore ?? options.collected ?? 214_000
          : options.balanceWritten === false ? options.outstandingAfterFailedUpdate ?? options.outstandingBefore ?? options.collected ?? 214_000 : options.outstanding ?? 0;
        return { outstanding_paisa: value } as T;
      }
      if (sql.includes("FROM `rider_cash_declarations` WHERE `id`")) {
        const requested = params[1];
        const owner = bytes(options.declarationRider ?? RIDER_HEX);
        if (!(requested instanceof Uint8Array) || Buffer.compare(requested, owner) !== 0) return null;
      }
      return row;
    },
  };
}

const PRINCIPAL = {
  userId: ADMIN_HEX,
  actorType: "ADMIN",
  role: "SUPER_ADMIN",
  zoneScope: null,
  sessionId: "0193f2a17c3e7890abcdef01234567ff",
  stepUpAtMs: Date.now(),
} as unknown as Principal;

function ctxFor(db: ReturnType<typeof stubDb>): Ctx {
  const path = `/v1/finance/cash/riders/${RIDER_HEX}/write-off`;
  return {
    env: testEnv({ ALLOW_UNSAFE_CASH_WRITES: "true" }),
    db,
    url: new URL(`https://api.undal.test${path}`),
    request: new Request(`https://api.undal.test${path}`, { method: "POST" }),
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
  const found = CASH_WRITE_OFF_ROUTES.find((candidate) => candidate.path === "/v1/finance/cash/riders/{id}/write-off");
  if (found === undefined) throw new Error("no write-off route");
  return found;
};

const BODY = { amountPaisa: 100_000, reason: "SYSTEM_RECONCILIATION", note: "the rider was right: two orders double-counted" };

async function run(
  db: ReturnType<typeof stubDb>,
  body: unknown = BODY,
  id: string = RIDER_HEX,
): Promise<{ status: number; body: Record<string, any> }> {
  const response = await route().run(ctxFor(db), { params: { id }, body, reason: null });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

const sqls = (db: ReturnType<typeof stubDb>): string[] => db.calls.map((call) => call.sql);

describe("POST /v1/finance/cash/riders/{id}/write-off (D155)", () => {
  test("the balance comes down in the ledger, and the rider is released when it reaches zero", async () => {
    const db = dbFor({ collected: 214_000, outstanding: 114_000 });
    const answer = await run(db);
    assert.equal(answer.status, 200);
    assert.equal(answer.body["data"]["outstandingPaisa"], 114_000);
    assert.equal(answer.body["data"]["released"], false, "a balance that still has money on it does not open the door");

    const balance = db.calls.find((call) => call.sql.includes("SET `collected_paisa` = `collected_paisa` - ?"));
    assert.deepEqual(balance?.params.slice(0, 3), [100_000, balance?.params[1], bytes(RIDER_HEX)]);

    const entry = db.calls.find((call) => call.sql.includes("INSERT INTO `ledger_entries`"));
    assert.equal(entry?.params[1], "CASH_WRITE_OFF");
    const postings = db.calls.find((call) => call.sql.includes("INSERT INTO `ledger_postings`"));
    assert.equal(postings?.params[3], -100_000, "RIDER_CASH falls by what the platform stopped expecting");
    assert.equal(postings?.params[8], 100_000, "and the expense rises by the same");

    const auditRow = db.calls.find((call) => call.sql.includes("INSERT INTO `audit_log`"));
    assert.equal(auditRow?.params[9], "finance.cash.write_off");
    assert.equal(auditRow?.params[15], "SYSTEM_RECONCILIATION");
    assert.equal(auditRow?.params[16], "CRITICAL", "a debt disappearing is the loudest thing this platform does quietly");
  });

  test("a write-off that clears the balance releases a locked rider", async () => {
    const db = dbFor({ collected: 114_000, outstanding: 0 });
    const answer = await run(db, { ...BODY, amountPaisa: 114_000 });
    assert.equal(answer.status, 200);
    assert.equal(answer.body["data"]["released"], true);
    const rider = db.calls.find((call) => call.sql.includes("UPDATE `riders` SET `shift_state`"));
    assert.deepEqual(rider?.params, ["OFFLINE", bytes(RIDER_HEX)]);
  });

  test("naming the case closes it, once", async () => {
    const db = dbFor({ declaration: { resolved_at: null } });
    const answer = await run(db, { ...BODY, declarationId: DECLARATION_HEX });
    assert.equal(answer.status, 200);
    assert.equal(answer.body["data"]["caseClosed"], true);

    const close = db.calls.find((call) => call.sql.includes("SET `resolved_at`"));
    assert.match(String(close?.sql), /`rider_id` = \? AND `resolved_at` IS NULL/u);
    assert.deepEqual(close?.params[4], bytes(RIDER_HEX));
    const lookup = db.calls.find((call) => call.sql.includes("FROM `rider_cash_declarations` WHERE `id`"));
    assert.match(String(lookup?.sql), /`id` = \? AND `rider_id` = \?/u);
    assert.deepEqual(lookup?.params, [bytes(DECLARATION_HEX), bytes(RIDER_HEX)]);
    assert.equal(close?.params[2], "the rider was right: two orders double-counted");
  });

  test("a case somebody already closed is a conflict, not a second adjustment", async () => {
    const db = dbFor({ declaration: { resolved_at: "2026-11-06 21:00:00.000000" } });
    const answer = await run(db, { ...BODY, declarationId: DECLARATION_HEX });
    assert.equal(answer.status, 409);
    assert.equal(answer.body["error"]["code"], "CASH_ALREADY_SETTLED");
    assert.equal(sqls(db).some((sql) => sql.includes("ledger")), false);
  });

  test("more than the rider's balance is refused rather than clamped", async () => {
    const db = dbFor({ collected: 50_000 });
    const answer = await run(db, { ...BODY, amountPaisa: 100_000 });
    assert.equal(answer.status, 422);
    assert.equal(answer.body["error"]["code"], "MONEY_REFUND_EXCEEDS_PAID");
    assert.deepEqual(answer.body["error"]["details"], { paid: 50_000, requested: 100_000 });
    assert.ok(!sqls(db).some((sql) => sql.startsWith("UPDATE") || sql.startsWith("INSERT")), "no statement moves money");
  });

  test("a case belonging to another rider is indistinguishable from a missing case", async () => {
    for (const options of [{ declarationRider: ADMIN_HEX }, { declaration: null }] as const) {
      const db = dbFor(options);
      const answer = await run(db, { ...BODY, declarationId: DECLARATION_HEX });
      assert.equal(answer.status, 404);
      assert.equal(answer.body["error"]["code"], "CASH_DECLARATION_NOT_FOUND");
      assert.ok(!sqls(db).some((sql) => sql.startsWith("UPDATE") || sql.startsWith("INSERT")));
    }
  });

  test("already-deposited cash cannot be written off even when collected is high", async () => {
    const db = dbFor({ collected: 214_000, outstandingBefore: 14_000 });
    const answer = await run(db, BODY);
    assert.equal(answer.status, 422);
    assert.deepEqual(answer.body["error"]["details"], { paid: 14_000, requested: 100_000 });
    assert.ok(!sqls(db).some((sql) => sql.startsWith("UPDATE") || sql.startsWith("INSERT")));
  });

  test("the conditional update guards the live balance when it changes after the initial read", async () => {
    const db = dbFor({ outstandingBefore: 214_000, balanceWritten: false, outstandingAfterFailedUpdate: 10_000 });
    const answer = await run(db, BODY);
    assert.equal(answer.status, 422);
    assert.deepEqual(answer.body["error"]["details"], { paid: 10_000, requested: 100_000 });
    const debit = db.calls.find((call) => call.sql.includes("SET `collected_paisa` = `collected_paisa` - ?"));
    assert.match(String(debit?.sql), /`collected_paisa` - `deposited_paisa` >= \?/u);
    assert.deepEqual(debit?.params.slice(2), [bytes(RIDER_HEX), 100_000]);
    assert.ok(!sqls(db).some((sql) => sql.includes("ledger")));
  });

  test("a failed guarded update with a still-sufficient reread is an internal error, not a ledger posting", async () => {
    const db = dbFor({ balanceWritten: false, outstandingAfterFailedUpdate: 214_000 });
    const answer = await run(db);
    assert.equal(answer.status, 500);
    assert.ok(!sqls(db).some((sql) => sql.includes("ledger")));
  });

  test("balance repository rejects zero, negative and fractional amounts before SQL", async () => {
    for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const db = dbFor();
      await assert.rejects(() => writeOffBalance(db, bytes(RIDER_HEX), amount, 0), RangeError);
      await assert.rejects(() => restoreWriteOffBalance(db, bytes(RIDER_HEX), amount, 0), RangeError);
      assert.equal(db.calls.length, 0);
    }
  });

  test("the body is judged before any row is read, and the reason comes from the register", async () => {
    const noReason = await run(dbFor(), { amountPaisa: 100_000 });
    assert.equal(noReason.status, 422);
    assert.deepEqual(noReason.body["error"]["details"]["fields"], ["reason"]);

    const outsider = await run(dbFor(), { amountPaisa: 100_000, reason: "BKASH_TRANSFER_CONFIRMED" });
    assert.equal(outsider.status, 422, "a payout's reason is not a write-off's reason");

    const zero = await run(dbFor(), { amountPaisa: 0, reason: "SYSTEM_RECONCILIATION" });
    assert.equal(zero.status, 422);
    assert.equal(zero.body["error"]["code"], "MONEY_AMOUNT_NEGATIVE");

    const fraction = await run(dbFor(), { amountPaisa: 12.5, reason: "SYSTEM_RECONCILIATION" });
    assert.equal(fraction.status, 422);

    const badId = await run(dbFor(), BODY, "not-a-uuid");
    assert.equal(badId.status, 422);
    assert.equal(badId.body["error"]["code"], "VALIDATION_ID_MALFORMED");
  });

  test("an entry that does not close puts the balance back", async () => {
    const db = dbFor({ ledgerTotal: 7 });
    const answer = await run(db);
    assert.equal(answer.status, 500);
    const debit = db.calls.find((call) => call.sql.includes("SET `collected_paisa` = `collected_paisa` - ?"));
    const restore = db.calls.find((call) => call.sql.includes("SET `collected_paisa` = `collected_paisa` + ?"));
    assert.equal(debit?.params[0], 100_000);
    assert.equal(restore?.params[0], 100_000);
  });
});
