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
import {
  AUTO_LIFT_MS,
  autoLiftDue,
  BKASH_NUMBER_PATTERN,
  checkClaim,
  nameSimilarity,
  NAME_MATCH_THRESHOLD,
  normaliseTrxId,
  parseSettlement,
  sameNumber,
  TRX_ID_PATTERN,
} from "../src/domain/rider/cash.ts";

/**
 * The rider's cash: the number they are blocked on, and the claim they submit to clear it (`25`, D140–D141).
 *
 * The blocking screen is the most coercive surface in the platform, so what these tests defend is the *fairness* of the
 * two answers: a rider can read what they owe without being blocked on it, a submission that is retried is not a second
 * payment, a TrxID that has been used before is refused because it would settle two debts, and a name or number that
 * does not match is a flag for a human rather than a wall the rider cannot climb.
 */

const USER_HEX = "0193f2a17c3e7890abcdef0123456701";
const RIDER_HEX = "0193f2a17c3e7890abcdef0123456707";
const ZONE_HEX = "0193f2a17c3e7890abcdef0123456703";
const SHIFT_HEX = "0193f2a17c3e7890abcdef01234567c0";
const OTHER_RIDER_HEX = "0193f2a17c3e7890abcdef0123456722";

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

const ON_FILE = {
  payout_number: "01812345678",
  payout_name: "Karim Rahman",
  full_name: "Md Karim Rahman",
};

interface Options {
  readonly rider?: Record<string, unknown> | null;
  readonly outstanding?: number | null;
  /** When the last shift ended: the instant the obligation began. */
  readonly endedAt?: string | null;
  readonly identity?: Record<string, unknown> | null;
  /** The row a `trx_id` lookup finds, if any. */
  readonly byTrx?: Record<string, unknown> | null;
  /** The rider's settlement under review, if any. */
  readonly pending?: Record<string, unknown> | null;
  /** The rider's most recent settlement of any status. */
  readonly latest?: Record<string, unknown> | null;
  readonly shiftId?: boolean;
}

function settlementRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: bytes("0193f2a17c3e7890abcdef01234567f0"),
    rider_id: bytes(RIDER_HEX),
    amount_paisa: 214_000,
    method: "BKASH",
    trx_id: "9H5K2M8P1Q",
    status: "PENDING",
    created_at: "2026-11-06 20:41:00.000000",
    ...overrides,
  };
}

