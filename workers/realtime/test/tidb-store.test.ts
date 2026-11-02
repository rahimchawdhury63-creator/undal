/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `coordination_state` behind the `StateStore` port (D90).
 *
 * The store is the same port the coordinator has always had, so these tests are about the three places the
 * table's shape shows through: a value is JSON text, an expiry is a timestamp computed from the caller's
 * clock, and a prefix listing is a `LIKE` whose pattern characters a key may not contain.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { COORDINATION_STATEMENTS } from "@undal/contracts";

import { FixedClock } from "../src/lib/clock.ts";
import type { SqlExecutor } from "../src/coordination/tidb.ts";
import { createTiDBStateStore } from "../src/coordination/tidb-store.ts";

const T0 = 1_700_000_000_000;

/** An executor that records calls and answers from a script. */
class ScriptedSql implements SqlExecutor {
  readonly calls: { sql: string; params: readonly unknown[] }[] = [];
  rows: readonly Record<string, unknown>[] = [];
  affectedRows = 1;

  async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    this.calls.push({ sql, params });
    return this.rows as unknown as T[];
  }

  async execute(sql: string, params: readonly unknown[] = []): Promise<{ affectedRows: number }> {
    this.calls.push({ sql, params });
    return { affectedRows: this.affectedRows };
  }
}

const store = (sql: ScriptedSql) => createTiDBStateStore(sql, new FixedClock(T0));
const last = (sql: ScriptedSql) => sql.calls[sql.calls.length - 1];

describe("the value and the expiry", () => {
  test("a put without a ttl writes JSON and a null expiry", async () => {
    const sql = new ScriptedSql();
    await store(sql).put("presence:zone-1:RIDER:rider-a:phone-1", { role: "RIDER" });
    assert.equal(last(sql)?.sql, COORDINATION_STATEMENTS.state_put.sql);
    assert.deepEqual(last(sql)?.params, ["presence:zone-1:RIDER:rider-a:phone-1", '{"role":"RIDER"}', null]);
  });

  test("a ttl is an absolute instant on the caller's clock, not a duration", async () => {
    const sql = new ScriptedSql();
    await store(sql).put("dispatch:order-1", { phase: "OFFERED" }, 60);
    const expiresAt = String((last(sql)?.params as readonly unknown[])[2]);
    assert.match(expiresAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/u);
    assert.equal(expiresAt, "2023-11-14 22:14:20.000");
  });

  test("a get parses the value and passes the clock, so an expired row reads as absent", async () => {
    const sql = new ScriptedSql();
    sql.rows = [{ state_value: '{"phase":"OFFERED"}' }];
    assert.deepEqual(await store(sql).get("dispatch:order-1"), { phase: "OFFERED" });
    assert.equal(last(sql)?.sql, COORDINATION_STATEMENTS.state_get.sql);
    const params = last(sql)?.params as readonly unknown[];
    assert.equal(params[0], "dispatch:order-1");
    assert.match(String(params[1]), /^2023-11-14 22:13:20\./u);
  });

  test("a get with no row is null, not an empty object", async () => {
    const sql = new ScriptedSql();
    assert.equal(await store(sql).get("dispatch:order-1"), null);
  });

  test("a delete is one statement and no read", async () => {
    const sql = new ScriptedSql();
    await store(sql).delete("presence:zone-1:RIDER:rider-a:phone-1");
    assert.equal(sql.calls.length, 1);
    assert.equal(last(sql)?.sql, COORDINATION_STATEMENTS.state_delete.sql);
  });
});

describe("a prefix is a prefix", () => {
  test("the listing passes the prefix, the clock and the row cap", async () => {
    const sql = new ScriptedSql();
    sql.rows = [{ state_key: "presence:zone-1:RIDER:rider-a:p1", state_value: '{"role":"RIDER"}' }];
    const rows = await store(sql).list("presence:zone-1:");
    assert.deepEqual(rows, [{ key: "presence:zone-1:RIDER:rider-a:p1", value: { role: "RIDER" } }]);
    const params = last(sql)?.params as readonly unknown[];
    assert.equal(params[0], "presence:zone-1:");
    assert.equal(typeof params[2], "number");
  });

  test("a key carrying a LIKE pattern character is refused rather than widening a listing", async () => {
    const sql = new ScriptedSql();
    for (const key of ["presence:zone%", "presence:zone_1:", "dispatch:order-1:RIDER"]) {
      if (key === "dispatch:order-1:RIDER") continue;
      await assert.rejects(store(sql).get(key), /not a coordination state key/u);
    }
    await assert.rejects(store(sql).list("presence:%:"), /not a coordination state key/u);
    assert.deepEqual(sql.calls, []);
  });

  test("a key longer than the index allows is refused before the database", async () => {
    const sql = new ScriptedSql();
    await assert.rejects(store(sql).get(`dispatch:${"a".repeat(200)}`), /not a coordination state key/u);
    assert.deepEqual(sql.calls, []);
  });
});
