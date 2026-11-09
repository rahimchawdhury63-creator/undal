/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { Db } from "../src/db/client.ts";
import { TransactionCommitUnknownError, TransactionRollbackUnknownError, type Transactional } from "../src/db/transaction.ts";
import { canonicalCashJson, prepareCashOperation, cashOperationUuid } from "../src/domain/rider/cash-operation-identity.ts";
import { lookupCashOperation, runCashOperation } from "../src/domain/rider/cash-operation.ts";

const actor = "018c0000-0000-7000-8000-000000000001";
const target = "018c0000-0000-7000-8000-000000000002";
const ledger = "018c0000-0000-7000-8000-000000000003";
const fixedNow = () => 1_700_000_000_000;
const identity = (options: Partial<Parameters<typeof prepareCashOperation>[0]> = {}) => prepareCashOperation({
  actorId: actor, action: "SETTLEMENT_APPROVAL", targetId: target, idempotencyKey: "request-1", payload: { amount: 123, currency: "BDT" }, ...options,
});
const ok = () => Promise.resolve({ ledgerEntryId: ledger, response: { amount: 123, status: "settled" } });
const bytes = (value: unknown) => Buffer.from(value as Uint8Array).toString("hex");
const scope = (params: readonly unknown[]) => `${bytes(params[0])}:${params[1]}:${bytes(params[2])}`;

/** An intentionally simplified transactional fake: it is not a TiDB concurrency test. */
function fakeStore() {
  const rows = new Map<string, Record<string, unknown>>();
  const tails = new Map<string, Promise<void>>();
  let lookups = 0;
  let commits = 0;
  let rollbacks = 0;
  let businessWrites = 0;
  let commitMode: "normal" | "applied-error" | "not-applied-error" = "normal";
  let failRollback = false;
  const lock = async (key: string) => {
    const previous = tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => held);
    tails.set(key, tail);
    await previous;
    return () => { release(); if (tails.get(key) === tail) tails.delete(key); };
  };
  const readDb: Db = {
    async first<T>(_sql: string, params: readonly unknown[] = []) {
      lookups++;
      return (rows.get(scope(params)) ?? null) as T | null;
    },
    async execute() { throw new Error("unexpected read-db write"); },
    async query<T>() { return [] as T[]; },
    async batch(_stmts: readonly { sql: string; params?: readonly unknown[] }[]) { throw new Error("unexpected batch"); },
  };
  const runner: Transactional = {
    async begin() {
      let release: (() => void) | undefined;
      let key: string | undefined;
      let staged: Record<string, unknown> | undefined;
      let writes = 0;
      const tx: Db = {
        async first<T>() { return null as T | null; },
        async query<T>() { return [] as T[]; },
        async batch(_stmts: readonly { sql: string; params?: readonly unknown[] }[]) { throw new Error("unexpected batch"); },
        async execute(sql: string, params: readonly unknown[] = []) {
          if (sql.startsWith("INSERT INTO `cash_financial_operations`")) {
            key = scope([params[1], params[2], params[3]]);
            release = await lock(key);
            if (rows.has(key)) throw { code: "1062" };
            staged = { id: params[0], request_hash: params[4], ledger_entry_id: null, response_json: null, completed_at: null };
          } else if (sql.startsWith("UPDATE `cash_financial_operations`")) {
            assert.ok(staged);
            staged.ledger_entry_id = params[0]; staged.response_json = params[1]; staged.completed_at = params[2];
          } else if (sql === "UPDATE business") {
            writes++;
          } else throw new Error(`unexpected SQL ${sql}`);
          return { affectedRows: 1 };
        },
      };
      return {
        ...tx,
        async commit() {
          commits++;
          if (commitMode !== "not-applied-error") {
            assert.ok(key && staged); rows.set(key, staged); businessWrites += writes;
          }
          release?.();
          if (commitMode !== "normal") throw new Error("commit acknowledgement lost");
        },
        async rollback() {
          rollbacks++; release?.();
          if (failRollback) throw new Error("rollback acknowledgement lost");
        },
      };
    },
  };
  return { rows, readDb, runner, counts: () => ({ lookups, commits, rollbacks, businessWrites }),
    commitMode: (value: typeof commitMode) => { commitMode = value; }, failRollback: () => { failRollback = true; } };
}