function dbFor(options: Options = {}): ReturnType<typeof stubDb> {
  const rider = options.rider === undefined ? RIDER : options.rider;
  const identity = options.identity === undefined ? ON_FILE : options.identity;
  return stubDb([
    { match: /FROM `riders` WHERE `user_id`/u, rows: rider === null ? [] : [rider] },
    { match: /FROM `riders` WHERE `id`/u, rows: identity === null ? [] : [identity] },
    {
      match: /outstanding_paisa` FROM `rider_cash_balances`/u,
      rows: options.outstanding === undefined || options.outstanding === null ? [] : [{ outstanding_paisa: options.outstanding }],
    },
    { match: /MAX\(`ended_at`\)/u, rows: [{ ended_at: options.endedAt ?? null }] },
    { match: /FROM `rider_shifts` WHERE `rider_id` = \? ORDER BY `started_at`/u, rows: options.shiftId === false ? [] : [{ id: bytes(SHIFT_HEX) }] },
    { match: /FROM `rider_cash_settlements` WHERE `trx_id`/u, rows: options.byTrx === undefined || options.byTrx === null ? [] : [options.byTrx] },
    { match: /`status` = 'PENDING' ORDER BY/u, rows: options.pending === undefined || options.pending === null ? [] : [options.pending] },
    { match: /FROM `rider_cash_settlements` WHERE `rider_id` = \? ORDER BY/u, rows: options.latest === undefined || options.latest === null ? [] : [options.latest] },
    { match: /INSERT INTO `rider_cash_settlements`/u, affectedRows: 1 },
    { match: /FROM `audit_log`/u, rows: [] },
    { match: /INSERT INTO `audit_log`/u, affectedRows: 1 },
  ]);
}

const PRINCIPAL: Principal = {
  userId: USER_HEX,
  actorType: "RIDER",
  role: "RIDER",
  zoneScope: [],
  sessionId: "0193f2a17c3e7890abcdef01234567ff",
} as unknown as Principal;

function ctxFor(db: ReturnType<typeof stubDb>, path: string): Ctx {
  return {
    env: testEnv(),
    db,
    url: new URL(`https://api.undal.test${path}`),
    request: new Request(`https://api.undal.test${path}`),
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

const CLAIM = {
  trxId: "9H5K2M8P1Q",
  bkashNumber: "01812345678",
  accountName: "Karim Rahman",
  screenshotUrl: "https://res.cloudinary.com/undal/bkash-9h5k2m8p1q.png",
  selfieUrl: "https://i.ibb.co/undal/rider-selfie.jpg",
  amountPaisa: 214_000,
};

async function submit(db: ReturnType<typeof stubDb>, body: unknown): Promise<{ status: number; data: Record<string, unknown>; code?: string; details?: Record<string, unknown> }> {
  const response = await route("/v1/rider/cash/settle").run(ctxFor(db, "/v1/rider/cash/settle"), {
    params: {},
    body,
    reason: null,
  });
  const parsed = (await response.json()) as Record<string, unknown>;
  const error = parsed["error"] as { code?: string; details?: Record<string, unknown> } | undefined;
  return {
    status: response.status,
    data: (parsed["data"] ?? {}) as Record<string, unknown>,
    ...(error === undefined ? {} : { code: String(error.code ?? ""), details: error.details ?? {} }),
  };
}

describe("reading the claim (D141)", () => {
  test("a complete submission becomes a draft, with the transaction ID normalised", () => {
    const parsed = parseSettlement({ ...CLAIM, trxId: "  9h5k2m8p1q " });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.draft.trxId, "9H5K2M8P1Q", "bKash prints upper case; a phone keyboard may not");
    assert.equal(parsed.draft.method, "BKASH", "the only method the screen offers");
    assert.equal(parsed.draft.amountPaisa, 214_000);
  });

  test("the refusals are the fields the screen is looking at", () => {
    const cases: readonly { body: unknown; code: string; field?: string }[] = [
      { body: null, code: "VALIDATION_FAILED", field: "body" },
      { body: { ...CLAIM, trxId: "9H5K2M8P" }, code: "CASH_TRXID_INVALID" },
      { body: { ...CLAIM, trxId: "9H5K2M8P1QZ" }, code: "CASH_TRXID_INVALID" },
      { body: { ...CLAIM, trxId: "9H5K2M8P1-" }, code: "CASH_TRXID_INVALID" },
      { body: { ...CLAIM, bkashNumber: "0181234567" }, code: "VALIDATION_PHONE_INVALID", field: "bkashNumber" },
      { body: { ...CLAIM, bkashNumber: "02812345678" }, code: "VALIDATION_PHONE_INVALID", field: "bkashNumber" },
      { body: { ...CLAIM, accountName: "   " }, code: "VALIDATION_REQUIRED", field: "accountName" },
      { body: { ...CLAIM, screenshotUrl: undefined }, code: "VALIDATION_REQUIRED", field: "screenshotUrl" },
      { body: { ...CLAIM, screenshotUrl: "http://insecure.example/x.png" }, code: "VALIDATION_REQUIRED", field: "screenshotUrl" },
      { body: { ...CLAIM, selfieUrl: undefined }, code: "CASH_SELFIE_REQUIRED" },
      { body: { ...CLAIM, amountPaisa: 1.5 }, code: "VALIDATION_RANGE", field: "amountPaisa" },
      { body: { ...CLAIM, amountPaisa: -1 }, code: "VALIDATION_RANGE", field: "amountPaisa" },
      { body: { ...CLAIM, method: "PAYPAL" }, code: "VALIDATION_ENUM", field: "method" },
    ];
    for (const { body, code, field } of cases) {
      const parsed = parseSettlement(body);
      assert.equal(parsed.ok, false, JSON.stringify(body));
      if (parsed.ok) continue;
      assert.equal(parsed.code, code, JSON.stringify(body));
      if (field !== undefined) assert.equal(parsed.details["field"], field, JSON.stringify(body));
    }
  });

  test("the patterns are the ones the message quotes", () => {
    assert.equal(TRX_ID_PATTERN.test(normaliseTrxId("9h5k2m8p1q")), true);
    assert.equal(TRX_ID_PATTERN.test("9H5K2M8P1QQ"), false);
    assert.equal(BKASH_NUMBER_PATTERN.test("01712345678"), true);
    assert.equal(BKASH_NUMBER_PATTERN.test("01212345678"), false, "no operator uses 012");
  });
});

describe("the two-hour rule (D142)", () => {
  const submitted = Date.parse("2026-11-06T20:41:00.000Z");

  test("nothing pending is never due, and neither is a claim inside the window", () => {
    assert.equal(autoLiftDue(null, submitted + 10 * AUTO_LIFT_MS), false, "no claim, no wait");
    assert.equal(autoLiftDue(submitted, submitted), false);
    assert.equal(autoLiftDue(submitted, submitted + AUTO_LIFT_MS - 1), false, "one second early is still blocked");
  });

  test("the boundary is the rule, and a clock it cannot read is not a release", () => {
    assert.equal(autoLiftDue(submitted, submitted + AUTO_LIFT_MS), true);
    assert.equal(autoLiftDue(submitted, submitted + 5 * AUTO_LIFT_MS), true);
    assert.equal(autoLiftDue(Number.NaN, submitted), false, "the block is the only collection mechanism; no guesses");
  });

  test("the read reports the effective block rather than the stored one", async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1_000).toISOString().replace("T", " ").replace("Z", "000");
    const db = dbFor({ outstanding: 214_000, latest: settlementRow({ created_at: threeHoursAgo }) });
    const response = await route("/v1/rider/cash").run(ctxFor(db, "/v1/rider/cash"), { params: {}, body: null, reason: null });
    const parsed = (await response.json()) as { data: { locked: boolean; autoLiftDue: boolean; shiftState: string } };
    assert.equal(parsed.data.locked, false, "the screen must not show a wall the platform has already dropped");
    assert.equal(parsed.data.autoLiftDue, true);
    assert.equal(parsed.data.shiftState, "CASH_LOCKED", "stored state is unchanged: a read writes nothing");
  });

  test("a fresh submission keeps the block, and a rider with no claim keeps it without a deadline", async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1_000).toISOString().replace("T", " ").replace("Z", "000");
    const fresh = dbFor({ outstanding: 214_000, latest: settlementRow({ created_at: fiveMinutesAgo }) });
    const first = (await (await route("/v1/rider/cash").run(ctxFor(fresh, "/v1/rider/cash"), { params: {}, body: null, reason: null })).json()) as {
      data: { locked: boolean; autoLiftDue: boolean };
    };
    assert.equal(first.data.locked, true);
    assert.equal(first.data.autoLiftDue, false);

    const none = dbFor({ outstanding: 214_000 });
    const second = (await (await route("/v1/rider/cash").run(ctxFor(none, "/v1/rider/cash"), { params: {}, body: null, reason: null })).json()) as {
      data: { locked: boolean; autoLiftDue: boolean };
    };
    assert.equal(second.data.locked, true, "never submitted, so nobody is making them wait");
    assert.equal(second.data.autoLiftDue, false);
  });
});

