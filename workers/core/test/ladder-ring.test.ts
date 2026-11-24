/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Ringing the vendor when the order is placed (D93).
 *
 * The ladder was complete and unreachable: `VendorAlarm` walked its rungs, `auto-cancel` closed the order at
 * 120 s, and nothing told it to begin. These tests are about the sentence in between — what it says, who it
 * addresses, and what happens when nobody answers.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ALARM_RING_MS,
  LADDER_BEGIN_PATH,
  LADDER_WINDOW_MS,
  beginBody,
  beginLadder,
  ringVendor,
  shortCode,
} from "../src/bindings/ladder.ts";
import type { RingRequest } from "../src/bindings/ladder.ts";
import { stubDb } from "../src/db/client.ts";
import type { Ctx } from "../src/middleware/context.ts";
import { testEnv } from "./support.ts";

const T0 = 1_793_612_345_678;
const ORDER_ID = "0193f2a1-7c3e-7890-abcd-ef0123456700";
const VENDOR_ID = "0193f2a1-7c3e-7890-abcd-ef0123456701";
const OWNER_ID = new Uint8Array(16).fill(3);
const TOKEN = "test-internal-token";
const BASE = "https://rt.undal.app";

const REQUEST: RingRequest = {
  orderId: ORDER_ID,
  orderCode: "UND-7K2M9QX4",
  zoneId: "zone-1",
  vendorId: VENDOR_ID,
  itemCount: 3,
  totalPaisa: 148_500,
  publishedAtMs: T0,
};

/** A database with a vendor, its owner, two devices and an address with an area. */
function ringDb(options: { owner?: boolean; tokens?: string[]; area?: string | null } = {}) {
  return stubDb([
    {
      match: /FROM `vendors` WHERE `id`/u,
      rows: options.owner === false ? [] : [{ owner_user_id: OWNER_ID }],
    },
    {
      match: /FROM `device_tokens`/u,
      rows: (options.tokens ?? ["phone-token-1", "phone-token-2"]).map((fcm_token) => ({ fcm_token })),
    },
    { match: /FROM `orders` WHERE `id`/u, rows: [{ delivery_address_id: new Uint8Array(16).fill(5) }] },
    { match: /FROM `addresses` WHERE `id`/u, rows: [{ area: options.area === undefined ? "Mirpur" : options.area }] },
    { match: /FROM `audit_log`/u, rows: [] },
    { match: /INSERT INTO `audit_log`/u, affectedRows: 1 },
  ]);
}

function ctxFor(db: ReturnType<typeof stubDb>, env: Partial<Parameters<typeof testEnv>[0]> = {}) {
  return {
    env: testEnv({ REALTIME_BASE: BASE, INTERNAL_TOKEN: TOKEN, ...env } as never),
    db,
    url: new URL("https://api.undal.app/v1/orders"),
    request: new Request("https://api.undal.app/v1/orders", { method: "POST" }),
    requestId: "0193f2a1-7c3e-7890-abcd-ef0123456702",
    ip: "1.2.3.4",
    userAgent: "undal-test",
    keys: [],
    principal: null,
    locale: "en",
    startedAtMs: 0,
    waitUntil: () => undefined,
  } as Ctx;
}

/** A transport that records what was sent and answers with a status. */
function stubFetch(status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify({ ok: status < 400 }), { status });
  }) as unknown as typeof fetch;
  return { calls, transport };
}

describe("what the ring says", () => {
  test("the push is a critical, ringing order that expires with the ladder", () => {
    const body = beginBody(REQUEST, ["phone-token-1"], "Mirpur");
    assert.equal(body.push.type, "ORDER_NEW");
    assert.equal(body.push.severity, "CRITICAL");
    assert.equal(body.push.alarm, "loop");
    assert.equal(body.push.alarmMaxMs, ALARM_RING_MS);
    assert.equal(body.push.expiresAtMs, T0 + LADDER_WINDOW_MS);
    assert.equal(LADDER_WINDOW_MS, 120_000, "the ladder cancels at 120 s; the push must not outlive it");
    assert.equal(body.push.orderId, "UND-7K2M9QX4");
    assert.equal(body.push.orderCode, "7K2M9QX4");
    assert.equal(body.push.vendorId, VENDOR_ID);
    assert.equal(body.push.totalPaisa, 148_500, "paisa crosses as paisa; the client formats it");
    assert.equal(body.push.itemCount, 3);
    assert.equal(body.publishedAtMs, T0);
    assert.deepEqual(body.devices, ["phone-token-1"]);
  });

  test("an address with no area says nothing rather than guessing", () => {
    assert.equal(beginBody(REQUEST, ["t"], null).push.customerArea, "");
    assert.equal(beginBody(REQUEST, ["t"], "  ").push.customerArea, "");
  });

  test("the short code is the part a person reads out", () => {
    assert.equal(shortCode("UND-7K2M9QX4"), "7K2M9QX4");
    assert.equal(shortCode("7K2M9QX4"), "7K2M9QX4");
  });
});

