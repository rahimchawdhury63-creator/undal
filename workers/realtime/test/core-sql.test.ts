/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The executor that turns composed SQL into a catalogue name (D90).
 *
 * Two properties are the point. The wire carries a name, never SQL — so a statement the catalogue does not
 * hold cannot leave this Worker at all. And a failure throws: a claim that answered `affectedRows: 0` because
 * core was unreachable would be indistinguishable from a claim another rider won.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { COORDINATION_STATEMENTS } from "@undal/contracts";

import { COORDINATION_PATH, createCoreSqlExecutor } from "../src/coordination/core-sql.ts";
import { CLAIM_SQL, PING_SQL } from "../src/coordination/tidb.ts";

const BASE = "https://api.undal.app";
const TOKEN = "test-internal-token";

/** A transport that records what was sent and answers with a script. */
function stub(answer: (url: string, init: RequestInit) => Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return answer(String(input), init ?? {});
  }) as unknown as typeof fetch;
  return { calls, transport };
}

describe("the name on the wire", () => {
  test("a composed statement travels as its catalogue name", async () => {
    const { calls, transport } = stub(async () => Response.json({ ok: true, data: { rows: [{ one: 1 }] } }));
    const rows = await createCoreSqlExecutor(BASE, TOKEN, { fetch: transport }).query(PING_SQL);
    assert.equal(calls[0]?.url, `${BASE}${COORDINATION_PATH}`);
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { statement: "ping", params: [] });
    assert.deepEqual(rows, [{ one: 1 }]);
    assert.equal((calls[0]?.init.headers as Record<string, string>).authorization, `Bearer ${TOKEN}`);
  });

  test("a claim carries its parameters and its name, in that shape", async () => {
    const { calls, transport } = stub(async () => Response.json({ ok: true, data: { affectedRows: 1 } }));
    const params = ["rider-a", "2026-01-01 00:00:00.000000", "0".repeat(32)];
    const result = await createCoreSqlExecutor(BASE, TOKEN, { fetch: transport }).execute(CLAIM_SQL, params);
    assert.deepEqual(result, { affectedRows: 1 });
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { statement: "claim_lock", params });
  });

  test("SQL the catalogue does not hold never reaches the transport", async () => {
    const { calls, transport } = stub(async () => Response.json({ ok: true, data: { rows: [] } }));
    await assert.rejects(
      createCoreSqlExecutor(BASE, TOKEN, { fetch: transport }).query("SELECT * FROM users LIMIT 1"),
      /not in the catalogue/u,
    );
    assert.deepEqual(calls, []);
  });

  test("the catalogue and the coordinator agree on every statement it composes", () => {
    // The executor looks statements up by exact text, so a coordinator constant that drifted from the
    // catalogue would be a claim nobody could run — caught here rather than at 03:00 on the free path.
    for (const statement of Object.values(COORDINATION_STATEMENTS)) {
      assert.equal(typeof statement.sql, "string");
      assert.notEqual(statementForName(statement.name), null);
    }
    assert.equal(CLAIM_SQL, COORDINATION_STATEMENTS.claim_lock.sql);
    assert.equal(PING_SQL, COORDINATION_STATEMENTS.ping.sql);
  });

  function statementForName(name: string): string | null {
    const found = Object.values(COORDINATION_STATEMENTS).find((statement) => statement.name === name);
    return found === undefined ? null : found.sql;
  }
});

describe("failures throw", () => {
  test("a refusal from core is not an empty result", async () => {
    const { transport } = stub(async () => new Response("nope", { status: 503 }));
    await assert.rejects(createCoreSqlExecutor(BASE, TOKEN, { fetch: transport }).query(PING_SQL), /refused ping/u);
  });

  test("a write that answered without affectedRows is an error, not a zero", async () => {
    const { transport } = stub(async () => Response.json({ ok: true, data: {} }));
    await assert.rejects(
      createCoreSqlExecutor(BASE, TOKEN, { fetch: transport }).execute(CLAIM_SQL, []),
      /without affectedRows/u,
    );
  });

  test("an envelope with ok: false is an error", async () => {
    const { transport } = stub(async () => Response.json({ ok: false, error: { code: "INTERNAL" } }));
    await assert.rejects(createCoreSqlExecutor(BASE, TOKEN, { fetch: transport }).query(PING_SQL), /did not run/u);
  });

  test("a statement that does not answer is abandoned, not waited on", async () => {
    const { transport } = stub(
      async () => new Promise<Response>(() => undefined),
    );
    await assert.rejects(
      createCoreSqlExecutor(BASE, TOKEN, { fetch: transport, timeoutMs: 5 }).query(PING_SQL),
      /within 5 ms/u,
    );
  });
});
