/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The second chance for an alarm that did not land (`15 §8`, D131).
 *
 * A `FAILED` row used to be where a push story ended: Google returned a 503, the rider's phone stayed dark, and the
 * offer expired anyway. The tests are the policy one clause at a time, because the policy lives in one statement's
 * `WHERE` and a clause that is missing is invisible until an order goes unclaimed:
 *
 * - the query is asked for **the window**, not for every failure ever recorded — not younger than `RETRY_AFTER_MS`,
 *   and only while the offer keeps `RETRY_MIN_REMAINING_MS`;
 * - the retried alarm carries **the offer's own identity**, which is the bug D128 shipped: it named the rider, so the
 *   deep link a rider tapped opened an offer that did not exist;
 * - an attempt is numbered **per token**, so the row says "second try" and not "the position in the device list";
 * - a **404 prunes** the token and a **503 does not**, which is the difference between cleaning up and giving up.
 */

import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { PUSH_RETRY_PATH, PUSH_RETRY_ROUTES } from "../src/routes/push-retry.ts";
import {
  MAX_PUSH_ATTEMPTS,
  MAX_RETRIES_PER_PASS,
  nextAttempt,
  pushFailureIsPermanent,
  RETRY_AFTER_MS,
  RETRY_MIN_REMAINING_MS,
  UNREGISTERED_REASON,
} from "../src/domain/order/push-retry.ts";
import type { Ctx, RouteDefinition } from "../src/middleware/context.ts";
import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";

const ORDER_HEX = "0193f2a17c3e7890abcdef01234567a1";
const OFFER_HEX = "0193f2a17c3e7890abcdef01234567e1";
const OTHER_ORDER_HEX = "0193f2a17c3e7890abcdef01234567a2";
const TOKEN = "tok-rider-one";
const ENDPOINT = "https://fcm.test";
const PROJECT = "undal-prod";

const realFetch = globalThis.fetch;

function bytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "hex"));
}

/** A `DATETIME(6)` value `seconds` from now, in the format the column returns. */
function sqlIn(seconds: number): string {
  return new Date(Date.now() + seconds * 1_000).toISOString().replace("T", " ").replace("Z", "000");
}

interface Candidate {
  readonly orderId?: string;
  readonly code?: string;
  readonly token?: string;
  readonly attempt?: number;
  readonly offerId?: string;
  readonly payout?: number;
  readonly secondsLeft?: number;
}

/** A candidate row exactly as `retryCandidates` reads one. */
function candidateRow(options: Candidate = {}): Record<string, unknown> {
  return {
    order_id: bytes(options.orderId ?? ORDER_HEX),
    code: options.code ?? "UND-7K2M9QX4",
    fcm_token: options.token ?? TOKEN,
    attempt: options.attempt ?? 1,
    offer_id: bytes(options.offerId ?? OFFER_HEX),
    payout_paisa: options.payout ?? 8_370,
    expires_at: sqlIn(options.secondsLeft ?? 20),
  };
}

interface Options {
  readonly candidates?: readonly Record<string, unknown>[];
  readonly invalidated?: number;
}

function dbFor(options: Options = {}): ReturnType<typeof stubDb> {
  return stubDb([
    { match: /FROM `fcm_dispatches` d/u, rows: options.candidates === undefined ? [] : [...options.candidates] },
    { match: /INSERT INTO `fcm_dispatches`/u, affectedRows: 1 },
    { match: /UPDATE `device_tokens` SET/u, affectedRows: options.invalidated ?? 1 },
    { match: /FROM `audit_log` ORDER BY `seq` DESC/u, rows: [] },
    { match: /INSERT INTO `audit_log`/u, affectedRows: 1 },
  ]);
}

/** A `fetch` that answers FCM with `status` (and a message name when it succeeds). */
function stubFcm(status = 200): { readonly calls: { readonly url: string; readonly body: unknown }[] } {
  const calls: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as unknown });
    if (status >= 400) {
      return new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), { status });
    }
    return new Response(JSON.stringify({ name: `projects/${PROJECT}/messages/1` }), { status: 200 });
  }) as typeof fetch;
  return { calls };
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

function ctxFor(db: ReturnType<typeof stubDb>, options: { readonly token?: string | null } = {}): Ctx {
  const token = options.token === undefined ? "test-internal-token" : options.token;
  return {
    env: testEnv({ FCM_PROJECT_ID: PROJECT, FCM_ACCESS_TOKEN: "ya29.test", FCM_ENDPOINT: ENDPOINT }),
    db,
    url: new URL(`https://api.undal.test${PUSH_RETRY_PATH}`),
    request: new Request(`https://api.undal.test${PUSH_RETRY_PATH}`, {
      method: "POST",
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
    }),
    requestId: "0193f2a1-7c3e-7890-abcd-ef0123456788",
    ip: "1.2.3.4",
    userAgent: "test",
    keys: [],
    principal: null,
    locale: "en",
    startedAtMs: 0,
    waitUntil: () => undefined,
  } as Ctx;
}

