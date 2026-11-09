/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { Db } from "../src/db/client.ts";
import { withTransaction, type Transactional } from "../src/db/transaction.ts";
import { PLATFORM_ACCOUNTS, riderCashAccount } from "../src/domain/ledger/accounts.ts";
import { assertClosed, LedgerImbalanceError, sumPaisa } from "../src/domain/ledger/closure.ts";
import { uuidBytes } from "../src/domain/ledger/repositories/accounts.ts";
import { postEntryInTransaction } from "../src/domain/ledger/transactional-post-entry.ts";
import type { PostEntryInput } from "../src/domain/ledger/post-entry.ts";
import type { Account } from "../src/domain/ledger/types.ts";

const rider = "0193f2a1-7c3e-7890-abcd-ef01234567bb";
const accounts: Account[] = [PLATFORM_ACCOUNTS.BANK, riderCashAccount(rider)];
const set = (): PostEntryInput => ({ entryType: "CASH_SETTLED", description: "settlement", nowMs: 1700000000000,
  postings: [{ account: accounts[1]!, amountPaisa: -500 }, { account: accounts[0]!, amountPaisa: 500 }] });

type Options = { missing?: boolean; mismatch?: string; entryAffected?: number; postingAffected?: number;
  aggregate?: { posting_count: unknown; total: unknown } | null; onRead?: () => void; throwPosting?: boolean };

/** Fake transaction for unit tests only; not proof of TiDB locking or rollback behavior. */
function harness(options: Options = {}) {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  let committedWrites = 0; let rollbacks = 0;
  const runner: Transactional = { async begin() {
    let stagedWrites = 0;
    const db: Db = {
      async query<T>() { return [] as T[]; },
      async first<T>(sql: string, params: readonly unknown[] = []) {
        calls.push({ sql, params });
        if (sql.includes("FROM `ledger_accounts`")) {
          options.onRead?.();
          const account = accounts.find((a) => a.code === params[0]);
          if (options.missing || !account) return null;
          const row: Record<string, unknown> = { id: new Uint8Array(16).fill(account.ownerId ? 2 : 1), code: account.code,
            kind: account.kind, owner_type: account.ownerType, owner_id: account.ownerId ? uuidBytes(account.ownerId) : null, currency: "BDT" };
          if (options.mismatch) row[options.mismatch] = options.mismatch === "owner_id" ? new Uint8Array(16) : "wrong";
          return row as T;
        }
        if (sql.includes("FROM `ledger_postings`")) {
          return (options.aggregate === undefined ? { posting_count: 2, total: "0" } : options.aggregate) as T | null;
        }
        throw new Error(`unexpected read: ${sql}`);
      },
      async execute(sql: string, params: readonly unknown[] = []) {
        calls.push({ sql, params }); stagedWrites++;
        if (sql.startsWith("INSERT INTO `ledger_entries`")) return { affectedRows: options.entryAffected ?? 1 };
        if (sql.startsWith("INSERT INTO `ledger_postings`")) {
          if (options.throwPosting) throw new Error("simulated posting error");
          return { affectedRows: options.postingAffected ?? 2 };
        }
        throw new Error(`unexpected write: ${sql}`);
      },
      async batch() { throw new Error("unexpected batch"); },
    };
    return { ...db, async commit() { committedWrites += stagedWrites; }, async rollback() { rollbacks++; } };
  } };
  return { runner, calls, counts: () => ({ committedWrites, rollbacks }) };
}

test("closure uses exact sums rather than accepting floating-point cancellation", () => {
  const m = Number.MAX_SAFE_INTEGER;
  const p = (n: number) => ({ account: PLATFORM_ACCOUNTS.BANK, amountPaisa: n });
  const falseZero = [m, 2, -m, -1].map(p);
  assert.equal(falseZero.reduce((sum, x) => sum + x.amountPaisa, 0), 0);
  assert.equal(sumPaisa(falseZero), 1);
  assert.throws(() => assertClosed("ADJUSTMENT", falseZero), LedgerImbalanceError);
  const trueZero = [m, 1, -m, -1].map(p);
  assert.equal(sumPaisa(trueZero), 0);
  assert.doesNotThrow(() => assertClosed("ADJUSTMENT", trueZero));
  assert.throws(() => sumPaisa([p(m), p(1)]), RangeError);
  assert.throws(() => sumPaisa([p(1.5)]), RangeError);
});

test("transactional posting locks accounts in order and verifies actual posting count and sum", async () => {
  const h = harness();
  const result = await withTransaction(h.runner, (tx) => postEntryInTransaction(tx, set()));
  assert.match(result.entryId, /^[0-9a-f]{32}$/u);
  assert.deepEqual(h.counts(), { committedWrites: 2, rollbacks: 0 });
  const reads = h.calls.filter((c) => c.sql.includes("FROM `ledger_accounts`"));
  assert.deepEqual(reads.map((c) => c.params[0]), accounts.map((a) => a.code).sort());
  assert.ok(reads.every((c) => c.sql.endsWith("FOR UPDATE")));
  assert.ok(h.calls.some((c) => c.sql.includes("COUNT(*) AS posting_count") && c.sql.includes("SUM(`amount_paisa`)")));
  assert.equal(h.calls.some((c) => c.sql.startsWith("DELETE")), false);
});

