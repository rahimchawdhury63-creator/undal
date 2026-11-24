/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `POST /internal/coordination/statements` — the free coordinator's database (D90).
 *
 * The tests are about what the route will not do. It will not run SQL a caller supplied, it will not run a
 * statement whose name is not in the catalogue, and it will not carry a value that is not a column value.
 * What it *will* do is run the catalogue's own spelling, which is the property the whole trust boundary
 * rests on: realtime composes `claim_lock`, and core executes exactly the `claim_lock` the contract defines.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { COORDINATION_STATEMENTS, MAX_STATEMENT_ROWS } from "@undal/contracts";

import { stubDb } from "../src/db/client.ts";
import { COORDINATION_PATH, COORDINATION_ROUTES } from "../src/routes/coordination.ts";
import type { Ctx } from "../src/middleware/context.ts";
import { testEnv } from "./support.ts";

const TOKEN = "test-internal-token";

const route = () => {
  const found = COORDINATION_ROUTES.find((candidate) => candidate.path === COORDINATION_PATH);
  if (found === undefined) throw new Error("no coordination route");
  return found;
};

/** A database that answers the two statements these tests reach. */
function statementDb(rows: readonly Record<string, unknown>[] = [], affectedRows = 1) {
  const answer = [...rows];
  return stubDb([
    { match: /^SELECT 1 AS one$/u, rows: answer },
    { match: /UPDATE dispatch_locks/u, affectedRows },
    { match: /^SELECT state_value FROM coordination_state/u, rows: answer },
    { match: /^INSERT INTO coordination_state/u, affectedRows },
  ]);
}

function ctxFor(db: ReturnType<typeof stubDb>, token: string | null = TOKEN): Ctx {
  const request = new Request(`https://api.undal.app${COORDINATION_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
  });
  return {
    env: testEnv(),
    db,
    url: new URL(request.url),
    request,
    requestId: "0193f2a1-7c3e-7890-abcd-ef0123456700",
    ip: "1.2.3.4",
    userAgent: "undal-realtime",
    keys: [],
    principal: null,
    locale: "en",
    startedAtMs: 0,
    waitUntil: () => undefined,
  } as Ctx;
}

/** Post a body and parse whatever comes back. */
async function run(db: ReturnType<typeof stubDb>, body: unknown, token: string | null = TOKEN) {
  const response = await route().run(ctxFor(db, token), { params: {}, body, reason: null });
  return {
    status: response.status,
    body: (await response.json()) as {
      ok?: boolean;
      data?: { rows?: readonly unknown[]; truncated?: boolean; affectedRows?: number };
      error?: { details?: Record<string, unknown> };
    },
  };
}

describe("authorization", () => {
  test("no internal token is refused and nothing is executed", async () => {
    const db = statementDb();
    const { status } = await run(db, { statement: "ping" }, null);
    assert.equal(status, 401);
    assert.deepEqual(db.calls, []);
  });
});

describe("the closed catalogue", () => {
  test("a statement name that is not in it is refused before the database is touched", async () => {
    const db = statementDb();
    const { status, body } = await run(db, { statement: "DROP TABLE orders", params: [] });
    assert.equal(status, 422);
    assert.equal(body.error?.details?.["reason"], "unknown_statement");
    assert.deepEqual(db.calls, []);
  });

  test("SQL text is not a statement name", async () => {
    const db = statementDb();
    const { status } = await run(db, { statement: COORDINATION_STATEMENTS.ping.sql, params: [] });
    assert.equal(status, 422);
    assert.deepEqual(db.calls, []);
  });

  test("a read runs the catalogue's own spelling and answers rows", async () => {
    const db = statementDb([{ one: 1 }]);
    const { status, body } = await run(db, { statement: "ping" });
    assert.equal(status, 200);
    assert.deepEqual(body.data?.rows, [{ one: 1 }]);
    assert.equal(body.data?.truncated, false);
    assert.equal(db.calls[0]?.sql, COORDINATION_STATEMENTS.ping.sql);
  });

  test("a write answers affectedRows, which is what a claim is decided by", async () => {
    const db = statementDb([], 1);
    const params = ["rider-a", "2026-01-01 00:00:00.000000", "0".repeat(32), "rider-a", "x", "y"];
    const { status, body } = await run(db, { statement: "claim_lock", params });
    assert.equal(status, 200);
    assert.equal(body.data?.affectedRows, 1);
    assert.equal(db.calls[0]?.sql, COORDINATION_STATEMENTS.claim_lock.sql);
    assert.deepEqual(db.calls[0]?.params, params);
  });

  test("a read whose result is enormous is truncated rather than streamed", async () => {
    const rows = Array.from({ length: MAX_STATEMENT_ROWS + 1 }, (_, index) => ({ one: indexed(index) }));
    const db = statementDb(rows);
    const { body } = await run(db, { statement: "ping" });
    assert.equal(body.data?.rows?.length, MAX_STATEMENT_ROWS);
    assert.equal(body.data?.truncated, true);
  });
});

describe("what a parameter may be", () => {
  test("strings, finite numbers and null travel", async () => {
    const db = statementDb([], 1);
    const { status } = await run(db, { statement: "state_put", params: ["k", "v", null] });
    assert.equal(status, 200);
    assert.deepEqual(db.calls[0]?.params, ["k", "v", null]);
  });

  test("a boolean, an object or an array is refused rather than coerced", async () => {
    for (const param of [true, { a: 1 }, [1, 2], Number.NaN, Number.POSITIVE_INFINITY]) {
      const db = statementDb();
      const { status, body } = await run(db, { statement: "state_put", params: ["k", param] });
      assert.equal(status, 422, `param ${JSON.stringify(param)} must be refused`);
      assert.equal(body.error?.details?.["field"], "params");
      assert.deepEqual(db.calls, []);
    }
  });

  test("a parameter list longer than the catalogue allows is refused", async () => {
    const db = statementDb();
    const params = Array.from({ length: 17 }, () => "x");
    const { status } = await run(db, { statement: "state_put", params });
    assert.equal(status, 422);
    assert.deepEqual(db.calls, []);
  });

  test("a parameter longer than a state value may be is refused", async () => {
    const db = statementDb();
    const { status } = await run(db, { statement: "state_put", params: ["k", "x".repeat(4_097)] });
    assert.equal(status, 422);
    assert.deepEqual(db.calls, []);
  });

  test("no parameter list at all means no parameters", async () => {
    const db = statementDb([{ one: 1 }]);
    const { status } = await run(db, { statement: "ping" });
    assert.equal(status, 200);
    assert.deepEqual(db.calls[0]?.params, []);
  });
});

/** A number the compiler knows is a number. */
function indexed(index: number): number {
  return index;
}
