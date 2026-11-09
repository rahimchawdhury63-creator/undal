/* Licensed under PASVL-1.0. SPDX-License-Identifier: LicenseRef-PASVL-1.0 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { connect, DatabaseError } from "@tidbcloud/serverless";
import { classifyError, createTransactionRunner, transactionalFromConnection, type Db } from "../src/db/client.ts";
import { TransactionCommitUnknownError, TransactionRollbackUnknownError, withTransaction, type Transactional } from "../src/db/transaction.ts";

/** Exercise the real pinned driver's begin/session behavior against a simulated gateway. */
function driver(options: { wrongZone?: boolean; failCommit?: boolean; failWork?: boolean } = {}) {
  const calls: { sql: string; token: string; isolation: string | undefined }[] = [];
  let token = "";
  let sequence = 0;
  const connection = connect({
    url: "mysql://test:secret@db.test/undal",
    fetch: async (_url, init) => {
      const sql = (JSON.parse(init?.body ?? "{}") as { query: string }).query;
      const incoming = init?.headers["TiDB-Session"] ?? "";
      calls.push({ sql, token: incoming, isolation: init?.headers["TiDB-Isolation-Level"] });
      if (sql === "BEGIN") token = "";
      if (incoming !== token) throw new Error("stale transaction session");
      if ((sql === "COMMIT" && options.failCommit) || (sql === "UPDATE fail SET a = 1" && options.failWork)) {
        return new Response(JSON.stringify({ message: "simulated failure", code: "error" }), { status: 503 });
      }
      token = `token-${++sequence}`;
      const body = sql === "SELECT @@session.time_zone AS time_zone"
        ? { types: [{ name: "time_zone", type: "VARCHAR" }], rows: [[options.wrongZone ? "+06:00" : "+00:00"]] }
        : { types: [], rows: [], rowsAffected: sql.startsWith("UPDATE") ? 1 : 0 };
      return new Response(JSON.stringify(body), { status: 200, headers: { "TiDB-Session": token } });
    },
  });
  return { runner: transactionalFromConnection(connection), calls };
}

test("transaction uses a fresh UTC-verified session and commits after ordered work", async () => {
  const { runner, calls } = driver();
  const value = await withTransaction(runner, async (tx) => {
    const [first, second] = await Promise.all([tx.execute("UPDATE one SET a = 1"), tx.execute("UPDATE two SET b = 2")]);
    assert.equal(first.affectedRows, 1);
    assert.equal(second.affectedRows, 1);
    return "done";
  });
  assert.equal(value, "done");
  assert.deepEqual(calls.map((c) => c.sql), ["BEGIN", "SET time_zone = '+00:00'", "SELECT @@session.time_zone AS time_zone", "UPDATE one SET a = 1", "UPDATE two SET b = 2", "COMMIT"]);
  assert.equal(calls[0]?.isolation, "READ COMMITTED");
  assert.deepEqual(calls.map((c) => c.token), ["", "token-1", "token-2", "token-3", "token-4", "token-5"]);
});

test("failed transaction timezone setup rolls back without invoking work", async () => {
  const { runner, calls } = driver({ wrongZone: true });
  let workCalled = false;
  await assert.rejects(() => withTransaction(runner, async () => { workCalled = true; }), /timezone could not be verified/u);
  assert.equal(workCalled, false);
  assert.deepEqual(calls.map((c) => c.sql), ["BEGIN", "SET time_zone = '+00:00'", "SELECT @@session.time_zone AS time_zone", "ROLLBACK"]);
});

test("a transaction handle cannot execute or commit again after it finishes", async () => {
  const { runner } = driver();
  const tx = await runner.begin();
  await tx.commit();
  await assert.rejects(() => tx.execute("UPDATE x SET y = 1"), /already finished/u);
  await assert.rejects(() => tx.commit(), /already finished/u);
  await assert.rejects(() => tx.rollback(), /already finished/u);
});

test("a lost commit acknowledgement is surfaced as unknown and never retried or rolled back", async () => {
  const { runner, calls } = driver({ failCommit: true });
  let runs = 0;
  await assert.rejects(() => withTransaction(runner, async (tx) => {
    runs += 1;
    await tx.execute("UPDATE one SET a = 1");
  }), TransactionCommitUnknownError);
  assert.equal(runs, 1);
  assert.equal(calls.filter((c) => c.sql === "BEGIN").length, 1);
  assert.equal(calls.filter((c) => c.sql === "COMMIT").length, 1);
  assert.equal(calls.filter((c) => c.sql === "ROLLBACK").length, 0);
});

function fakeRunner(options: { commitFail?: boolean; rollbackFail?: boolean } = {}) {
  const counts = { begin: 0, commit: 0, rollback: 0 };
  const runner: Transactional = {
    async begin() {
      counts.begin += 1;
      return {
        query: async <T>() => [] as T[], first: async <T>() => null as T | null,
        execute: async () => ({ affectedRows: 1 }), batch: async () => undefined,
        commit: async () => { counts.commit += 1; if (options.commitFail) throw new Error("commit lost"); },
        rollback: async () => { counts.rollback += 1; if (options.rollbackFail) throw new Error("rollback lost"); },
      };
    },
  };
  return { runner, counts };
}