describe("the refusal the rider can read (D144)", () => {
  test("a rejected claim reaches the blocking screen with its reason and its sentence", async () => {
    const db = dbFor({
      outstanding: 214_000,
      latest: settlementRow({
        status: "REJECTED",
        rejection_reason: "SCREENSHOT_MISMATCH",
        rejection_note: "the screenshot shows a different transaction",
      }),
    });
    const response = await route("/v1/rider/cash").run(ctxFor(db, "/v1/rider/cash"), { params: {}, body: null, reason: null });
    const parsed = (await response.json()) as {
      data: { locked: boolean; settlement: { status: string; rejectionReason: string; rejectionNote: string } };
    };
    assert.equal(parsed.data.locked, true, "a refusal is the platform saying \"not this evidence\", not \"never mind\"");
    assert.equal(parsed.data.settlement.rejectionReason, "SCREENSHOT_MISMATCH");
    assert.equal(parsed.data.settlement.rejectionNote, "the screenshot shows a different transaction");
  });

  test("an approval carries no refusal, and the fields are null rather than empty strings", async () => {
    const db = dbFor({ outstanding: 0, latest: settlementRow({ status: "CONFIRMED" }) });
    const response = await route("/v1/rider/cash").run(ctxFor(db, "/v1/rider/cash"), { params: {}, body: null, reason: null });
    const parsed = (await response.json()) as { data: { settlement: { rejectionReason: unknown; rejectionNote: unknown } } };
    assert.equal(parsed.data.settlement.rejectionReason, null);
    assert.equal(parsed.data.settlement.rejectionNote, null);
  });
});

