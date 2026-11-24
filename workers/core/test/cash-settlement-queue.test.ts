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
 * The settlement queue's query string (D158).
 *
 * D145's list only ever showed `PENDING`, so "what happened to the settlement this rider is ringing about?" had no
 * route, and the reviewer who wanted the claims already past their deadline had to read the page and count. These tests
 * defend the four questions the query string now answers — which half, which rail, which rider, which breach — and the
 * keyset that pages them in the direction this queue sorts: **greater than** the cursor, not less than it, because this
 * list is oldest first and a copied comparator would page backwards through the most urgent claims.
 */

const ADMIN_HEX = "0193f2a17c3e7890abcdef0123456731";
const RIDER_HEX = "0193f2a17c3e7890abcdef0123456707";
const SETTLEMENT_HEX = "0193f2a17c3e7890abcdef01234567e5";

const bytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
};

const QUEUE_SQL = /FROM `rider_cash_settlements` s JOIN `riders` r/u;

function dbFor(rows: readonly Record<string, unknown>[]): ReturnType<typeof stubDb> {
  return stubDb([{ match: QUEUE_SQL, rows: [...rows] }]);
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
  const url = `https://api.undal.test/v1/finance/cash/settlements${query}`;
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
  const found = CASH_QUEUE_ROUTES.find((candidate) => candidate.path === "/v1/finance/cash/settlements");
  if (found === undefined) throw new Error("no settlement queue route");
  return found;
};

const run = async (
  db: ReturnType<typeof stubDb>,
  query = "",
): Promise<{
  status: number;
  data: Record<string, any>;
  error: Record<string, any> | null;
  sql: string;
  params: readonly unknown[];
}> => {
  const response = await route().run(ctxFor(db, query), { params: {}, body: null, reason: null });
  const parsed = (await response.json()) as { data?: Record<string, any>; error?: Record<string, any> };
  const call = db.calls[db.calls.length - 1];
  return {
    status: response.status,
    data: parsed.data ?? {},
    error: parsed.error ?? null,
    sql: String(call?.sql ?? ""),
    params: call?.params ?? [],
  };
};

const minutesAgo = (minutes: number): string =>
  new Date(Date.now() - minutes * 60_000).toISOString().replace("T", " ").replace("Z", "000");

function settlementRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: bytes(SETTLEMENT_HEX),
    rider_id: bytes(RIDER_HEX),
    full_name: "Karim Rahman",
    code: "RDR-4K2M",
    amount_paisa: 214_000,
    method: "BKASH",
    trx_id: "9H5K2M8P1Q",
    created_at: minutesAgo(4),
    number_matches: 1,
    name_matches: 0,
    screenshot_url: "https://res.cloudinary.com/undal/proof.jpg",
    selfie_url: null,
    is_partial: 0,
    escalated_at: null,
    escalation_note: null,
    status: "PENDING",
    confirmed_at: null,
    rejection_reason: null,
    approved_paisa: null,
    ...overrides,
  };
}