describe("posting the ring", () => {
  test("the begin goes to the ladder route with the internal token", async () => {
    const { calls, transport } = stubFetch(200);
    const rang = await beginLadder(BASE, TOKEN, beginBody(REQUEST, ["phone-token-1"], "Mirpur"), { fetch: transport });
    assert.equal(rang, true);
    assert.equal(calls[0]?.url, `${BASE}${LADDER_BEGIN_PATH}`);
    assert.equal((calls[0]?.init.headers as Record<string, string>).authorization, `Bearer ${TOKEN}`);
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)).orderCode, "UND-7K2M9QX4");
  });

  test("a refusal is false, not a throw", async () => {
    for (const status of [403, 422, 501, 503]) {
      const { transport } = stubFetch(status);
      assert.equal(await beginLadder(BASE, TOKEN, beginBody(REQUEST, ["t"], null), { fetch: transport }), false);
    }
  });

  test("a room that does not answer is abandoned, not waited on", async () => {
    const transport = (async () => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    assert.equal(
      await beginLadder(BASE, TOKEN, beginBody(REQUEST, ["t"], null), { fetch: transport, timeoutMs: 5 }),
      false,
    );
  });
});

describe("who is rung", () => {
  test("every live device of the vendor's owner is rung, once", async () => {
    const db = ringDb();
    const { calls, transport } = stubFetch(200);
    globalThis.fetch = transport;
    try {
      await ringVendor(ctxFor(db), REQUEST);
    } finally {
      globalThis.fetch = undefined as unknown as typeof fetch;
    }
    assert.equal(calls.length, 1);
    const body = JSON.parse(String(calls[0]?.init.body)) as { devices: string[]; push: { customerArea: string } };
    assert.deepEqual(body.devices, ["phone-token-1", "phone-token-2"]);
    assert.equal(body.push.customerArea, "Mirpur");
  });

  test("a vendor with no registered device is written down, not rung", async () => {
    const db = ringDb({ tokens: [] });
    const { calls, transport } = stubFetch(200);
    globalThis.fetch = transport;
    try {
      await ringVendor(ctxFor(db), REQUEST);
    } finally {
      globalThis.fetch = undefined as unknown as typeof fetch;
    }
    assert.deepEqual(calls, [], "nothing to ring");
    const audit = db.calls.find((call) => /INSERT INTO `audit_log`/u.test(call.sql));
    assert.match(JSON.stringify(audit?.params ?? []), /ladder\.unrung/u);
    assert.match(JSON.stringify(audit?.params ?? []), /no_device/u);
  });

  test("a ladder that refused the begin is written down too", async () => {
    const db = ringDb();
    const { transport } = stubFetch(501);
    globalThis.fetch = transport;
    try {
      await ringVendor(ctxFor(db), REQUEST);
    } finally {
      globalThis.fetch = undefined as unknown as typeof fetch;
    }
    const audit = db.calls.find((call) => /INSERT INTO `audit_log`/u.test(call.sql));
    assert.match(JSON.stringify(audit?.params ?? []), /begin_refused/u);
  });

  test("a deployment with no stream configured rings nothing and writes nothing", async () => {
    const db = ringDb();
    const { calls, transport } = stubFetch(200);
    globalThis.fetch = transport;
    try {
      await ringVendor(ctxFor(db, { REALTIME_BASE: "" } as never), REQUEST);
    } finally {
      globalThis.fetch = undefined as unknown as typeof fetch;
    }
    assert.deepEqual(calls, []);
    assert.deepEqual(db.calls, []);
  });
});