test("driver-nested deadlocks retry only after successful rollback", async () => {
  const { runner, counts } = fakeRunner();
  let calls = 0;
  const value = await withTransaction(runner, async (_tx: Db) => {
    calls += 1;
    if (calls === 1) throw new DatabaseError("deadlock", 500, { message: "deadlock", code: "1213" });
    return 42;
  }, { sleepFn: async () => undefined });
  assert.equal(value, 42);
  assert.deepEqual(counts, { begin: 2, rollback: 1, commit: 1 });
  assert.equal(classifyError(new DatabaseError("lock timeout", 500, { message: "timeout", code: "1205" })), "LOCK_TIMEOUT");
  assert.equal(classifyError(null), "UNKNOWN");
});

test("rollback uncertainty and network failures never automatically retry", async () => {
  const rollbackFailure = fakeRunner({ rollbackFail: true });
  const workError = { code: "1213" };
  await assert.rejects(() => withTransaction(rollbackFailure.runner, async () => { throw workError; }, { sleepFn: async () => undefined }), (error: unknown) => {
    assert.ok(error instanceof TransactionRollbackUnknownError);
    assert.equal(error.workError, workError);
    return true;
  });
  assert.deepEqual(rollbackFailure.counts, { begin: 1, rollback: 1, commit: 0 });
  const networkFailure = fakeRunner();
  await assert.rejects(() => withTransaction(networkFailure.runner, async () => { throw new Error("fetch failed"); }, { sleepFn: async () => undefined }), /fetch failed/u);
  assert.deepEqual(networkFailure.counts, { begin: 1, rollback: 1, commit: 0 });
});

test("invalid attempt limits do not open a transaction", async () => {
  const { runner, counts } = fakeRunner();
  for (const attempts of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(() => withTransaction(runner, async () => 1, { attempts }), RangeError);
  }
  assert.equal(counts.begin, 0);
});


test("transaction callback refuses DDL, session control and multi-statements before issuing SQL", async () => {
  const { runner, calls } = driver();
  const tx = await runner.begin();
  for (const sql of ["COMMIT", "ROLLBACK", "BEGIN", "SET autocommit = 1", "CREATE TABLE x (a INT)", "SELECT 1; DELETE FROM x", "/*comment*/ COMMIT"]) {
    await assert.rejects(() => tx.execute(sql), /unsupported statement/u);
  }
  await assert.rejects(() => tx.batch([{ sql: "UPDATE x SET y = 1" }, { sql: "DROP TABLE x" }]), /unsupported statement/u);
  assert.deepEqual(calls.map((c) => c.sql), ["BEGIN", "SET time_zone = '+00:00'", "SELECT @@session.time_zone AS time_zone"]);
  await tx.rollback();
});

// Optional non-mutating smoke test. It does not prove rollback of writes or concurrent transaction isolation.
const stagingUrl = process.env["UNDAL_TEST_TIDB_DATABASE_URL"];
test("live TiDB staging transaction can establish UTC and commit", { skip: stagingUrl ? false : "UNDAL_TEST_TIDB_DATABASE_URL not set" }, async () => {
  if (!stagingUrl) throw new Error("missing staging URL");
  const row = await withTransaction(createTransactionRunner(stagingUrl), async (tx) =>
    tx.first<{ time_zone: string }>("SELECT @@session.time_zone AS time_zone"));
  assert.equal(row?.time_zone, "+00:00");
});

test("a failed statement rolls back on the same session before returning its error", async () => {
  const { runner, calls } = driver({ failWork: true });
  await assert.rejects(() => withTransaction(runner, async (tx) => {
    await tx.execute("UPDATE one SET a = 1");
    await tx.execute("UPDATE fail SET a = 1");
  }), /simulated failure/u);
  assert.deepEqual(calls.map((c) => c.sql), ["BEGIN", "SET time_zone = '+00:00'", "SELECT @@session.time_zone AS time_zone", "UPDATE one SET a = 1", "UPDATE fail SET a = 1", "ROLLBACK"]);
});

test("a failed commit leaves the transaction handle terminal", async () => {
  const { runner, calls } = driver({ failCommit: true });
  const tx = await runner.begin();
  await assert.rejects(() => tx.commit(), /simulated failure/u);
  await assert.rejects(() => tx.execute("UPDATE x SET y = 1"), /already finished/u);
  await assert.rejects(() => tx.rollback(), /already finished/u);
  assert.equal(calls.filter((call) => call.sql === "COMMIT").length, 1);
});

test("exhausted lock timeouts roll back every attempt and never commit", async () => {
  const { runner, counts } = fakeRunner();
  await assert.rejects(() => withTransaction(runner, async () => {
    throw new DatabaseError("lock timeout", 500, { message: "timeout", code: "1205" });
  }, { attempts: 2, sleepFn: async () => undefined }), /lock timeout/u);
  assert.deepEqual(counts, { begin: 2, rollback: 2, commit: 0 });
});

test("failure to start a transaction is reported without automatic replay", async () => {
  let starts = 0;
  const runner: Transactional = { async begin() { starts += 1; throw new Error("fetch failed"); } };
  await assert.rejects(() => withTransaction(runner, async () => 42, { sleepFn: async () => undefined }), /fetch failed/u);
  assert.equal(starts, 1);
});