describe("the escalation the rider is told about (D146)", () => {
  test("a recent claim that a reviewer escalated is not a block, and the app is told which release it is", async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1_000).toISOString().replace("T", " ").replace("Z", "000");
    const db = dbFor({ outstanding: 214_000, latest: settlementRow({ created_at: fiveMinutesAgo, escalated_at: fiveMinutesAgo }) });
    const response = await route("/v1/rider/cash").run(ctxFor(db, "/v1/rider/cash"), { params: {}, body: null, reason: null });
    const parsed = (await response.json()) as {
      data: { locked: boolean; escalated: boolean; autoLiftDue: boolean; cashInHandPaisa: number; shiftState: string };
    };
    assert.equal(parsed.data.locked, false, "somebody is looking into it, so the rider is not waiting");
    assert.equal(parsed.data.escalated, true);
    assert.equal(parsed.data.autoLiftDue, false, "a reviewer was on it in time; this is not the platform being slow");
    assert.equal(parsed.data.cashInHandPaisa, 214_000, "the debt is still on the books");
    assert.equal(parsed.data.shiftState, "CASH_LOCKED", "the stored state is history; the lift is computed");
  });

  test("an escalation beats the clock: a three-hour-old escalated claim is not a platform failure", async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1_000).toISOString().replace("T", " ").replace("Z", "000");
    const db = dbFor({ outstanding: 214_000, latest: settlementRow({ created_at: threeHoursAgo, escalated_at: threeHoursAgo }) });
    const response = await route("/v1/rider/cash").run(ctxFor(db, "/v1/rider/cash"), { params: {}, body: null, reason: null });
    const parsed = (await response.json()) as { data: { escalated: boolean; autoLiftDue: boolean } };
    assert.equal(parsed.data.escalated, true);
    assert.equal(parsed.data.autoLiftDue, false, "25 §10 counts auto-lifts against operations, and a human replied");
  });
});

describe("what was accepted, when it is not what was claimed (D147)", () => {
  test("a partial approval reaches the rider as two numbers, because the difference is what they still owe", async () => {
    const db = dbFor({
      outstanding: 114_000,
      latest: settlementRow({ status: "CONFIRMED", approved_paisa: 100_000 }),
    });
    const response = await route("/v1/rider/cash").run(ctxFor(db, "/v1/rider/cash"), { params: {}, body: null, reason: null });
    const parsed = (await response.json()) as {
      data: { settlement: { amountPaisa: number; approvedPaisa: number }; cashInHandPaisa: number };
    };
    assert.equal(parsed.data.settlement.amountPaisa, 214_000);
    assert.equal(parsed.data.settlement.approvedPaisa, 100_000);
    assert.equal(parsed.data.cashInHandPaisa, 114_000, "confirmed and still owing is the state the screen must explain");
  });

  test("a claim nobody accepted has no accepted amount, which is not the same as zero", async () => {
    const db = dbFor({ outstanding: 214_000, latest: settlementRow({ status: "PENDING" }) });
    const response = await route("/v1/rider/cash").run(ctxFor(db, "/v1/rider/cash"), { params: {}, body: null, reason: null });
    const parsed = (await response.json()) as { data: { settlement: { approvedPaisa: unknown } } };
    assert.equal(parsed.data.settlement.approvedPaisa, null);
  });
});

describe("the two comparisons a reviewer sees (D141)", () => {
  test("a number matches across the spellings a rider types", () => {
    assert.equal(sameNumber("+8801812345678", "01812345678"), true);
    assert.equal(sameNumber("8801812345678", "01812345678"), true);
    assert.equal(sameNumber("01812-345678", "01812345678"), true);
    assert.equal(sameNumber("01812345678", "01712345678"), false);
    assert.equal(sameNumber(null, "01812345678"), false, "nothing on file is not a match");
  });

  test("names are compared as people write them, not as a spell-checker reads them", () => {
    assert.ok(nameSimilarity("Md Karim Rahman", "Karim Rahman Md") >= NAME_MATCH_THRESHOLD, "word order is not identity");
    assert.ok(nameSimilarity("Karim Rahman", "karim  rahman.") === 1, "case and punctuation are not identity either");
    assert.ok(nameSimilarity("Karim Rahman", "Shahin Ahmed") < NAME_MATCH_THRESHOLD);
    assert.equal(nameSimilarity("", "Karim Rahman"), 0);
  });

  test("what is missing on file is null, which is not an accusation", () => {
    const draft = {
      trxId: "9H5K2M8P1Q",
      bkashNumber: "01712345678",
      accountName: "Karim Rahman",
      screenshotUrl: "https://x.test/a.png",
      selfieUrl: "https://x.test/b.jpg",
      amountPaisa: 1,
      method: "BKASH" as const,
    };
    assert.deepEqual(checkClaim(draft, { payoutNumber: null, payoutName: null, fullName: null }), {
      numberMatches: null,
      nameMatches: null,
    });
    // The number on file is somebody else's, and the name is close to the full name: one flag, one pass.
    assert.deepEqual(checkClaim(draft, { payoutNumber: "01812345678", payoutName: null, fullName: "Karim Rahman" }), {
      numberMatches: false,
      nameMatches: true,
    });
  });
});

