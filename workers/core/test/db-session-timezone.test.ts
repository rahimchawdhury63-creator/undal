/* Licensed under PASVL-1.0. SPDX-License-Identifier: LicenseRef-PASVL-1.0 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { connect } from "@tidbcloud/serverless";
import { createDb, dbFromConnection } from "../src/db/client.ts";

const SET_UTC = "SET time_zone = '+00:00'";
const CHECK_UTC = "SELECT @@session.time_zone AS time_zone";

/** Simulate a gateway that returns a new session token on every response. */
function gateway(options: { wrongZone?: boolean; failSet?: boolean; failBusiness?: boolean } = {}) {
  const calls: { sql: string; session: string }[] = [];
  let active = 0;
  let maxActive = 0;
  let token = "";
  const connection = connect({
    url: "mysql://test:secret@db.test/undal",
    fetch: async (_url, init) => {
      const sql = (JSON.parse(init?.body ?? "{}") as { query: string }).query;
      const session = init?.headers["TiDB-Session"] ?? "";
      calls.push({ sql, session });
      active += 1;
      maxActive = Math.max(active, maxActive);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      if (session !== token) throw new Error("stale session token");
      if ((sql === SET_UTC && options.failSet) || (sql === "FAIL" && options.failBusiness)) {
        return new Response(JSON.stringify({ message: "simulated database failure", code: "error" }), { status: 503 });
      }
      token = `token-${calls.length}`;
      const body = sql === CHECK_UTC
        ? { types: [{ name: "time_zone", type: "VARCHAR" }], rows: [[options.wrongZone ? "+06:00" : "+00:00"]] }
        : sql === "SELECT value"
          ? { types: [{ name: "value", type: "INT" }], rows: [["7"]] }
          : { types: [], rows: [], rowsAffected: 1 };
      return new Response(JSON.stringify(body), { status: 200, headers: { "TiDB-Session": token } });
    },
  });
  return { db: dbFromConnection(connection), calls, maxActive: () => maxActive };
}

test("lazy initialization sets and verifies UTC once, before concurrent reads and writes", async () => {
  const { db, calls, maxActive } = gateway();
  assert.equal(calls.length, 0, "construction does not require a database connection");
  const [first, rows, write] = await Promise.all([
    db.first<{ value: number }>("SELECT value"),
    db.query<{ value: number }>("SELECT value"),
    db.execute("UPDATE x SET y = 1"),
  ]);
  assert.equal(first?.value, 7);
  assert.equal(rows[0]?.value, 7);
  assert.equal(write.affectedRows, 1);
  assert.deepEqual(calls.map((call) => call.sql), [SET_UTC, CHECK_UTC, "SELECT value", "SELECT value", "UPDATE x SET y = 1"]);
  assert.deepEqual(calls.map((call) => call.session), ["", "token-1", "token-2", "token-3", "token-4"]);
  assert.equal(maxActive(), 1, "one mutable driver session cannot be used concurrently");
});

test("bad timezone or failed setup blocks every later operation, including writes and batches", async () => {
  for (const options of [{ wrongZone: true }, { failSet: true }]) {
    const { db, calls } = gateway(options);
    const results = await Promise.allSettled([
      db.first("SELECT value"), db.execute("UPDATE x SET y = 1"), db.batch([{ sql: "DELETE FROM x" }]),
    ]);
    assert.ok(results.every((result) => result.status === "rejected"));
    assert.deepEqual(calls.map((call) => call.sql), options.failSet ? [SET_UTC] : [SET_UTC, CHECK_UTC]);
  }
});

test("a failed business statement does not stop a later compensating statement", async () => {
  const { db, calls } = gateway({ failBusiness: true });
  await assert.rejects(() => db.execute("FAIL"), /simulated database failure/u);
  assert.equal((await db.execute("UPDATE x SET y = 0")).affectedRows, 1);
  assert.deepEqual(calls.map((call) => call.sql), [SET_UTC, CHECK_UTC, "FAIL", "UPDATE x SET y = 0"]);
});

test("a batch runs after setup in statement order, without claiming transaction semantics", async () => {
  const { db, calls } = gateway();
  await db.batch([]);
  assert.equal(calls.length, 0);
  await db.batch([{ sql: "UPDATE a SET b = 1" }, { sql: "UPDATE a SET b = 2" }]);
  assert.deepEqual(calls.map((call) => call.sql), [SET_UTC, CHECK_UTC, "UPDATE a SET b = 1", "UPDATE a SET b = 2"]);
});

// Opt in only with a dedicated staging database. No data is written; SET is session-scoped.
const stagingUrl = process.env["UNDAL_TEST_TIDB_DATABASE_URL"];
test("live TiDB staging session really runs in UTC", { skip: stagingUrl ? false : "UNDAL_TEST_TIDB_DATABASE_URL not set" }, async () => {
  if (!stagingUrl) throw new Error("missing staging URL");
  const db = createDb(stagingUrl);
  const row = await db.first<{ time_zone: string; delta_seconds: number }>(
    "SELECT @@session.time_zone AS time_zone, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(6), CURRENT_TIMESTAMP(6)) AS delta_seconds",
  );
  assert.equal(row?.time_zone, "+00:00");
  assert.ok(Math.abs(Number(row?.delta_seconds)) <= 1);
});

test("batch failure stops later statements but does not roll back earlier ones", async () => {
  const { db, calls } = gateway({ failBusiness: true });
  await assert.rejects(() => db.batch([{ sql: "UPDATE a SET b = 1" }, { sql: "FAIL" }, { sql: "DELETE FROM a" }]), /simulated database failure/u);
  assert.deepEqual(calls.map((call) => call.sql), [SET_UTC, CHECK_UTC, "UPDATE a SET b = 1", "FAIL"]);
});
