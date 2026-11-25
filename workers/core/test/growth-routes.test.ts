/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";
import { GROWTH_ROUTES } from "../src/routes/growth.ts";
import type { Ctx, RouteDefinition } from "../src/middleware/context.ts";
import type { Principal } from "../src/rbac/guard.ts";

/**
 * Campaigns and referrals, read.
 *
 * The tests that matter here are about disclosure, not about filtering: a growth list that any
 * reader of the list key can use to see what the platform spends per city is a report nobody
 * should have written, and the route splits the money out behind its own key. So there are two
 * principals, one with the budget key and one without, and the same statement feeds both.
 */

const CAMPAIGN_ID = new Uint8Array(16).fill(8);
const USER_A = new Uint8Array(16).fill(3);
const USER_B = new Uint8Array(16).fill(4);
const REFERRAL_ID = new Uint8Array(16).fill(9);
const ADMIN_ID = "0193f2a1-7c3e-7890-abcd-ef0123456789";

/** A principal holding, or not holding, a role. */
function principalFor(role: string): Principal {
  return {
    userId: ADMIN_ID,
    actorType: "ADMIN",
    role,
    sessionId: "s",
    deviceId: "d",
    zoneScope: null,
    stepUpAtMs: null,
    impersonating: false,
  };
}

/** The context the router would have built. */
function ctxFor(db: ReturnType<typeof stubDb>, path: string, role = "SUPER_ADMIN"): Ctx {
  return {
    env: testEnv(),
    db,
    url: new URL(`https://api.undal.test${path}`),
    request: new Request(`https://api.undal.test${path}`),
    requestId: "0193f2a1-7c3e-7890-abcd-ef0123456700",
    ip: "1.2.3.4",
    userAgent: "test",
    keys: [],
    principal: principalFor(role),
    locale: "en",
    startedAtMs: Date.now(),
    waitUntil: () => undefined,
  };
}

/** A route from the table. */
function route(path: string): RouteDefinition {
  const found = GROWTH_ROUTES.find((entry) => entry.method === "GET" && entry.path === path);
  assert.notEqual(found, undefined, path);
  return found as RouteDefinition;
}

/** A campaign row as the repository selects it. */
function campaignRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CAMPAIGN_ID,
    name: "Eid rush — Sylhet",
    kind: "DISCOUNT",
    starts_at: "2026-11-20 00:00:00.000000",
    ends_at: "2026-11-30 23:59:59.000000",
    active: 1,
    created_at: "2026-11-01 09:00:00.000000",
    updated_at: "2026-11-20 09:00:00.000000",
    budget_period: "2026-11",
    budget_paisa: 5_000_000,
    spent_paisa: 1_250_000,
    redemptions: 42,
    redeemed_paisa: 1_250_000,
    ...overrides,
  };
}

/** A referral row. */
function referralRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: REFERRAL_ID,
    referrer_id: USER_A,
    referee_id: USER_B,
    code: "UNDAL7K2",
    status: "QUALIFIED",
    reward_paisa: 100_000,
    qualified_at: "2026-11-18 12:00:00.000000",
    created_at: "2026-11-10 12:00:00.000000",
    ...overrides,
  };
}

/** A database that answers both readers. */
function dbWith(options: {
  readonly campaigns?: readonly Record<string, unknown>[];
  readonly referrals?: readonly Record<string, unknown>[];
  readonly tally?: readonly Record<string, unknown>[];
} = {}) {
  return stubDb([
    { match: /FROM `campaigns` `c`/u, rows: [...(options.campaigns ?? [])] },
    { match: /FROM `referrals` `x`/u, rows: [...(options.referrals ?? [])] },
    { match: /FROM `referrals` GROUP BY `status`/u, rows: [...(options.tally ?? [])] },
  ]);
}