test("mismatched or missing accounts abort before an entry is written", async () => {
  for (const options of [{ missing: true }, ...["id", "code", "kind", "owner_type", "owner_id", "currency"].map((mismatch) => ({ mismatch }))]) {
    const h = harness(options);
    await assert.rejects(withTransaction(h.runner, (tx) => postEntryInTransaction(tx, set())), /missing or mismatched ledger account/u);
    assert.deepEqual(h.counts(), { committedWrites: 0, rollbacks: 1 });
    assert.equal(h.calls.some((c) => c.sql.startsWith("INSERT")), false);
  }
});

test("invalid posting sets, conflicting metadata and owner identities are rejected before SQL", async () => {
  const badInputs: PostEntryInput[] = [
    { ...set(), postings: [{ account: accounts[0]!, amountPaisa: 500 }, { account: accounts[0]!, amountPaisa: -400 }] },
    { ...set(), postings: [{ account: accounts[0]!, amountPaisa: 500 }, { account: { ...accounts[0]!, kind: "REVENUE" }, amountPaisa: -500 }] },
    { ...set(), postings: [{ account: { ...accounts[0]!, ownerId: rider }, amountPaisa: 500 }, { account: accounts[0]!, amountPaisa: -500 }] },
    { ...set(), postings: [{ account: { code: accounts[1]!.code, kind: accounts[1]!.kind, ownerType: accounts[1]!.ownerType }, amountPaisa: 500 }, { account: accounts[0]!, amountPaisa: -500 }] },
    { ...set(), postings: Array.from({ length: 102 }, (_, i) => ({ account: accounts[0]!, amountPaisa: i % 2 ? -1 : 1 })) },
  ];
  for (const input of badInputs) {
    const h = harness();
    await assert.rejects(withTransaction(h.runner, (tx) => postEntryInTransaction(tx, input)));
    assert.equal(h.calls.length, 0);
    assert.deepEqual(h.counts(), { committedWrites: 0, rollbacks: 1 });
  }
});

test("insert failures and suspicious or malformed aggregates abort the whole transaction", async () => {
  const options: Options[] = [
    { entryAffected: 0 }, { postingAffected: 1 }, { throwPosting: true }, { aggregate: null },
    ...[ { posting_count: 0, total: null }, { posting_count: 1, total: "0" }, { posting_count: 2, total: "1" },
      { posting_count: 2, total: null }, { posting_count: 2, total: "nope" }, { posting_count: 2, total: "0.01" },
      { posting_count: "2e0", total: "0" }, { posting_count: 2, total: NaN } ].map((aggregate) => ({ aggregate })),
  ];
  for (const option of options) {
    const h = harness(option);
    await assert.rejects(withTransaction(h.runner, (tx) => postEntryInTransaction(tx, set())));
    assert.deepEqual(h.counts(), { committedWrites: 0, rollbacks: 1 });
    assert.equal(h.calls.some((c) => c.sql.startsWith("DELETE")), false);
  }
});

test("input snapshot prevents mutation during awaited account reads", async () => {
  const input = set();
  const h = harness({ onRead: () => { (input.postings[0] as { amountPaisa: number }).amountPaisa = -999; } });
  await withTransaction(h.runner, (tx) => postEntryInTransaction(tx, input));
  const insert = h.calls.find((c) => c.sql.startsWith("INSERT INTO `ledger_postings`"));
  assert.equal(insert?.params[3], -500);
});

test("pinned TiDB driver carries ordered locks and verification through one simulated session", async () => {
  const { connect } = await import("@tidbcloud/serverless");
  const { transactionalFromConnection } = await import("../src/db/client.ts");
  const calls: string[] = []; let token = ""; let n = 0;
  const connection = connect({ url: "mysql://test:secret@db.test/undal", fetch: async (_url, init) => {
    const sql = (JSON.parse(init?.body ?? "{}") as { query: string }).query;
    assert.equal(init?.headers["TiDB-Session"] ?? "", token);
    calls.push(sql);
    let body: object = { types: [], rows: [], rowsAffected: sql.startsWith("INSERT INTO `ledger_postings`") ? 2 : sql.startsWith("INSERT") ? 1 : 0 };
    if (sql === "SELECT @@session.time_zone AS time_zone") body = { types: [{ name: "time_zone", type: "VARCHAR" }], rows: [["+00:00"]] };
    if (sql.includes("FROM `ledger_accounts`")) {
      const account = sql.includes("PLATFORM:BANK") ? accounts[0]! : accounts[1]!;
      body = { types: ["id", "code", "kind", "owner_type", "owner_id", "currency"].map((name) => ({ name, type: name === "id" || name === "owner_id" ? "BINARY" : "VARCHAR" })),
        rows: [["01".repeat(16), account.code, account.kind, account.ownerType, account.ownerId ? Buffer.from(uuidBytes(account.ownerId)).toString("hex") : null, "BDT"]] };
    }
    if (sql.includes("FROM `ledger_postings`")) body = { types: [{ name: "posting_count", type: "BIGINT" }, { name: "total", type: "DECIMAL" }], rows: [["2", "0"]] };
    token = `token-${++n}`;
    return new Response(JSON.stringify(body), { status: 200, headers: { "TiDB-Session": token } });
  } });
  await withTransaction(transactionalFromConnection(connection), (tx) => postEntryInTransaction(tx, set()));
  assert.equal(calls[0], "BEGIN"); assert.equal(calls.at(-1), "COMMIT");
  assert.equal(calls.filter((sql) => sql.endsWith("FOR UPDATE")).length, 2);
  assert.equal(calls.filter((sql) => sql.startsWith("INSERT INTO `ledger_postings`")).length, 1);
  assert.equal(calls.filter((sql) => sql.includes("SUM(`amount_paisa`)")).length, 1);
});
