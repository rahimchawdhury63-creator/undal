/* Licensed under PASVL-1.0. SPDX-License-Identifier: LicenseRef-PASVL-1.0 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { connect } from "@tidbcloud/serverless";
import { dbFromConnection } from "../src/db/client.ts";

/** Exercise the pinned TiDB driver, not the repository stub: by default it returns rows only. */
function driver(replies: Record<string, unknown>[]) {
  const queries: string[] = [];
  const conn = connect({
    url: "mysql://test:secret@db.test/undal",
    fetch: async (_input, init) => {
      const request = JSON.parse(init?.body ?? "{}") as { query?: string };
      queries.push(request.query ?? "");
      const body = replies.shift();
      if (body === undefined) throw new Error("unexpected driver request");
      return new Response(JSON.stringify(body), { status: 200, headers: { "TiDB-Session": "test-session" } });
    },
  });
  return { db: dbFromConnection(conn), queries };
}

test("real TiDB driver metadata distinguishes successful writes from zero-row guards", async () => {
  const { db, queries } = driver([
    { types: [], rows: [], rowsAffected: 1, lastInsertID: 42 },
    { types: [], rows: [], rowsAffected: 0, lastInsertID: null },
    { types: [], rows: [], rowsAffected: 2, lastInsertID: null },
  ]);
  assert.deepEqual(await db.execute("UPDATE cases SET owner = ? WHERE id = ?", ["alice", 10]), { affectedRows: 1, lastInsertId: 42 });
  assert.deepEqual(await db.execute("UPDATE cases SET owner = ? WHERE id = ?", ["alice", 11]), { affectedRows: 0 });
  assert.deepEqual(await db.execute("DELETE FROM cases"), { affectedRows: 2 });
  assert.equal(queries.length, 3);
});

test("real TiDB driver keeps row arrays for reads and empty results remain null", async () => {
  const { db } = driver([
    { types: [{ name: "name", type: "VARCHAR", nullable: false }], rows: [["Karim"]], rowsAffected: 0 },
    { types: [{ name: "name", type: "VARCHAR", nullable: false }], rows: [], rowsAffected: 0 },
    { types: [{ name: "name", type: "VARCHAR", nullable: false }], rows: [["A"], ["B"]], rowsAffected: 0 },
  ]);
  assert.deepEqual(await db.first("SELECT name FROM riders"), { name: "Karim" });
  assert.equal(await db.first("SELECT name FROM riders WHERE 1 = 0"), null);
  assert.deepEqual(await db.query("SELECT name FROM riders"), [{ name: "A" }, { name: "B" }]);
});

test("unexpected write response shape fails closed rather than claiming zero rows", async () => {
  const db = dbFromConnection({ execute: async () => [] });
  await assert.rejects(() => db.execute("UPDATE cases SET owner = NULL"), /valid affected-row count/u);
});

test("cash case claim sees the actual driver affected-row count and binds binary ids", async () => {
  const { claimDeclaration } = await import("../src/repositories/declarations.ts");
  const { db, queries } = driver([
    { types: [], rows: [], rowsAffected: 1, lastInsertID: null },
    { types: [], rows: [], rowsAffected: 0, lastInsertID: null },
  ]);
  const caseId = new Uint8Array(16).fill(3);
  const reviewerId = new Uint8Array(16).fill(4);
  assert.equal(await claimDeclaration(db, caseId, reviewerId, 0), true);
  assert.equal(await claimDeclaration(db, caseId, reviewerId, 0), false);
  assert.match(queries[0] ?? "", /`owner_id` IS NULL AND `resolved_at` IS NULL/u);
  assert.match(queries[0] ?? "", /0x04040404040404040404040404040404/u);
  assert.match(queries[0] ?? "", /0x03030303030303030303030303030303/u);
});

test("read shape remains stable when the driver's connection defaults to full results", async () => {
  const connection = connect({
    url: "mysql://test:secret@db.test/undal", fullResult: true,
    fetch: async () => new Response(JSON.stringify({
      types: [{ name: "name", type: "VARCHAR", nullable: false }], rows: [["A"]], rowsAffected: 0,
    }), { status: 200, headers: { "TiDB-Session": "test-session" } }),
  });
  assert.deepEqual(await dbFromConnection(connection).query("SELECT name FROM riders"), [{ name: "A" }]);
});

test("gateway errors propagate rather than becoming successful zero-row writes", async () => {
  const connection = connect({
    url: "mysql://test:secret@db.test/undal",
    fetch: async () => new Response(JSON.stringify({ message: "service unavailable", code: "error" }), { status: 503 }),
  });
  await assert.rejects(() => dbFromConnection(connection).execute("UPDATE cases SET owner = NULL"), /service unavailable/u);
});
