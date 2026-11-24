/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import test from "node:test";
import { stubDb } from "../src/db/client.ts";
import { PLATFORM_ACCOUNTS } from "../src/domain/ledger/accounts.ts";
import { accountBalance, balanceOf, balancesFromDb } from "../src/domain/ledger/balance.ts";
import { byAccount, LedgerImbalanceError } from "../src/domain/ledger/closure.ts";
import { sqlLedgerCount, sqlLedgerInteger } from "../src/domain/ledger/exact.ts";
import { checkLedgerBalance, exceptionFromImbalance } from "../src/domain/ledger/imbalance.ts";
import { findEntry, recentEntries } from "../src/domain/ledger/repositories/entries.ts";
import { trialBalance, trialBalanceFromDb } from "../src/domain/ledger/trial-balance.ts";
import type { Account, Posting } from "../src/domain/ledger/types.ts";

const bank = PLATFORM_ACCOUNTS.BANK;
const expense = PLATFORM_ACCOUNTS.EXPENSE_PROMO;
const period = { fromIso: "2026-01-01 00:00:00", toIso: "2026-02-01 00:00:00" };
const posting = (amountPaisa: number, account: Account = bank): Posting => ({ account, amountPaisa });

test("SQL money/count parsing is exact, bounded and never turns invalid data into zero", () => {
  for (const [value, expected] of [["0", 0], ["-000.00", 0], ["901.000", 901], ["-9007199254740991", -Number.MAX_SAFE_INTEGER], [42, 42]] as const) {
    assert.equal(sqlLedgerInteger(value), expected);
  }
  for (const value of [null, undefined, "", " 1", "1e3", "+1", "2.1", "NaN", NaN, Infinity, 1.1,
    "9007199254740992", "-9007199254740992", Number.MAX_SAFE_INTEGER + 1, "9".repeat(97), {}, true]) {
    assert.throws(() => sqlLedgerInteger(value), RangeError);
  }
  assert.equal(sqlLedgerCount("123"), 123);
  assert.throws(() => sqlLedgerCount("-1"), RangeError);
});

test("account totals use exact accumulation and reject mixed accounts and out-of-range totals", () => {
  const m = Number.MAX_SAFE_INTEGER;
  const samples = [posting(m), posting(2), posting(-m), posting(-1)];
  assert.equal(accountBalance(samples).signedPaisa, 1);
  assert.equal(byAccount(samples).get(bank.code), 1);
  assert.throws(() => accountBalance([posting(m), posting(1)]), RangeError);
  assert.throws(() => byAccount([posting(m), posting(1)]), RangeError);
  assert.throws(() => accountBalance([posting(1), posting(-1, expense)]), /different accounts/u);
  assert.throws(() => byAccount([posting(0.1)]), RangeError);
});

test("trial totals never lose a paisa or report a false balance after overflow", () => {
  const m = Number.MAX_SAFE_INTEGER;
  const kinds = new Map([[bank.code, bank.kind], [expense.code, expense.kind]]);
  const report = trialBalance([posting(m), posting(2), posting(-m), posting(-1), posting(-1, expense)], kinds);
  assert.equal(report.debitTotalPaisa, 1);
  assert.equal(report.creditTotalPaisa, 1);
  assert.equal(report.differencePaisa, 0);
  assert.throws(() => trialBalance([posting(m), posting(1, expense)], kinds), RangeError);
  assert.throws(() => trialBalance([posting(1)], new Map()), /invalid ledger account kind/u);
});

test("database balance query uses real schema; historical sequence requests fail before SQL", async () => {
  const db = stubDb([{ match: /FROM `ledger_accounts` a/u, rows: [{ code: bank.code, kind: bank.kind, signed: "1.000", postings: "3" }] }]);
  const result = await balancesFromDb(db);
  assert.deepEqual(result, [{ code: bank.code, kind: "ASSET", signedPaisa: 1, naturalPaisa: 1, postings: 3 }]);
  assert.ok(!db.calls[0]?.sql.includes("`seq`"));
  assert.ok(db.calls[0]?.sql.includes("LEFT JOIN `ledger_postings`"));
  for (const asOfSequence of [0, 1, -1, NaN]) await assert.rejects(balancesFromDb(db, { asOfSequence }), /historical ledger sequence/u);
  assert.equal(db.calls.length, 1);
});