describe("the settlement queue's query string (D158)", () => {
  test("the default is the pending half, oldest first, and a short page is the end of it", async () => {
    const answer = await run(dbFor([settlementRow()]));
    assert.equal(answer.status, 200);
    assert.equal(answer.data.summary.state, "pending");
    assert.equal(answer.data.summary.method, null);
    assert.equal(answer.data.nextCursor, null, "a short page ends the list");
    assert.match(answer.sql, /s\.`status` = 'PENDING'/u);
    assert.match(answer.sql, /ORDER BY s\.`created_at` ASC, s\.`id` ASC/u, "the fairness order, with a tiebreak");
  });

  test("the decided half says what happened: the reason, the amount released, and when", async () => {
    const confirmedAt = minutesAgo(30);
    const answer = await run(
      dbFor([
        settlementRow({
          status: "CONFIRMED",
          confirmed_at: confirmedAt,
          approved_paisa: 200_000,
          is_partial: 1,
        }),
      ]),
      "?state=decided",
    );
    assert.equal(answer.status, 200);
    assert.equal(answer.data.summary.state, "decided");
    assert.match(answer.sql, /s\.`status` <> 'PENDING'/u);
    const row = answer.data.settlements[0];
    assert.equal(row.status, "CONFIRMED");
    assert.equal(row.confirmedAt, confirmedAt);
    assert.equal(row.approvedPaisa, 200_000, "a part-approval released less than the claim");
    assert.equal(row.partial, true);

    const everything = await run(dbFor([settlementRow()]), "?state=all");
    const predicate = everything.sql.split("FROM `rider_cash_settlements`")[1] ?? "";
    assert.doesNotMatch(predicate, /WHERE[^)]*s\.`status` [=<]/u, "`all` asks about neither half");
    assert.doesNotMatch(predicate, /WHERE\s+ORDER BY/u, "and an empty predicate is left out, not written empty");
  });

  test("one rail, one rider, one kind of claim, and the ones already late (D158)", async () => {
    const rail = dbFor([settlementRow()]);
    const byMethod = await run(rail, "?method=nagad&partial=true");
    assert.equal(byMethod.status, 200);
    assert.equal(byMethod.data.summary.method, "NAGAD");
    assert.match(byMethod.sql, /s\.`method` = \?/u);
    assert.match(byMethod.sql, /s\.`is_partial` = \?/u);
    assert.ok(byMethod.params.includes("NAGAD"), "the filter is bound, never interpolated");
    assert.ok(byMethod.params.includes(1), "`partial=true` is 1 in the column");

    const full = await run(dbFor([settlementRow()]), "?partial=false");
    assert.ok(full.params.includes(0));

    const byRider = await run(dbFor([settlementRow()]), `?riderId=${RIDER_HEX}`);
    assert.match(byRider.sql, /s\.`rider_id` = \?/u);
    assert.ok(byRider.params.some((param) => param instanceof Uint8Array));

    const late = await run(dbFor([settlementRow({ created_at: minutesAgo(150) })]), "?breach=true");
    assert.equal(late.status, 200);
    assert.match(late.sql, /s\.`created_at` <= \?/u, "the deadline is in the statement, not a page that happens to contain late claims");
    const threshold = late.params.find((param) => typeof param === "string" && param.startsWith("20"));
    // Two hours before now, as the same `DATETIME(6)` string the flags compare against.
    const expected = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    assert.equal(typeof threshold, "string");
    const hoursApart = Math.abs(Date.parse(String(threshold).replace(" ", "T") + "Z") - expected.getTime());
    assert.ok(hoursApart < 60_000, `the threshold is D142's two hours (off by ${hoursApart}ms)`);
    assert.equal(late.data.settlements[0].slaBreached, true);
  });

  test("a full page hands back a cursor, and this queue resumes upward (D158)", async () => {
    const rows = Array.from({ length: 2 }, (_, index) =>
      settlementRow({ id: bytes(`0193f2a17c3e7890abcdef01234567e${index}`), created_at: minutesAgo(6 - index) }),
    );
    const first = await run(dbFor(rows), "?limit=2");
    assert.equal(first.status, 200);
    const cursor = String(first.data.nextCursor);
    assert.ok(cursor.length > 0, "a full page might have more behind it");

    const lastRow = rows[1] ?? settlementRow();
    const resumed = await run(dbFor([lastRow]), `?limit=2&cursor=${encodeURIComponent(cursor)}`);
    assert.equal(resumed.status, 200);
    assert.match(
      resumed.sql,
      /s\.`created_at` > \? OR \(s\.`created_at` = \? AND s\.`id` > \?\)/u,
      "oldest first means the next page is greater than the cursor, not less",
    );
    const cursorParams = resumed.params.filter((param) => typeof param === "string" && param.startsWith("20"));
    assert.equal(cursorParams[0], lastRow.created_at);
    assert.ok(resumed.params.some((param) => param instanceof Uint8Array), "and after that row's id");
  });

  test("a query string that cannot be honoured is named, not guessed (D158)", async () => {
    const cases: readonly (readonly [string, string])[] = [
      ["?state=settled", "state"],
      ["?method=CARD", "method"],
      ["?partial=maybe", "partial"],
      ["?breach=yes", "breach"],
      ["?cursor=not-a-cursor", "cursor"],
    ];
    for (const [query, field] of cases) {
      const db = dbFor([]);
      const answer = await run(db, query);
      assert.equal(answer.status, 422, `${field} is refused`);
      assert.equal(answer.error?.code, "VALIDATION_FAILED");
      assert.equal(answer.error?.details?.field, field);
      assert.equal(db.calls.length, 0, `${field} is judged before any row is read`);
    }

    const badRider = await run(dbFor([]), "?riderId=nope");
    assert.equal(badRider.status, 422);
    assert.equal(badRider.error?.code, "VALIDATION_ID_MALFORMED");
    assert.equal(badRider.error?.field, "riderId");
  });
});
