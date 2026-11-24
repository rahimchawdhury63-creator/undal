/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The push payload: data only, high priority, short TTL, signed.
 *
 * These are the four properties that decide whether an alarm reaches a locked phone, and each of them is
 * asserted on the built value rather than on the source — a payload is what a device parses, and a
 * comment promising no `notification` block is not the same thing as an object without one.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_ALARM_MAX_MS,
  FCM_DATA_VERSION,
  MAX_TTL_SECONDS,
  ORDER_TTL_SECONDS,
  buildOrderPush,
  signatureOf,
  ttlSecondsFor,
  withToken,
} from "../src/fcm/payload.ts";
import type { OrderPushInput } from "../src/fcm/payload.ts";

const KEY = "test-fcm-sig-key";
const T0 = 1_793_612_345_678;

/** An input with everything an offer carries, so a test overrides only what it is about. */
function input(overrides: Partial<OrderPushInput> = {}): OrderPushInput {
  return {
    type: "ORDER_NEW",
    severity: "CRITICAL",
    orderId: "UND-7K2M9QX4",
    orderCode: "7K2M9QX4",
    vendorId: "0193f2a1-0000-7000-8000-000000000002",
    issuedAtMs: T0,
    expiresAtMs: T0 + ORDER_TTL_SECONDS * 1_000,
    itemCount: 3,
    totalPaisa: 54_900,
    customerArea: "Shibganj",
    alarm: "loop",
    alarmMaxMs: DEFAULT_ALARM_MAX_MS,
    attempt: 1,
    ...overrides,
  };
}

/** Every key in an object tree, so "no notification block, at any depth" can be asserted literally. */
function keysDeep(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysDeep(item, into);
    return into;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      keysDeep(child, into);
    }
  }
  return into;
}

describe("a data-only payload", () => {
  test("there is no notification block, at any depth", async () => {
    const message = withToken(await buildOrderPush(input(), KEY), "device-token");
    assert.equal(keysDeep(message).has("notification"), false);
  });

  test("the message is exactly a token, a data map and an android block", async () => {
    const message = withToken(await buildOrderPush(input(), KEY), "device-token");
    assert.deepEqual(Object.keys(message).sort(), ["android", "data", "token"]);
  });

  test("every data value is a string, because the client's map is a string map", async () => {
    const envelope = await buildOrderPush(input(), KEY);
    for (const [key, value] of Object.entries(envelope.data)) {
      assert.equal(typeof value, "string", `${key} is not a string`);
    }
  });

  test("the fields the client validates against are all present", async () => {
    const { data } = await buildOrderPush(input(), KEY);
    for (const key of [
      "v",
      "type",
      "severity",
      "orderId",
      "orderCode",
      "vendorId",
      "issuedAt",
      "expiresAt",
      "itemCount",
      "totalPaisa",
      "customerArea",
      "alarm",
      "alarmMaxMs",
      "attempt",
      "sig",
    ]) {
      assert.ok(key in data, `${key} is missing`);
    }
    assert.equal(data["v"], FCM_DATA_VERSION);
  });

  test("money crosses the wire as integer paisa, never a decimal", async () => {
    const { data } = await buildOrderPush(input({ totalPaisa: 54_900 }), KEY);
    assert.equal(data["totalPaisa"], "54900");
  });

  test("a fractional amount is refused rather than rounded", async () => {
    await assert.rejects(buildOrderPush(input({ totalPaisa: 549.5 }), KEY), /integer number of paisa/u);
  });
});

describe("priority and TTL", () => {
  test("a critical message asks for high priority", async () => {
    const envelope = await buildOrderPush(input({ severity: "CRITICAL" }), KEY);
    assert.equal(envelope.android.priority, "high");
  });

  test("a non-critical message does not", async () => {
    const envelope = await buildOrderPush(input({ severity: "NORMAL" }), KEY);
    assert.equal(envelope.android.priority, "normal");
  });

  test("an offer's TTL is two minutes", async () => {
    const envelope = await buildOrderPush(input(), KEY);
    assert.equal(envelope.android.ttl, "120s");
    assert.equal(envelope.data["expiresAt"], String(T0 + 120_000));
  });

  test("a TTL longer than five minutes is clamped", async () => {
    const envelope = await buildOrderPush(input({ expiresAtMs: T0 + 3_600_000 }), KEY);
    assert.equal(envelope.android.ttl, "300s");
    assert.equal(MAX_TTL_SECONDS, 300);
  });

  test("an already-expired window still asks for the shortest legal TTL", () => {
    assert.equal(ttlSecondsFor(T0, T0 - 5_000), 1);
  });

  test("a window shorter than a second rounds up, so the message is not born dead", () => {
    assert.equal(ttlSecondsFor(T0, T0 + 400), 1);
  });

  test("direct boot is on, so a rebooted phone still rings", async () => {
    const envelope = await buildOrderPush(input(), KEY);
    assert.equal(envelope.android.direct_boot_ok, true);
  });

  test("the collapse key is the order, so a second alarm replaces the first", async () => {
    const envelope = await buildOrderPush(input(), KEY);
    assert.equal(envelope.android.collapse_key, "order_UND-7K2M9QX4");
  });

  test("the second and third attempts differ only in the attempt field and the signature", async () => {
    const first = await buildOrderPush(input({ attempt: 1 }), KEY);
    const third = await buildOrderPush(input({ attempt: 3 }), KEY);
    assert.equal(first.data["attempt"], "1");
    assert.equal(third.data["attempt"], "3");
    assert.notEqual(first.data["sig"], third.data["sig"]);
  });
});

describe("the signature", () => {
  test("covers the sorted data map, hex encoded and 64 characters", async () => {
    const { data } = await buildOrderPush(input(), KEY);
    assert.match(data["sig"] ?? "", /^[0-9a-f]{64}$/u);
  });

  test("verifies over the map the client rebuilds, and nothing else", async () => {
    const { data } = await buildOrderPush(input(), KEY);
    const { sig, ...rest } = data;
    assert.equal(sig, await signatureOf(rest, KEY));
  });

  test("changes when any field changes", async () => {
    const a = await buildOrderPush(input(), KEY);
    const b = await buildOrderPush(input({ totalPaisa: 54_901 }), KEY);
    assert.notEqual(a.data["sig"], b.data["sig"]);
  });

  test("changes with the key, so a payload signed by another environment does not verify", async () => {
    const a = await buildOrderPush(input(), KEY);
    const b = await buildOrderPush(input(), "another-key");
    assert.notEqual(a.data["sig"], b.data["sig"]);
  });

  test("does not depend on the order the map was written in", async () => {
    const map = { b: "2", a: "1", c: "3" };
    const reordered = { c: "3", a: "1", b: "2" };
    assert.equal(await signatureOf(map, KEY), await signatureOf(reordered, KEY));
  });

  test("excludes the sig key itself, so it can be computed once", async () => {
    const map = { a: "1" };
    assert.equal(await signatureOf(map, KEY), await signatureOf({ ...map, sig: "anything" }, KEY));
  });
});