test("database balance distinguishes a missing account from an empty one", async () => {
  const absent = stubDb([{ match: /FROM `ledger_accounts` a/u, rows: [] }]);
  assert.equal(await balanceOf(absent, bank.code), null);
  const empty = stubDb([{ match: /FROM `ledger_accounts` a/u, rows: [{ kind: "ASSET", signed: "0", postings: "0" }] }]);
  assert.deepEqual(await balanceOf(empty, bank.code), { code: bank.code, kind: "ASSET", signedPaisa: 0, naturalPaisa: 0, postings: 0 });
  assert.match(empty.calls[0]!.sql, /LEFT JOIN `ledger_postings`/u);
  const wrong = stubDb([{ match: /FROM `ledger_accounts` a/u, rows: [{ kind: "REVENUE", signed: "0", postings: 0 }] }]);
  await assert.rejects(balanceOf(wrong, bank.code), /kind disagrees/u);
});

test("invalid SQL aggregates and counts fail closed rather than claiming a clean ledger", async () => {
  for (const value of [null, "not-money", "9007199254740992", "0.01", 1.5]) {
    const db = stubDb([{ match: /SUM\(p\.`amount_paisa`\)/u, rows: [{ code: bank.code, kind: bank.kind, total: value }] }]);
    await assert.rejects(checkLedgerBalance(db, period), RangeError);
  }
  for (const row of [{ signed: null, postings: "0" }, { signed: "0", postings: "-1" }, { signed: "0", postings: "9007199254740992" },
    { signed: "0", postings: "0", kind: "WRONG" }]) {
    const db = stubDb([{ match: /FROM `ledger_accounts` a/u, rows: [{ code: bank.code, kind: bank.kind, ...row }] }]);
    await assert.rejects(balancesFromDb(db), RangeError);
  }
  const big = stubDb([{ match: /SUM\(p\.`amount_paisa`\)/u, rows: [
    { code: bank.code, kind: bank.kind, total: "9007199254740991" }, { code: expense.code, kind: expense.kind, total: "1" },
  ] }]);
  await assert.rejects(trialBalanceFromDb(big, period), RangeError);
});

test("imbalance exception totals reject overflow rather than silently rounding", () => {
  const error = new LedgerImbalanceError("ADJUSTMENT", 1, [posting(Number.MAX_SAFE_INTEGER), posting(1), posting(-Number.MAX_SAFE_INTEGER)]);
  assert.throws(() => exceptionFromImbalance(error), RangeError);
  assert.equal(exceptionFromImbalance(new LedgerImbalanceError("ADJUSTMENT", 1, [posting(1)])).creditTotalPaisa, 0);
});

test("entry reads reference real columns with stable display order, never fabricated sequence", async () => {
  const db = stubDb([{ match: /FROM `ledger_entries`/u, rows: [] }]);
  assert.equal(await findEntry(db, new Uint8Array(16)), null);
  assert.deepEqual(await recentEntries(db, 1000), []);
  assert.equal(db.calls[1]?.params[0], 200);
  assert.match(db.calls[1]!.sql, /ORDER BY `created_at` DESC, `id` DESC/u);
  assert.ok(db.calls.every((call) => !call.sql.includes("`seq`")));
  for (const limit of [0, -1, 1.1, NaN, Infinity]) await assert.rejects(recentEntries(db, limit), RangeError);
  assert.equal(db.calls.length, 2);
});

