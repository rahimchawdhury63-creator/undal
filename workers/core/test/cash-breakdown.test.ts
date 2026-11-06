/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";
import { CASH_ROUTES } from "../src/routes/cash.ts";
import type { Ctx } from "../src/middleware/context.ts";
import type { Principal } from "../src/rbac/guard.ts";

/**
 * The deliveries behind `cash_in_hand` (D150).
 *
 * `25 §8` names the failure this route exists for: a bug produces a wrong `cash_in_hand`, and "the order-by-order list
 * makes the error visible to both sides". So these tests are about arithmetic that agrees, arithmetic that visibly does
 * not, and the attribution rule — `order_assignments.end_reason = 'DELIVERED'`, never `orders.rider_id`, which is
 * whoever holds the order now and not who delivered it.
 */

const USER_HEX = "0193f2a17c3e7890abcdef0123456701";
const RIDER_HEX = "0193f2a17c3e7890abcdef0123456707";
const ORDER_HEX = "0193f2a17c3e7890abcdef0123456800";

const bytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
};

const RIDER = { id: bytes(RIDER_HEX), code: "RDR-4K2M", status: "APPROVED", shift_state: "CASH_LOCKED" };

interface Options {
  readonly lines?: readonly Record<string, unknown>[];
  readonly linesTotal?: number;
  readonly collected?: number;
  readonly outstanding?: number;
}

function dbFor(options: Options = {}): ReturnType<typeof stubDb> {
  return stubDb([
    { match: /FROM `riders` WHERE `user_id`/u, rows: [RIDER] },
    // The total first: its statement also joins `orders`, so a looser matcher above it would swallow the sum.
    { match: /SUM\(o\.`cash_collected_paisa`\) AS `total`/u, rows: [{ total: options.linesTotal ?? 0 }] },
    { match: /FROM `order_assignments` a JOIN `orders` o/u, rows: [...(options.lines ?? [])] },
    { match: /SELECT `collected_paisa` FROM `rider_cash_balances`/u, rows: [{ collected_paisa: options.collected ?? 0 }] },
    { match: /outstanding_paisa` FROM `rider_cash_balances`/u, rows: [{ outstanding_paisa: options.outstanding ?? 0 }] },
  ]);
}

const PRINCIPAL = {
  userId: USER_HEX,
  actorType: "RIDER",
  role: "RIDER",
  zoneScope: [],
  sessionId: "0193f2a17c3e7890abcdef01234567ff",
} as unknown as Principal;

function ctxFor(db: ReturnType<typeof stubDb>, query = ""): Ctx {
  const url = `https://api.undal.test/v1/rider/cash/breakdown${query}`;
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
  const found = CASH_ROUTES.find((candidate) => candidate.path === "/v1/rider/cash/breakdown");
  if (found === undefined) throw new Error("no breakdown route");
  return found;
};

const line = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: bytes(ORDER_HEX),
  code: "UND-8F2K",
  cash_collected_paisa: 84_000,
  ended_at: "2026-11-06 22:14:00.000000",
  ...overrides,
});

describe("GET /v1/rider/cash/breakdown (D150)", () => {
  test("the deliveries add up to the number, and the rider can check it", async () => {
    const db = dbFor({ lines: [line(), line({ id: bytes("0193f2a17c3e7890abcdef0123456801"), code: "UND-9Q1M", cash_collected_paisa: 130_000 })], linesTotal: 214_000, collected: 214_000, outstanding: 214_000 });
    const response = await route().run(ctxFor(db), { params: {}, body: null, reason: null });
    assert.equal(response.status, 200);
    const data = ((await response.json()) as { data: Record<string, any> }).data;
    assert.equal(data.deliveries.length, 2);
    assert.equal(data.deliveries[0].cashPaisa, 84_000);
    assert.equal(data.deliveries[0].code, "UND-8F2K");
    assert.equal(data.linesPaisa, 214_000);
    assert.equal(data.collectedPaisa, 214_000);
    assert.equal(data.differencePaisa, 0);
    assert.equal(data.truncated, false);
  });

  test("a disagreement is surfaced, not hidden, because that is the point of the screen", async () => {
    const db = dbFor({ lines: [line()], linesTotal: 84_000, collected: 214_000, outstanding: 214_000 });
    const response = await route().run(ctxFor(db), { params: {}, body: null, reason: null });
    const data = ((await response.json()) as { data: Record<string, number> }).data;
    assert.equal(data.differencePaisa, 130_000, "the platform shows its own arithmetic disagreeing");
  });

  test("attribution is the assignment's end reason, not whoever holds the order now", async () => {
    const db = dbFor({ lines: [], linesTotal: 0, collected: 0 });
    await route().run(ctxFor(db), { params: {}, body: null, reason: null });
    const sql = db.calls.map((call) => call.sql).join("\n");
    assert.match(sql, /end_reason` = 'DELIVERED'/u);
    assert.match(sql, /order_assignments/u);
    assert.doesNotMatch(sql, /o\.`rider_id`/u, "the order's rider is who has it now, not who delivered it");
  });

  test("a long history is paged, and the total is not", async () => {
    const db = dbFor({ lines: [line()], linesTotal: 940_000, collected: 214_000 });
    const response = await route().run(ctxFor(db, "?limit=1"), { params: {}, body: null, reason: null });
    const data = ((await response.json()) as { data: Record<string, any> }).data;
    assert.equal(data.truncated, true, "one row of a cap of one: there is more history than the page holds");
    assert.equal(data.linesPaisa, 940_000, "the page is capped and the total is not");
    assert.equal(db.calls.find((call) => call.sql.includes("SUM(o.`cash_collected_paisa`)"))?.params.length, 1);
  });

  test("a rider who has collected nothing gets an empty list, not an error", async () => {
    const db = dbFor({ lines: [], linesTotal: 0, collected: 0, outstanding: 0 });
    const response = await route().run(ctxFor(db), { params: {}, body: null, reason: null });
    assert.equal(response.status, 200);
    const data = ((await response.json()) as { data: Record<string, any> }).data;
    assert.deepEqual(data.deliveries, []);
    assert.equal(data.differencePaisa, 0);
  });
});
