/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `POST /internal/fcm/dispatches` — the delivery log.
 *
 * The rows are evidence, so the tests are about the two things evidence needs: the right subject (this order,
 * this device) and the right shape (one row per send, a null message id when FCM accepted nothing). The audit
 * row is asserted once, at batch level, because forty-five thousand per-device audit rows a day would bury a
 * chain the admin panel reads.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";
import { DISPATCH_LOG_ROUTES } from "../src/routes/dispatch-log.ts";
import type { Ctx } from "../src/middleware/context.ts";

const CODE = "UND-7K2M9QX4";
const TOKEN = "test-internal-token";
const ORDER_ID = new Uint8Array(16).fill(9);
const DEVICE_ID = new Uint8Array(16).fill(6);

const ENTRY = {
  orderCode: CODE,
  token: "phone-token-1",
  attempt: 2,
  outcome: "SENT",
  messageId: "projects/p/messages/1",
  sentAtMs: 1_793_612_345_678,
};

const route = () => {
  const found = DISPATCH_LOG_ROUTES.find((candidate) => candidate.path === "/internal/fcm/dispatches");
  if (found === undefined) throw new Error("no dispatch-log route");
  return found;
};

/** A database with the order, the device token, and both writes. */
function logDb(options: { orderFound?: boolean; tokenKnown?: boolean } = {}) {
  return stubDb([
    { match: /FROM `orders` WHERE `code`/u, rows: options.orderFound === false ? [] : [{ id: ORDER_ID, code: CODE }] },
    { match: /FROM `device_tokens` WHERE `fcm_token`/u, rows: options.tokenKnown === false ? [] : [{ device_id: DEVICE_ID }] },
    { match: /INSERT INTO `fcm_dispatches`/u, affectedRows: 1 },
    { match: /FROM `audit_log`/u, rows: [] },
    { match: /INSERT INTO `audit_log`/u, affectedRows: 1 },
  ]);
}

/** A context with the internal token on the request unless the test says otherwise. */
function ctxFor(db: ReturnType<typeof stubDb>, token: string | null = TOKEN): Ctx {
  const request = new Request("https://api.undal.app/internal/fcm/dispatches", {
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

/** Send a report and parse the answer. */
async function report(db: ReturnType<typeof stubDb>, body: unknown, token: string | null = TOKEN) {
  const response = await route().run(ctxFor(db, token), { params: {}, body, reason: null });
  return { status: response.status, body: (await response.json()) as { data?: { recorded: number } } };
}

describe("authorization", () => {
  test("a caller with no token is refused before anything is written", async () => {
    const db = logDb();
    const { status } = await report(db, { dispatches: [ENTRY] }, null);
    assert.equal(status, 401);
    assert.deepEqual(db.calls, []);
  });
});

describe("recording", () => {
  test("one row per send, and the count comes back", { todo: false }, async () => {
    const db = logDb();
    const { status, body } = await report(db, {
      dispatches: [ENTRY, { ...ENTRY, token: "phone-token-2", outcome: "UNREGISTERED", messageId: null }],
    });
    assert.equal(status, 200);
    assert.equal(body.data?.recorded, 2);
    const inserts = db.calls.filter((call) => /INSERT INTO `fcm_dispatches`/u.test(call.sql));
    assert.equal(inserts.length, 2);
  });

  test("the row names the order and the device the token belongs to", async () => {
    const db = logDb();
    await report(db, { dispatches: [ENTRY] });
    const insert = db.calls.find((call) => /INSERT INTO `fcm_dispatches`/u.test(call.sql));
    assert.ok(insert !== undefined);
    const params = [...insert.params];
    // id, order_id, device_id, fcm_token, attempt, outcome, message_id, sent_at, received_at
    assert.deepEqual(params[1], ORDER_ID);
    assert.deepEqual(params[2], DEVICE_ID);
    assert.equal(params[3], "phone-token-1");
    assert.equal(params[4], 2);
    assert.equal(params[5], "SENT");
    assert.equal(params[6], "projects/p/messages/1");
    assert.match(String(params[7]), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/u);
    assert.equal(params[8], null);
  });

  test("a rejected send records a null receipt instead of inventing an id", async () => {
    const db = logDb();
    await report(db, { dispatches: [{ ...ENTRY, outcome: "UNREGISTERED", messageId: null }] });
    const insert = db.calls.find((call) => /INSERT INTO `fcm_dispatches`/u.test(call.sql));
    assert.equal([...(insert?.params as readonly unknown[])][6], null);
  });

  test("an order that no longer exists still logs the send", async () => {
    const db = logDb({ orderFound: false });
    const { status } = await report(db, { dispatches: [ENTRY] });
    assert.equal(status, 200);
    const insert = db.calls.find((call) => /INSERT INTO `fcm_dispatches`/u.test(call.sql));
    assert.equal([...(insert?.params as readonly unknown[])][1], null);
  });

  test("an unregistered token logs the send with no device", async () => {
    const db = logDb({ tokenKnown: false });
    await report(db, { dispatches: [ENTRY] });
    const insert = db.calls.find((call) => /INSERT INTO `fcm_dispatches`/u.test(call.sql));
    assert.equal([...(insert?.params as readonly unknown[])][2], null);
  });

  test("the batch is audited once, at INFO, by SYSTEM", async () => {
    const db = logDb();
    await report(db, { dispatches: [ENTRY, { ...ENTRY, token: "phone-token-2" }] });
    const audits = db.calls.filter((call) => /INSERT INTO `audit_log`/u.test(call.sql));
    assert.equal(audits.length, 1);
    const params = [...(audits[0]?.params ?? [])];
    assert.equal(params[4], "SYSTEM");
    assert.equal(params[16], "INFO");
  });
});

describe("a malformed report", () => {
  test("no dispatches array is refused", async () => {
    const { status } = await report(logDb(), {});
    assert.equal(status, 422);
  });

  test("an empty batch is refused", async () => {
    const { status } = await report(logDb(), { dispatches: [] });
    assert.equal(status, 422);
  });

  test("more devices than a vendor can have is refused", async () => {
    const many = Array.from({ length: 21 }, (_unused, index) => ({ ...ENTRY, token: `token-${index}` }));
    const { status } = await report(logDb(), { dispatches: many });
    assert.equal(status, 422);
  });

  test("a send with no token is refused", async () => {
    const { status } = await report(logDb(), { dispatches: [{ ...ENTRY, token: "" }] });
    assert.equal(status, 422);
  });

  test("an attempt that is not a small integer is refused", async () => {
    const { status } = await report(logDb(), { dispatches: [{ ...ENTRY, attempt: 1.5 }] });
    assert.equal(status, 422);
  });

  test("a send with no instant is refused", async () => {
    const { status } = await report(logDb(), { dispatches: [{ ...ENTRY, sentAtMs: "yesterday" }] });
    assert.equal(status, 422);
  });
});