describe("GET /v1/rider/cash (D140)", () => {
  test("a locked rider sees the amount, the block and the moment it began", async () => {
    const db = dbFor({ outstanding: 214_000, endedAt: "2026-11-06 22:14:00.000000" });
    const response = await route("/v1/rider/cash").run(ctxFor(db, "/v1/rider/cash"), { params: {}, body: null, reason: null });
    assert.equal(response.status, 200);
    const parsed = (await response.json()) as {
      data: { cashInHandPaisa: number; dueAt: string | null; locked: boolean; settlementRequired: boolean; settlement: unknown };
    };
    assert.equal(parsed.data.cashInHandPaisa, 214_000);
    assert.equal(parsed.data.locked, true);
    assert.equal(parsed.data.settlementRequired, true);
    assert.equal(parsed.data.dueAt, "2026-11-06T22:14:00.000Z", "the app says \"since 22:14\", so the instant must be the shift's end");
    assert.equal(parsed.data.settlement, null, "nothing submitted yet");
  });

  test("a submission under review is part of the answer, because that is what the screen shows", async () => {
    const db = dbFor({ outstanding: 214_000, latest: settlementRow() });
    const response = await route("/v1/rider/cash").run(ctxFor(db, "/v1/rider/cash"), { params: {}, body: null, reason: null });
    const parsed = (await response.json()) as { data: { settlement: { status: string; trxId: string; amountPaisa: number } } };
    assert.equal(parsed.data.settlement.status, "PENDING");
    assert.equal(parsed.data.settlement.trxId, "9H5K2M8P1Q");
    assert.equal(parsed.data.settlement.amountPaisa, 214_000);
  });

  test("a rider who owes nothing is not an error, and is not locked", async () => {
    const db = dbFor({ outstanding: null, rider: { ...RIDER, shift_state: "OFFLINE" } });
    const response = await route("/v1/rider/cash").run(ctxFor(db, "/v1/rider/cash"), { params: {}, body: null, reason: null });
    assert.equal(response.status, 200);
    const parsed = (await response.json()) as { data: { cashInHandPaisa: number; locked: boolean; settlementRequired: boolean } };
    assert.equal(parsed.data.cashInHandPaisa, 0);
    assert.equal(parsed.data.locked, false);
    assert.equal(parsed.data.settlementRequired, false);
  });

  test("a token with no rider row is refused without reading a balance", async () => {
    const db = dbFor({ rider: null });
    const response = await route("/v1/rider/cash").run(ctxFor(db, "/v1/rider/cash"), { params: {}, body: null, reason: null });
    assert.equal(response.status, 403);
    assert.ok(!db.calls.some((call) => call.sql.includes("rider_cash_balances")));
  });
});