describe("the growth route table", () => {
  test("declares two readers, each behind its own list key, and neither a write", () => {
    assert.deepEqual(
      GROWTH_ROUTES.map((entry) => `${entry.method} ${entry.path} ${entry.permission}`),
      ["GET /v1/campaigns promo.campaign.list", "GET /v1/referrals promo.referral.list"],
    );
    assert.equal(route("/v1/campaigns").write, undefined);
    assert.equal(route("/v1/referrals").write, undefined);
  });
});

describe("listing campaigns", () => {
  test("carries the budget and what is left of it", async () => {
    const db = dbWith({ campaigns: [campaignRow()] });
    const response = await route("/v1/campaigns").run(ctxFor(db, "/v1/campaigns"), { params: {}, body: undefined, reason: null });
    const body = (await response.json()) as {
      data: { campaigns: Array<Record<string, unknown>>; budgetVisible: boolean };
    };
    assert.equal(response.status, 200);
    assert.equal(body.data.budgetVisible, true);
    const campaign = body.data.campaigns[0] as Record<string, unknown>;
    assert.equal(campaign["id"], "08080808080808080808080808080808");
    assert.deepEqual(campaign["budget"], {
      period: "2026-11",
      budgetPaisa: 5_000_000,
      spentPaisa: 1_250_000,
      remainingPaisa: 3_750_000,
    });
    assert.equal(campaign["redemptions"], 42);
    assert.equal(campaign["active"], true);
  });

  test("hides the money from a principal without the budget key", async () => {
    // A finding, recorded rather than hidden: every system role that may list campaigns also
    // holds `promo.campaign.view_budget`, so today this branch is reached by a role string the
    // register does not know — a custom role, or a role that has been renamed. The test drives
    // the handler with one, because the gate is the route's promise and the promise must hold
    // even while the role model makes it moot.
    const db = dbWith({ campaigns: [campaignRow()] });
    const response = await route("/v1/campaigns").run(ctxFor(db, "/v1/campaigns", "GROWTH_REVIEWER"), {
      params: {},
      body: undefined,
      reason: null,
    });
    const body = (await response.json()) as {
      data: { campaigns: Array<Record<string, unknown>>; budgetVisible: boolean };
    };
    assert.equal(body.data.budgetVisible, false);
    const campaign = body.data.campaigns[0] as Record<string, unknown>;
    assert.equal(campaign["budget"], undefined);
    assert.equal(campaign["redeemedPaisa"], undefined);
    // The count stays: how many times a campaign was used is not a spend figure.
    assert.equal(campaign["redemptions"], 42);
  });

  test("a campaign with no budget row is not a campaign with no budget", async () => {
    const db = dbWith({
      campaigns: [campaignRow({ budget_period: null, budget_paisa: null, spent_paisa: null, redemptions: 0, redeemed_paisa: 0 })],
    });
    const response = await route("/v1/campaigns").run(ctxFor(db, "/v1/campaigns"), { params: {}, body: undefined, reason: null });
    const body = (await response.json()) as { data: { campaigns: Array<{ budget: { remainingPaisa: number | null } }> } };
    assert.equal(body.data.campaigns[0]?.budget.remainingPaisa, null);
  });

  test("the filters reach the statement as bound parameters", async () => {
    const db = dbWith({ campaigns: [] });
    await route("/v1/campaigns").run(ctxFor(db, "/v1/campaigns?active=true&kind=discount&q=eid&limit=10"), {
      params: {},
      body: undefined,
      reason: null,
    });
    assert.deepEqual(db.calls[0]?.params, [1, "DISCOUNT", "%eid%", 10]);
  });

  test("refuses an active flag that is neither true nor false, a kind it does not have, and a page size outside the budget", async () => {
    for (const query of ["active=yes", "kind=COUPON", "limit=0", "limit=201"]) {
      const response = await route("/v1/campaigns").run(ctxFor(dbWith({ campaigns: [] }), `/v1/campaigns?${query}`), {
        params: {},
        body: undefined,
        reason: null,
      });
      assert.equal(response.status, 422, query);
    }
  });
});