const route = (): RouteDefinition => {
  const found = PUSH_RETRY_ROUTES.find((entry) => entry.path === PUSH_RETRY_PATH);
  if (found === undefined) throw new Error("no retry route");
  return found;
};

const pass = (db: ReturnType<typeof stubDb>, token?: string | null) =>
  route().run(ctxFor(db, token === undefined ? {} : { token }), { params: {}, body: {}, reason: null });

interface AnswerBody {
  readonly data: {
    readonly retried: number;
    readonly sent: number;
    readonly failed: number;
    readonly pruned: number;
    readonly configured: boolean;
    readonly atMs: number;
  };
}

describe("the policy (D131)", () => {
  test("a 404 is permanent, a 5xx and a silence are not", () => {
    assert.equal(pushFailureIsPermanent(404), true, "an unregistered token can never work again");
    assert.equal(pushFailureIsPermanent(400), true, "the same payload will be refused the same way");
    assert.equal(pushFailureIsPermanent(403), true, "a credential does not fix itself between two sends");
    assert.equal(pushFailureIsPermanent(503), false);
    assert.equal(pushFailureIsPermanent(500), false);
    assert.equal(pushFailureIsPermanent(429), false, "a rate limit is the network saying 'not yet'");
    assert.equal(pushFailureIsPermanent(408), false);
    assert.equal(pushFailureIsPermanent(null), false, "a timeout has no status and is transient by definition");
  });

  test("attempts are counted per token, not per position in the device list", () => {
    assert.equal(nextAttempt(1), 2, "the second send to this phone");
    assert.equal(nextAttempt(2), 3);
    assert.equal(nextAttempt(0), 1, "a row that recorded nothing is still a first attempt");
  });
});

