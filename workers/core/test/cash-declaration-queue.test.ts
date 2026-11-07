/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";
import { CASH_QUEUE_ROUTES } from "../src/routes/cash-queue.ts";
import type { Ctx } from "../src/middleware/context.ts";
import type { Principal } from "../src/rbac/guard.ts";

/**
 * The declarations waiting for a human (D154).
 *
 * `25 §7` lifts the block for every declaration, so the rider is already handled. What this list is for is the other
 * half: a robbery needs a call back, and a dispute needs somebody to compare the arithmetic the rider objected to with
 * the arithmetic the platform holds now. The tests defend that pairing, and the ordering — newest first, because a
 * declaration that has already lifted the block is not a countdown.
 */

const ADMIN_HEX = "0193f2a17c3e7890abcdef0123456731";
const RIDER_HEX = "0193f2a17c3e7890abcdef0123456707";

const bytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
};

function dbFor(declarations: readonly Record<string, unknown>[]): ReturnType<typeof stubDb> {
  return stubDb([{ match: /FROM `rider_cash_declarations` d JOIN `riders` r/u, rows: [...declarations] }]);
}

const PRINCIPAL = {
  userId: ADMIN_HEX,
  actorType: "ADMIN",
  role: "FINANCE",
  zoneScope: null,
  sessionId: "0193f2a17c3e7890abcdef01234567ff",
  stepUpAtMs: Date.now(),
} as unknown as Principal;

function ctxFor(db: ReturnType<typeof stubDb>, query = ""): Ctx {
  const url = `https://api.undal.test/v1/finance/cash/declarations${query}`;
  return {
    env: testEnv(),
    db,
    url: new URL(url),
    request: new Request(url),
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
  const found = CASH_QUEUE_ROUTES.find((candidate) => candidate.path === "/v1/finance/cash/declarations");
  if (found === undefined) throw new Error("no declarations route");
  return found;
};

const run = async (db: ReturnType<typeof stubDb>, query = ""): Promise<{ status: number; data: Record<string, any> }> => {
  const response = await route().run(ctxFor(db, query), { params: {}, body: null, reason: null });
  const parsed = (await response.json()) as { data: Record<string, any> };
  return { status: response.status, data: parsed.data };
};

const minutesAgo = (minutes: number): string =>
  new Date(Date.now() - minutes * 60_000).toISOString().replace("T", " ").replace("Z", "000");

function declarationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: bytes("0193f2a17c3e7890abcdef01234567d1"),
    rider_id: bytes(RIDER_HEX),
    full_name: "Karim Rahman",
    code: "RDR-4K2M",
    kind: "DISPUTE",
    note: "I only collected eight thousand",
    outstanding_paisa: 214_000,
    snapshot_lines_paisa: 84_000,
    snapshot_difference_paisa: 130_000,
    created_at: minutesAgo(20),
    ...overrides,
  };
}

const DECLARATIONS_PATH = "/v1/finance/cash/declarations";


describe("the declarations waiting for a human (D154)", () => {
  test("a dispute arrives with both numbers: what was claimed then, and what is claimed now", async () => {
    const db = dbFor([declarationRow()]);
    const answer = await run(db);
    assert.equal(answer.status, 200);
    const data = answer.data;
    assert.equal(data.declarations[0].kind, "DISPUTE");
    assert.equal(data.declarations[0].note, "I only collected eight thousand");
    assert.equal(data.declarations[0].snapshotDifferencePaisa, 130_000, "the bug the rider reported");
    assert.equal(data.declarations[0].outstandingPaisa, 214_000, "and what the platform says today");
    assert.equal(data.summary.disputes, 1);

    const statement = db.calls.find((call) => call.sql.includes("FROM `rider_cash_declarations` d"));
    assert.match(String(statement?.sql), /routed_to_review` = 1/u, "only what somebody owes an answer to");
    assert.match(String(statement?.sql), /ORDER BY d\.`created_at` DESC/u, "newest first: a declaration has already lifted the block");
  });

  test("the three kinds are counted, and an empty list is a good morning", async () => {
    const db = dbFor([
      declarationRow(),
      declarationRow({ kind: "ROBBED", snapshot_lines_paisa: null, snapshot_difference_paisa: null }),
    ]);
    const data = (await run(db)).data;
    assert.equal(data.summary.robberies, 1);
    assert.equal(data.summary.disputes, 1);
    assert.equal(data.summary.emergencies, 0);
    assert.equal(data.declarations[1].snapshotDifferencePaisa, null, "a robbery is not a claim about a number");

    const empty = await run(dbFor([]));
    assert.deepEqual(empty.data.declarations, []);
    assert.equal(empty.data.summary.total, 0);
  });
});
