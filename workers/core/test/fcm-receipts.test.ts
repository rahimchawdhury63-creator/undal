/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `POST /internal/fcm/receipts` — the device heard the alarm.
 *
 * The tests are about matching: the receipt names an order and a device, core resolves the device's live
 * tokens, and the row that gets filled in is the latest unacknowledged one. A receipt that matches nothing is
 * `recorded: 0` rather than an error, because an alarm that already rang cannot be un-rung by a missing row.
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
const DEVICE_ID = "06060606060606060606060606060606";
const DISPATCH_ID = new Uint8Array(16).fill(7);

const RECEIPT = { orderCode: CODE, deviceId: DEVICE_ID, receivedAtMs: 1_793_612_345_678 };

const route = () => {
  const found = DISPATCH_LOG_ROUTES.find((candidate) => candidate.path === "/internal/fcm/receipts");
  if (found === undefined) throw new Error("no receipts route");
  return found;
};

/** A database with the order, the device's tokens and one unacknowledged dispatch. */
function receiptDb(options: { orderFound?: boolean; tokens?: string[]; dispatchFound?: boolean } = {}) {
  return stubDb([
    { match: /FROM `orders` WHERE `code`/u, rows: options.orderFound === false ? [] : [{ id: ORDER_ID, code: CODE }] },
    {
      match: /FROM `device_tokens` WHERE `device_id`/u,
      rows: (options.tokens ?? ["phone-token-1"]).map((fcm_token) => ({ fcm_token })),
    },
    {
      match: /FROM `fcm_dispatches` WHERE `order_id`/u,
      rows: options.dispatchFound === false ? [] : [{ id: DISPATCH_ID }],
    },
    { match: /UPDATE `fcm_dispatches` SET `received_at`/u, affectedRows: 1 },
    { match: /FROM `audit_log`/u, rows: [] },
    { match: /INSERT INTO `audit_log`/u, affectedRows: 1 },
  ]);
}

/** A context with the internal token unless the test says otherwise. */
function ctxFor(db: ReturnType<typeof stubDb>, token: string | null = TOKEN): Ctx {
  const request = new Request("https://api.undal.app/internal/fcm/receipts", {
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

/** Send receipts and parse the answer. */
async function report(db: ReturnType<typeof stubDb>, body: unknown, token: string | null = TOKEN) {
  const response = await route().run(ctxFor(db, token), { params: {}, body, reason: null });
  return { status: response.status, body: (await response.json()) as { data?: { recorded: number } } };
}

describe("authorization", () => {
  test("no token is refused and nothing is touched", async () => {
    const db = receiptDb();
    const { status } = await report(db, { receipts: [RECEIPT] }, null);
    assert.equal(status, 401);
    assert.deepEqual(db.calls, []);
  });
});

describe("matching a receipt", () => {
  test("fills in received_at on the latest unacknowledged dispatch", async () => {
    const db = receiptDb();
    const { status, body } = await report(db, { receipts: [RECEIPT] });
    assert.equal(status, 200);
    assert.equal(body.data?.recorded, 1);
    const update = db.calls.find((call) => /UPDATE `fcm_dispatches`/u.test(call.sql));
    assert.deepEqual([...(update?.params as readonly unknown[])][1], DISPATCH_ID);
    assert.match(String([...(update?.params as readonly unknown[])][0]), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/u);
  });

  test("the lookup asks for the newest row and only an unacknowledged one", async () => {
    const db = receiptDb();
    await report(db, { receipts: [RECEIPT] });
    const select = db.calls.find((call) => /FROM `fcm_dispatches`/u.test(call.sql));
    assert.match(select?.sql ?? "", /received_at` IS NULL/u);
    assert.match(select?.sql ?? "", /ORDER BY `sent_at` DESC LIMIT 1/u);
  });

  test("every live token of the device is acknowledged", async () => {
    const db = receiptDb({ tokens: ["phone-token-1", "phone-token-2"] });
    const { body } = await report(db, { receipts: [RECEIPT] });
    assert.equal(body.data?.recorded, 2);
  });

  test("an order that no longer exists records nothing", async () => {
    const { status, body } = await report(receiptDb({ orderFound: false }), { receipts: [RECEIPT] });
    assert.equal(status, 200);
    assert.equal(body.data?.recorded, 0);
  });

  test("a device with no dispatch to acknowledge records nothing", async () => {
    const { body } = await report(receiptDb({ dispatchFound: false }), { receipts: [RECEIPT] });
    assert.equal(body.data?.recorded, 0);
  });

  test("a repeated receipt writes no second row", async () => {
    const db = stubDb([
      { match: /FROM `orders` WHERE `code`/u, rows: [{ id: ORDER_ID, code: CODE }] },
      { match: /FROM `device_tokens` WHERE `device_id`/u, rows: [{ fcm_token: "phone-token-1" }] },
      { match: /FROM `fcm_dispatches` WHERE `order_id`/u, rows: [{ id: DISPATCH_ID }] },
      { match: /UPDATE `fcm_dispatches`/u, affectedRows: 0 },
      { match: /FROM `audit_log`/u, rows: [] },
      { match: /INSERT INTO `audit_log`/u, affectedRows: 1 },
    ]);
    const { body } = await report(db, { receipts: [RECEIPT] });
    assert.equal(body.data?.recorded, 0);
  });

  test("the audit row is written only when something was matched", async () => {
    const matched = receiptDb();
    await report(matched, { receipts: [RECEIPT] });
    assert.equal(matched.calls.filter((call) => /INSERT INTO `audit_log`/u.test(call.sql)).length, 1);

    const unmatched = receiptDb({ orderFound: false });
    await report(unmatched, { receipts: [RECEIPT] });
    assert.equal(unmatched.calls.filter((call) => /INSERT INTO `audit_log`/u.test(call.sql)).length, 0);
  });
});

describe("a malformed report", () => {
  test("no receipts array is refused", async () => {
    assert.equal((await report(receiptDb(), {})).status, 422);
  });

  test("a device id that is not 32 hex is refused", async () => {
    assert.equal((await report(receiptDb(), { receipts: [{ ...RECEIPT, deviceId: "phone-1" }] })).status, 422);
  });

  test("a receipt with no instant is refused", async () => {
    assert.equal((await report(receiptDb(), { receipts: [{ ...RECEIPT, receivedAtMs: "now" }] })).status, 422);
  });

  test("more receipts than one socket can produce at once is refused", async () => {
    const many = Array.from({ length: 11 }, () => RECEIPT);
    assert.equal((await report(receiptDb(), { receipts: many })).status, 422);
  });
});