describe("listing referrals", () => {
  const tally = [
    { status: "PENDING", n: 4, owed: 400_000 },
    { status: "QUALIFIED", n: 2, owed: 200_000 },
    { status: "REWARDED", n: 9, owed: 900_000 },
    { status: "VOID", n: 1, owed: 100_000 },
  ];

  test("returns the page, the table's tally and the reward the queue owes", async () => {
    const db = dbWith({ referrals: [referralRow()], tally });
    const response = await route("/v1/referrals").run(ctxFor(db, "/v1/referrals"), { params: {}, body: undefined, reason: null });
    const body = (await response.json()) as {
      data: {
        referrals: Array<Record<string, unknown>>;
        tally: Record<string, number>;
        payoutsVisible: boolean;
      };
    };
    assert.equal(response.status, 200);
    assert.equal(body.data.referrals[0]?.["code"], "UNDAL7K2");
    // Two ids and no names: a growth report is not a place to read somebody's phone number.
    assert.equal(body.data.referrals[0]?.["referrerId"], "03030303030303030303030303030303");
    assert.deepEqual(body.data.tally, { pending: 4, qualified: 2, rewarded: 9, void: 1, owedPaisa: 200_000 });
    assert.equal(body.data.payoutsVisible, true);
  });

  test("hides what the queue owes from a reader without the payout key", async () => {
    const db = dbWith({ referrals: [referralRow()], tally });
    const response = await route("/v1/referrals").run(ctxFor(db, "/v1/referrals", "DISPATCHER"), {
      params: {},
      body: undefined,
      reason: null,
    });
    const body = (await response.json()) as { data: { tally: Record<string, number>; payoutsVisible: boolean } };
    assert.equal(body.data.payoutsVisible, false);
    assert.equal(body.data.tally["owedPaisa"], undefined);
    assert.equal(body.data.tally["qualified"], 2);
  });

  test("counts qualified rewards as owed, and nothing else", async () => {
    // PENDING is not yet earned, REWARDED is already paid, VOID will never be paid.
    const db = dbWith({ referrals: [], tally });
    const response = await route("/v1/referrals").run(ctxFor(db, "/v1/referrals"), { params: {}, body: undefined, reason: null });
    const body = (await response.json()) as { data: { tally: { owedPaisa: number } } };
    assert.equal(body.data.tally.owedPaisa, 200_000);
  });

  test("a full page offers the cursor it stopped at", async () => {
    const rows = [
      referralRow({ id: new Uint8Array(16).fill(1), created_at: "2026-11-10 12:00:00.000000" }),
      referralRow({ id: new Uint8Array(16).fill(2), created_at: "2026-11-09 12:00:00.000000" }),
    ];
    const db = dbWith({ referrals: rows, tally });
    const response = await route("/v1/referrals").run(ctxFor(db, "/v1/referrals?limit=2"), {
      params: {},
      body: undefined,
      reason: null,
    });
    const body = (await response.json()) as { data: { nextCursor: string | null } };
    assert.equal(typeof body.data.nextCursor, "string");
  });

  test("refuses a status the schema does not have, and a bad cursor", async () => {
    for (const query of ["status=PAID", "cursor=not-a-cursor"]) {
      const response = await route("/v1/referrals").run(ctxFor(dbWith({ referrals: [], tally }), `/v1/referrals?${query}`), {
        params: {},
        body: undefined,
        reason: null,
      });
      assert.equal(response.status, 422, query);
    }
  });

  test("an empty queue is a 200 with zeroes", async () => {
    const db = dbWith({ referrals: [], tally: [] });
    const response = await route("/v1/referrals").run(ctxFor(db, "/v1/referrals"), { params: {}, body: undefined, reason: null });
    const body = (await response.json()) as { data: { referrals: unknown[]; tally: Record<string, number> } };
    assert.deepEqual(body.data.referrals, []);
    assert.equal(body.data.tally["pending"], 0);
    assert.equal(body.data.tally["owedPaisa"], 0);
  });
});