test("cash identity canonicalizes payload and UUIDs and binds actor, action, key and target", async () => {
  const first = await identity({ payload: { z: [2, { b: true, a: null }], a: 1 } });
  const equal = await identity({ actorId: actor.toUpperCase().replaceAll("-", ""), payload: { a: 1, z: [2, { a: null, b: true }] } });
  assert.deepEqual(first, equal);
  for (const changed of [
    { actorId: target }, { action: "CASH_WRITE_OFF" as const }, { targetId: ledger },
    { idempotencyKey: "request-2" }, { payload: { a: 2 } },
  ]) assert.notDeepEqual(first.requestHash, (await identity(changed)).requestHash);
  assert.notDeepEqual(first.keyHash, (await identity({ idempotencyKey: "request-2" })).keyHash);
  assert.deepEqual(cashOperationUuid(actor), cashOperationUuid(actor.replaceAll("-", "")));
});

test("cash identity rejects unsafe keys, malformed UUIDs and unbounded/non-JSON input", async () => {
  for (const key of ["", " ", "has space", "é", "x".repeat(65)]) await assert.rejects(identity({ idempotencyKey: key }), RangeError);
  await assert.rejects(identity({ actorId: "not-a-uuid" }), RangeError);
  const cycle: { self?: unknown } = {}; cycle.self = cycle;
  for (const value of [undefined, NaN, Infinity, -0, 1n, new Date(), [1, undefined], Array(2), cycle,
    Object.defineProperty({}, "x", { enumerable: true, get() { throw new Error("must not execute"); } }),
    { huge: "x".repeat(17_000) }, Array(1025).fill(1)]) {
    assert.throws(() => canonicalCashJson(value), RangeError);
  }
  assert.equal(canonicalCashJson({ z: 1, a: 2 }).text, '{"a":2,"z":1}');
});

test("operation atomically stores work and replays without executing it twice", async () => {
  const store = fakeStore(); const id = await identity(); let executions = 0;
  const work = async (tx: Db) => { executions++; await tx.execute("UPDATE business"); return ok(); };
  const first = await runCashOperation(store.runner, store.readDb, id, work, fixedNow);
  const replay = await runCashOperation(store.runner, store.readDb, id, work, fixedNow);
  assert.equal(first.kind, "created"); assert.equal(replay.kind, "replayed");
  if (first.kind === "created" && replay.kind === "replayed") assert.deepEqual(first.receipt, replay.receipt);
  assert.equal(executions, 1);
  assert.deepEqual(store.counts(), { lookups: 1, commits: 1, rollbacks: 1, businessWrites: 1 });
  assert.equal((await lookupCashOperation(store.readDb, id)).kind, "found");
});

test("concurrent same-key fake transactions serialize and replay once", async () => {
  const store = fakeStore(); const id = await identity(); let executions = 0;
  let entered!: () => void; let release!: () => void;
  const inside = new Promise<void>((resolve) => { entered = resolve; });
  const proceed = new Promise<void>((resolve) => { release = resolve; });
  const work = async () => { executions++; entered(); await proceed; return ok(); };
  const first = runCashOperation(store.runner, store.readDb, id, work, fixedNow);
  await inside;
  const second = runCashOperation(store.runner, store.readDb, id, work, fixedNow);
  release();
  assert.deepEqual((await Promise.all([first, second])).map((x) => x.kind).sort(), ["created", "replayed"]);
  assert.equal(executions, 1);
});

test("same scope with different payload or target conflicts; actor and action have separate scopes", async () => {
  const store = fakeStore(); const base = await identity();
  await runCashOperation(store.runner, store.readDb, base, ok, fixedNow);
  for (const changed of [{ targetId: ledger }, { payload: { amount: 124, currency: "BDT" } }]) {
    const id = await identity(changed);
    assert.equal((await lookupCashOperation(store.readDb, id)).kind, "conflict");
    assert.equal((await runCashOperation(store.runner, store.readDb, id, () => { throw new Error("must not run"); }, fixedNow)).kind, "conflict");
  }
  for (const changed of [{ actorId: target }, { action: "CASH_WRITE_OFF" as const }]) {
    assert.equal((await runCashOperation(store.runner, store.readDb, await identity(changed), ok, fixedNow)).kind, "created");
  }
});

test("failed work and invalid receipts roll back both business writes and reservation", async () => {
  const store = fakeStore(); const id = await identity();
  for (const result of [null, [], { amount: NaN }, { amount: "x".repeat(17000) }]) {
    await assert.rejects(runCashOperation(store.runner, store.readDb, id, async (tx) => {
      await tx.execute("UPDATE business"); return { ledgerEntryId: ledger, response: result };
    }, fixedNow));
    assert.equal((await lookupCashOperation(store.readDb, id)).kind, "missing");
  }
  await assert.rejects(runCashOperation(store.runner, store.readDb, id, async () => ({ ledgerEntryId: "invalid", response: {} }), fixedNow), RangeError);
  await assert.rejects(runCashOperation(store.runner, store.readDb, id, async () => { throw new Error("business failed"); }, fixedNow), /business failed/);
  assert.equal(store.counts().businessWrites, 0);
  assert.equal((await runCashOperation(store.runner, store.readDb, id, ok, fixedNow)).kind, "created");
});