describe(`POST ${PUSH_RETRY_PATH}`, () => {
  test("a failed send with a live offer is sent again and recorded as the next attempt", async () => {
    const fcm = stubFcm();
    const db = dbFor({ candidates: [candidateRow()] });
    const response = await pass(db);
    assert.equal(response.status, 200);
    const body = (await response.json()) as AnswerBody;
    assert.equal(body.data.retried, 1);
    assert.equal(body.data.sent, 1);
    assert.equal(body.data.failed, 0);

    const insert = db.calls.find((call) => /INSERT INTO `fcm_dispatches`/u.test(call.sql));
    assert.notEqual(insert, undefined, "a retried alarm that lands is evidence like any other");
    assert.equal(insert?.params[4], 2, "the second attempt for this token");
    assert.equal(insert?.params[5], "SENT");
    assert.equal(insert?.params[3], TOKEN);
    assert.equal(fcm.calls.length, 1);
    assert.equal(fcm.calls[0]?.url, `${ENDPOINT}/v1/projects/${PROJECT}/messages:send`);
  });

  test("the query is asked for the window, not for every failure ever recorded", async () => {
    const db = dbFor({ candidates: [candidateRow()] });
    stubFcm();
    await pass(db);
    const select = db.calls.find((call) => /FROM `fcm_dispatches` d/u.test(call.sql));
    assert.notEqual(select, undefined);
    const sql = select?.sql ?? "";
    assert.match(sql, /`outcome` = 'FAILED'/u, "a send that landed is not retried");
    assert.match(sql, /`attempt` < \?/u, "the attempt cap is the query's, so a pass cannot loop");
    assert.match(sql, /`response` IS NULL/u, "an answered offer has nothing left to ring about");
    assert.match(sql, /`expires_at` > \?/u, "an expired offer is a phone ringing for somebody else's order");
    assert.match(sql, /`valid` = 1/u, "a pruned token drops out of the retry without a second table");
    assert.match(sql, /NOT EXISTS/u, "a later row for the same token means it has been delivered since");
    assert.deepEqual(select?.params[0], MAX_PUSH_ATTEMPTS);
    assert.deepEqual(select?.params[3], MAX_RETRIES_PER_PASS);
    // The two time bounds are the policy's, converted once through the column format.
    const bounds = (select?.params ?? []).slice(1, 3) as string[];
    const now = Date.now();
    assert.ok(Math.abs(Date.parse(bounds[0]?.replace(" ", "T") ?? "") - (now - RETRY_AFTER_MS)) < 5_000);
    assert.ok(
      Math.abs(Date.parse(bounds[1]?.replace(" ", "T") ?? "") - (now + RETRY_MIN_REMAINING_MS)) < 5_000,
    );
  });

  test("the retried alarm names the offer's own row, not the rider", async () => {
    const fcm = stubFcm();
    await pass(dbFor({ candidates: [candidateRow()] }));
    const body = fcm.calls[0]?.body as { message: { data: Record<string, string>; android: { priority: string } } };
    assert.equal(body.message.data["offerId"], OFFER_HEX, "the deep link the rider taps has to exist");
    assert.equal(body.message.data["orderCode"], "UND-7K2M9QX4");
    assert.equal(body.message.data["payoutPaisa"], "8370", "the offer's payout, not a remembered copy");
    assert.ok(Number(body.message.data["expiresAtMs"]) > 0, "the countdown is the offer's deadline");
    assert.ok(body.message.data["titleBn"] !== undefined, "both languages, as the first send had them");
    assert.equal(body.message.android.priority, "high");
    assert.equal((body.message as { notification?: unknown }).notification, undefined, "data only");
  });

  test("a 503 is recorded and left alone; a 404 retires the token", async () => {
    stubFcm(503);
    const transient = dbFor({ candidates: [candidateRow()] });
    const body = (await (await pass(transient)).json()) as AnswerBody;
    assert.equal(body.data.failed, 1);
    assert.equal(body.data.pruned, 0, "a bad minute at Google is not a dead phone");
    assert.equal(transient.calls.filter((call) => /UPDATE `device_tokens`/u.test(call.sql)).length, 0);

    globalThis.fetch = realFetch;
    stubFcm(404);
    const gone = dbFor({ candidates: [candidateRow()] });
    const stored = (await (await pass(gone)).json()) as AnswerBody;
    assert.equal(stored.data.failed, 1);
    assert.equal(stored.data.pruned, 1);
    const update = gone.calls.find((call) => /UPDATE `device_tokens` SET/u.test(call.sql));
    assert.equal(update?.params[1], UNREGISTERED_REASON);
    assert.match(update?.sql ?? "", /AND `valid` = 1/u, "the first prune keeps its timestamp");
    assert.equal(update?.params[2], TOKEN);
  });

  test("nothing to do is an answer, and it writes nothing at all", async () => {
    const fcm = stubFcm();
    const db = dbFor();
    const body = (await (await pass(db)).json()) as AnswerBody;
    assert.equal(body.data.retried, 0);
    assert.equal(body.data.configured, true);
    assert.equal(fcm.calls.length, 0);
    assert.equal(db.calls.filter((call) => /INSERT INTO/u.test(call.sql)).length, 0, "no rows, no audit metronome");
  });

  test("without credentials nothing is sent and nothing is recorded", async () => {
    const fcm = stubFcm();
    const db = dbFor({ candidates: [candidateRow()] });
    const response = await route().run(
      { ...ctxFor(db), env: testEnv({ INTERNAL_TOKEN: "test-internal-token" }) } as Ctx,
      { params: {}, body: {}, reason: null },
    );
    const body = (await response.json()) as AnswerBody;
    assert.equal(body.data.configured, false, "the caller can tell this apart from 'no failures found'");
    assert.equal(body.data.retried, 0);
    assert.equal(fcm.calls.length, 0);
    assert.equal(db.calls.filter((call) => /INSERT INTO/u.test(call.sql)).length, 0);
    assert.equal(db.calls.filter((call) => /FROM `fcm_dispatches` d/u.test(call.sql)).length, 0, "not even read");
  });

  test("without the shared token the route refuses before it reads the log", async () => {
    const fcm = stubFcm();
    const db = dbFor({ candidates: [candidateRow()] });
    const response = await pass(db, null);
    assert.ok(response.status === 401 || response.status === 403, `refused, not retried (${String(response.status)})`);
    assert.equal(fcm.calls.length, 0);
    assert.equal(db.calls.length, 0);
  });

  test("one audit row per pass, listing the orders and the counters", async () => {
    stubFcm();
    const db = dbFor({
      candidates: [candidateRow(), candidateRow({ orderId: OTHER_ORDER_HEX, code: "UND-9QX4M2K7" })],
    });
    const body = (await (await pass(db)).json()) as AnswerBody;
    assert.equal(body.data.retried, 2);
    const rows = db.calls.filter((call) => /INSERT INTO `audit_log`/u.test(call.sql));
    assert.equal(rows.length, 1, "the per-device detail belongs in fcm_dispatches");
    const after = JSON.parse(String(rows[0]?.params.find((param) => typeof param === "string" && param.includes("retried")) ?? "{}")) as {
      orders?: string[];
      sent?: number;
    };
    assert.deepEqual(after.orders, ["UND-7K2M9QX4", "UND-9QX4M2K7"]);
    assert.equal(after.sent, 2);
  });
});