test("balance and entry reads execute against a schema without a sequence column", async () => {
  // SQLite is only a local SQL/schema check, not a substitute for TiDB staging.
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("CREATE TABLE ledger_accounts (id BLOB PRIMARY KEY, code TEXT UNIQUE, kind TEXT); " +
      "CREATE TABLE ledger_entries (id BLOB PRIMARY KEY, entry_type TEXT, description TEXT, order_id BLOB, invoice_id BLOB, " +
      "settlement_id BLOB, reverses_id BLOB, occurred_at TEXT, created_at TEXT); " +
      "CREATE TABLE ledger_postings (id BLOB PRIMARY KEY, entry_id BLOB, account_id BLOB, amount_paisa INTEGER)");
    const a = new Uint8Array(16).fill(1); const b = new Uint8Array(16).fill(2); const e = new Uint8Array(16).fill(3);
    database.prepare("INSERT INTO ledger_accounts VALUES (?, ?, ?), (?, ?, ?)").run(a, bank.code, "ASSET", b, expense.code, "EXPENSE");
    database.prepare("INSERT INTO ledger_entries (id, entry_type, description, occurred_at, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(e, "ADJUSTMENT", "test", "2026-01-03 00:00:00", "2026-01-03 00:00:00");
    database.prepare("INSERT INTO ledger_postings VALUES (?, ?, ?, ?), (?, ?, ?, ?)")
      .run(new Uint8Array(16).fill(4), e, a, 500, new Uint8Array(16).fill(5), e, b, -500);
    const db: import("../src/db/client.ts").Db = {
      async query<T>(sql: string, params: readonly unknown[] = []) {
        return database.prepare(sql).all(...params as (string | number | bigint | Uint8Array | null)[]) as T[];
      },
      async first<T>(sql: string, params: readonly unknown[] = []) {
        return (database.prepare(sql).get(...params as (string | number | bigint | Uint8Array | null)[]) ?? null) as T | null;
      },
      async execute() { throw new Error("unexpected write"); },
      async batch() { throw new Error("unexpected batch"); },
    };
    assert.equal((await balancesFromDb(db)).find((item) => item.code === bank.code)?.signedPaisa, 500);
    assert.equal((await balanceOf(db, bank.code))?.postings, 1);
    assert.equal(await balanceOf(db, PLATFORM_ACCOUNTS.TAX_PAYABLE.code), null);
    assert.equal((await findEntry(db, e))?.entry_type, "ADJUSTMENT");
    assert.equal((await recentEntries(db, 10)).length, 1);
    assert.equal((await trialBalanceFromDb(db, period)).differencePaisa, 0);
  } finally { database.close(); }
});

test("reversal refuses imprecise database amounts before writing", async () => {
  const { reverseEntry } = await import("../src/domain/ledger/reverse.ts");
  const id = "0193f2a1-7c3e-7890-abcd-ef01234567bb";
  const db = stubDb([
    { match: /FROM `ledger_entries` WHERE `id`/u, rows: [{ id: new Uint8Array(16), entry_type: "ADJUSTMENT", description: "x", order_id: null, invoice_id: null, settlement_id: null }] },
    { match: /FROM `ledger_entries` WHERE `reverses_id`/u, rows: [] },
    { match: /FROM `ledger_postings`/u, rows: [{ code: bank.code, kind: "ASSET", owner_type: "PLATFORM", owner_id: null, amount_paisa: "9007199254740992" }] },
  ]);
  await assert.rejects(reverseEntry(db, { entryId: id, reason: "correct error" }), RangeError);
  assert.equal(db.calls.some((call) => call.sql.startsWith("INSERT")), false);
});

test("trial report rejects invalid or empty time ranges before querying", async () => {
  const db = stubDb([{ match: /SUM\(p\.`amount_paisa`\)/u, rows: [] }]);
  for (const input of [
    { fromIso: period.toIso, toIso: period.fromIso }, { fromIso: period.fromIso, toIso: period.fromIso },
    { fromIso: "2026-02-31 00:00:00", toIso: period.toIso }, { fromIso: "2026-01-01 24:00:00", toIso: period.toIso },
    { fromIso: "garbage", toIso: period.toIso }, { fromIso: "2026-01-01T00:00:00+06:00", toIso: period.toIso },
  ]) await assert.rejects(checkLedgerBalance(db, input), RangeError);
  assert.equal(db.calls.length, 0);
  await trialBalanceFromDb(db, { fromIso: "2026-01-01T00:00:00.000001Z", toIso: "2026-01-01T00:00:00.000002Z" });
  assert.deepEqual(db.calls[0]?.params, ["2026-01-01 00:00:00.000001", "2026-01-01 00:00:00.000002"]);
});