test("business 1062 and non-1062 constraint errors are never classified as a replay", async () => {
  const store = fakeStore(); const id = await identity();
  for (const error of [{ code: "1062" }, { code: "23000" }, { errno: 1452 }]) {
    await assert.rejects(runCashOperation(store.runner, store.readDb, id, async () => { throw error; }, fixedNow), (actual) => actual === error);
  }
  assert.equal(store.counts().lookups, 0);
  assert.equal(store.counts().rollbacks, 3);
});

test("ambiguous commit is not retried: lookup can find committed receipt or return inconclusive absence", async () => {
  for (const mode of ["applied-error", "not-applied-error"] as const) {
    const store = fakeStore(); store.commitMode(mode); const id = await identity(); let executions = 0;
    await assert.rejects(runCashOperation(store.runner, store.readDb, id, async () => { executions++; return ok(); }, fixedNow), TransactionCommitUnknownError);
    assert.equal(executions, 1); assert.equal(store.counts().lookups, 0);
    assert.equal((await lookupCashOperation(store.readDb, id)).kind, mode === "applied-error" ? "found" : "missing");
    if (mode === "applied-error") {
      store.commitMode("normal");
      assert.equal((await runCashOperation(store.runner, store.readDb, id, () => { throw new Error("must not run"); }, fixedNow)).kind, "replayed");
    }
  }
});

test("failed rollback never becomes a replay or starts a lookup", async () => {
  const store = fakeStore(); const id = await identity();
  await runCashOperation(store.runner, store.readDb, id, ok, fixedNow);
  store.failRollback();
  await assert.rejects(runCashOperation(store.runner, store.readDb, id, ok, fixedNow), TransactionRollbackUnknownError);
  assert.equal(store.counts().lookups, 0);
});

test("incomplete or corrupt receipts are never replayed or re-executed", async () => {
  const store = fakeStore(); const id = await identity();
  await runCashOperation(store.runner, store.readDb, id, ok, fixedNow);
  const row = [...store.rows.values()][0]!;
  for (const [field, bad] of [["completed_at", null], ["ledger_entry_id", new Uint8Array(2)], ["response_json", "not JSON"], ["response_json", "[]"], ["request_hash", new Uint8Array(2)]] as const) {
    const previous = row[field]; row[field] = bad;
    assert.equal((await lookupCashOperation(store.readDb, id)).kind, "incomplete");
    assert.equal((await runCashOperation(store.runner, store.readDb, id, () => { throw new Error("must not run"); }, fixedNow)).kind, "unresolved");
    row[field] = previous;
  }
});

test("a duplicate with missing lookup is unresolved, not permission to run", async () => {
  const store = fakeStore(); const id = await identity();
  await runCashOperation(store.runner, store.readDb, id, ok, fixedNow);
  const staleRead: Db = { ...store.readDb, async first<T>() { return null as T | null; } };
  assert.equal((await runCashOperation(store.runner, staleRead, id, () => { throw new Error("must not run"); }, fixedNow)).kind, "unresolved");
});

test("only exact 1062 at reservation causes a lookup after rollback", async () => {
  for (const [error, expected] of [[{ details: { code: "1062" } }, "unresolved"], [{ code: "23000" }, "throws"], [{ code: "1452" }, "throws"]] as const) {
    const store = fakeStore(); const id = await identity();
    const runner: Transactional = { async begin() {
      const tx = await store.runner.begin();
      return { ...tx, async execute() { throw error; } };
    } };
    if (expected === "throws") await assert.rejects(runCashOperation(runner, store.readDb, id, ok, fixedNow), (actual) => actual === error);
    else assert.equal((await runCashOperation(runner, store.readDb, id, ok, fixedNow)).kind, expected);
    assert.equal(store.counts().rollbacks, 1);
    assert.equal(store.counts().lookups, expected === "unresolved" ? 1 : 0);
  }
});

test("operation snapshots its identity before the work callback can mutate it", async () => {
  const store = fakeStore(); const id = await identity(); const stable = await identity();
  const result = await runCashOperation(store.runner, store.readDb, id, async () => {
    id.requestHash.fill(0); id.keyHash.fill(0); return ok();
  }, fixedNow);
  assert.equal(result.kind, "created");
  assert.equal((await lookupCashOperation(store.readDb, stable)).kind, "found");
});
