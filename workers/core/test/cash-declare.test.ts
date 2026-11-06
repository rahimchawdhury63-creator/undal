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
import { EMERGENCY_COOLDOWN_MS, EMERGENCY_LIFT_MS } from "../src/domain/rider/cash.ts";

/**
 * `25 §7`'s first button: "I have an emergency" (D148).
 *
 * The section's closing rule is what these tests defend — *"The block exists to collect money from people who have it and
 * are about to go home, not to punish people who do not"* — so the assertions are about who is let through, for how
 * long, and what the platform still expects to be paid afterwards. The cooldown is the one place where the button can be
 * used as a way out of paying, and `§7` answers that with a person rather than a refusal, which is a test in itself.
 */

const USER_HEX = "0193f2a17c3e7890abcdef0123456701";
const RIDER_HEX = "0193f2a17c3e7890abcdef0123456707";
const ZONE_HEX = "0193f2a17c3e7890abcdef0123456703";

const bytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
};

const RIDER = {
  id: bytes(RIDER_HEX),
  code: "RDR-4K2M",
  status: "APPROVED",
  shift_state: "CASH_LOCKED",
  home_zone_id: bytes(ZONE_HEX),
  vehicle: "MOTORBIKE",
};

interface Options {
  readonly outstanding?: number;
  /** When the rider last declared an emergency, as `created_at` text, or absent. */
  readonly lastEmergencyAt?: string | null;
}

function dbFor(options: Options = {}): ReturnType<typeof stubDb> {
  return stubDb([
    { match: /FROM `riders` WHERE `user_id`/u, rows: [RIDER] },
    {
      match: /outstanding_paisa` FROM `rider_cash_balances`/u,
      rows: [{ outstanding_paisa: options.outstanding ?? 214_000 }],
    },
    {
      match: /SELECT `id`, `kind`, `note`, `lifted_until`, `routed_to_review`, `created_at` FROM `rider_cash_declarations`/u,
      rows:
        options.lastEmergencyAt === undefined || options.lastEmergencyAt === null
          ? []
          : [{ id: bytes(RIDER_HEX), kind: "EMERGENCY", note: null, lifted_until: null, routed_to_review: 0, created_at: options.lastEmergencyAt }],
    },
    { match: /INSERT INTO `rider_cash_declarations`/u, affectedRows: 1 },
    { match: /FROM `audit_log`/u, rows: [] },
    { match: /INSERT INTO `audit_log`/u, affectedRows: 1 },
  ]);
}

const PRINCIPAL = {
  userId: USER_HEX,
  actorType: "RIDER",
  role: "RIDER",
  zoneScope: [],
  sessionId: "0193f2a17c3e7890abcdef01234567ff",
} as unknown as Principal;

function ctxFor(db: ReturnType<typeof stubDb>): Ctx {
  return {
    env: testEnv(),
    db,
    url: new URL("https://api.undal.test/v1/rider/cash/declare"),
    request: new Request("https://api.undal.test/v1/rider/cash/declare", { method: "POST" }),
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

const route = (path: string) => {
  const found = CASH_ROUTES.find((candidate) => candidate.path === path);
  if (found === undefined) throw new Error(`no route ${path}`);
  return found;
};

const declare = (db: ReturnType<typeof stubDb>, body: unknown) =>
  route("/v1/rider/cash/declare").run(ctxFor(db), { params: {}, body, reason: null });

describe("declaring an emergency (D148)", () => {
  test("one tap lifts the block for a day, and the debt stays exactly where it was", async () => {
    const db = dbFor({ outstanding: 214_000 });
    const response = await declare(db, { kind: "EMERGENCY", note: "hospital, will settle tomorrow" });
    assert.equal(response.status, 200);
    const data = ((await response.json()) as { data: Record<string, any> }).data;
    assert.equal(data.released, true);
    assert.equal(data.stillOwedPaisa, 214_000, "§7 lifts the block; it does not forgive the money");
    assert.equal(data.declaration.routedToReview, false);

    const lift = Date.parse(data.declaration.liftedUntil) - Date.now();
    assert.ok(Math.abs(lift - EMERGENCY_LIFT_MS) < 5_000, "twenty-four hours, not a shift boundary");

    const insert = db.calls.find((call) => call.sql.includes("INSERT INTO `rider_cash_declarations`"));
    assert.ok(insert !== undefined);
    assert.equal(insert.params[2], "EMERGENCY");
    assert.equal(insert.params[5], 0, "the first use in thirty days is not a pattern");

    const auditRow = db.calls.find((call) => call.sql.includes("INSERT INTO `audit_log`"));
    assert.equal(auditRow?.params[9], "rider.cash.declare");
    assert.equal(auditRow?.params[15], null, "the register is a list of admin reasons, and this is the rider's own word");
    assert.equal(auditRow?.params[16], "NOTICE");
  });

  test("the second use inside thirty days still lifts, and wakes somebody up", async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1_000).toISOString().replace("T", " ").replace("Z", "000");
    const db = dbFor({ outstanding: 214_000, lastEmergencyAt: tenDaysAgo });
    const response = await declare(db, { kind: "EMERGENCY" });
    assert.equal(response.status, 200, "§7 routes the second use to a human; it does not refuse it");
    const data = ((await response.json()) as { data: Record<string, any> }).data;
    assert.equal(data.released, true);
    assert.equal(data.declaration.routedToReview, true);
    const insert = db.calls.find((call) => call.sql.includes("INSERT INTO `rider_cash_declarations`"));
    assert.equal(insert?.params[5], 1, "marked for the morning's review list, not blocked");
    const auditRow = db.calls.find((call) => call.sql.includes("INSERT INTO `audit_log`"));
    assert.equal(auditRow?.params[16], "WARNING");
  });

  test("a use outside the cooldown is the first use again", async () => {
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1_000).toISOString().replace("T", " ").replace("Z", "000");
    const db = dbFor({ outstanding: 214_000, lastEmergencyAt: fortyDaysAgo });
    const response = await declare(db, { kind: "EMERGENCY" });
    const data = ((await response.json()) as { data: Record<string, any> }).data;
    assert.equal(data.declaration.routedToReview, false);
  });

  test("the two buttons without machinery say so, and a rider who owes nothing is told that instead", async () => {
    for (const kind of ["ROBBED", "DISPUTE"]) {
      const response = await declare(dbFor({ outstanding: 214_000 }), { kind });
      assert.equal(response.status, 501, `${kind} needs a case and an order list that do not exist yet`);
      assert.equal(((await response.json()) as { error: { code: string } }).error.code, "NOT_IMPLEMENTED");
    }

    const invented = await declare(dbFor({ outstanding: 214_000 }), { kind: "SICK" });
    assert.equal(invented.status, 422);
    const details = ((await invented.json()) as { error: { details: unknown } }).error.details;
    assert.deepEqual(details, { field: "kind", allowed: ["EMERGENCY"] });

    const clear = await declare(dbFor({ outstanding: 0 }), { kind: "EMERGENCY" });
    assert.equal(clear.status, 409, "there is nothing to be unable to settle");
  });
});