describe("POST /v1/rider/cash/settle (D141)", () => {
  test("the claim is stored once, with the platform's two checks beside it", async () => {
    const db = dbFor({ outstanding: 214_000, endedAt: "2026-11-06 22:14:00.000000" });
    const result = await submit(db, CLAIM);
    assert.equal(result.status, 200);
    const settlement = result.data["settlement"] as { status: string; trxId: string; amountPaisa: number; id: string };
    assert.equal(settlement.status, "PENDING");
    assert.equal(settlement.trxId, "9H5K2M8P1Q");
    assert.equal(result.data["numberMatches"], true);
    assert.equal(result.data["nameMatches"], true);
    assert.equal(result.data["reviewDueBy"], new Date(Date.parse(String(result.data["reviewDueBy"]))).toISOString());
    assert.ok(Date.parse(String(result.data["reviewDueBy"])) > Date.now(), `the promise is ${String(AUTO_LIFT_MS)} ms out`);

    const insert = db.calls.find((call) => call.sql.startsWith("INSERT INTO `rider_cash_settlements`"));
    assert.ok(insert !== undefined);
    assert.deepEqual(insert.params[1], RIDER.id, "the rider the token resolves to, never one from the body");
    assert.equal(insert.params[3], 214_000);
    assert.equal(insert.params[4], "BKASH");
    assert.equal(insert.params[5], "9H5K2M8P1Q");
    assert.equal(insert.params[6], "01812345678");
    assert.equal(insert.params[7], "Karim Rahman");
    assert.equal(insert.params[8], CLAIM.screenshotUrl, "the screenshot is evidence, so its URL is on the row");
    assert.equal(insert.params[9], null, "the media id stays for a pipeline that promotes it");
    assert.equal(insert.params[10], CLAIM.selfieUrl);
    assert.equal(insert.params[11], 1, "the number matched the one on file");
    assert.equal(insert.params[12], 1);
    assert.match(insert.sql, /'PENDING'/u, "a submission is a claim; only a human confirms it");
    assert.ok(db.calls.some((call) => call.sql.includes("INSERT INTO `audit_log`")), "the claim is a decision worth a row");
  });

  test("a retried submission is the same answer, not a second payment", async () => {
    const db = dbFor({ outstanding: 214_000, byTrx: settlementRow() });
    const result = await submit(db, CLAIM);
    assert.equal(result.status, 200);
    assert.equal(result.data["duplicate"], true);
    assert.equal((result.data["settlement"] as { status: string }).status, "PENDING");
    assert.ok(!db.calls.some((call) => call.sql.startsWith("INSERT INTO `rider_cash_settlements`")));
    assert.ok(!db.calls.some((call) => call.sql.includes("INSERT INTO `audit_log`")), "nothing changed, nothing audited");
  });

  test("a transaction ID another rider already used is refused: one payment settles one debt", async () => {
    const db = dbFor({ outstanding: 214_000, byTrx: settlementRow({ rider_id: bytes(OTHER_RIDER_HEX) }) });
    const result = await submit(db, CLAIM);
    assert.equal(result.status, 409);
    assert.equal(result.code, "CASH_TRXID_DUPLICATE");
    assert.equal(result.details?.["trx_id"], "9H5K2M8P1Q");
  });

  test("a claim already under review blocks a second one", async () => {
    const db = dbFor({ outstanding: 214_000, pending: settlementRow() });
    const result = await submit(db, { ...CLAIM, trxId: "8G4J1L7N0Z" });
    assert.equal(result.status, 409);
    assert.equal(result.code, "CASH_ALREADY_SETTLED", "two pending claims are two payments to a reviewer");
    assert.equal(result.details?.["settled_at"], "2026-11-06 20:41:00.000000");
  });

  test("nothing owed is nothing to settle", async () => {
    const db = dbFor({ outstanding: null, latest: settlementRow({ status: "CONFIRMED" }) });
    const result = await submit(db, CLAIM);
    assert.equal(result.status, 409);
    assert.equal(result.code, "CASH_ALREADY_SETTLED");
  });

  test("more than is owed and less than is owed are both refused, and the shortfall is named", async () => {
    const over = await submit(dbFor({ outstanding: 214_000 }), { ...CLAIM, amountPaisa: 250_000 });
    assert.equal(over.status, 422);
    assert.equal(over.code, "CASH_OVERPAYMENT");
    assert.deepEqual(over.details, { expected: 214_000, received: 250_000 });

    const under = await submit(dbFor({ outstanding: 214_000 }), { ...CLAIM, amountPaisa: 100_000 });
    assert.equal(under.status, 422);
    assert.equal(under.code, "CASH_UNDERPAYMENT");
    assert.equal(under.details?.["short_by"], 114_000, "the partial path in 25 §7 needs a reason, and is not built");
  });

  test("a rider whose payout number was never recorded is submitted, not accused", async () => {
    const db = dbFor({ outstanding: 214_000, identity: { payout_number: null, payout_name: null, full_name: "Karim Rahman" } });
    const result = await submit(db, CLAIM);
    assert.equal(result.status, 200);
    assert.equal(result.data["numberMatches"], null, "nothing on file is not a mismatch");
    assert.equal(result.data["nameMatches"], true);
    const insert = db.calls.find((call) => call.sql.startsWith("INSERT INTO `rider_cash_settlements`"));
    assert.equal(insert?.params[11], null, "and the column says not-checked rather than false");
  });

  test("a bad claim never reaches the database", async () => {
    const db = dbFor({ outstanding: 214_000 });
    const result = await submit(db, { ...CLAIM, trxId: "nope" });
    assert.equal(result.status, 422);
    assert.equal(result.code, "CASH_TRXID_INVALID");
    assert.deepEqual(db.calls, [], "the refusal is decided before a single row is read");
  });
});
