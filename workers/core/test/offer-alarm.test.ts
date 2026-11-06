/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The alarm a rider is sent when an offer is written (`11 §7`, D127).
 *
 * Two properties are load-bearing and both are asserted rather than trusted to review. The payload is **data only** —
 * no platform alert object, because letting the OS draw it means the full-screen alarm never appears on several Android
 * builds. And the **countdown comes from the offer's expiry**, not from a caller's arithmetic, so a delayed send shows
 * a truthful number instead of a hopeful one.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { offerAlarm } from "../src/domain/order/offer-alarm.ts";

const NOW = 1_700_000_000_000;

function alarm(overrides: Partial<Parameters<typeof offerAlarm>[0]> = {}) {
  return offerAlarm({
    orderCode: "UND-7K2M9QX4",
    offerId: "0193f2a17c3e7890abcdef0123456721",
    payoutPaisa: 8_400,
    pickupDistanceM: 1_240,
    expiresAtMs: NOW + 25_000,
    nowMs: NOW,
    ...overrides,
  });
}

describe("the offer alarm (D127)", () => {
  test("the countdown is derived from the offer's own expiry", () => {
    assert.equal(alarm().data.secondsRemaining, 25);
    assert.equal(alarm({ nowMs: NOW + 20_000 }).data.secondsRemaining, 5);
  });

  test("an already-expired offer still produces a message, counting down from zero", () => {
    const late = alarm({ nowMs: NOW + 60_000 });
    assert.equal(late.data.secondsRemaining, 0);
    assert.match(late.body.en, /0s to accept/u);
  });

  test("the payout is rendered in taka from paisa, and distance has one decimal", () => {
    const built = alarm();
    assert.match(built.body.en, /৳84 ·/u);
    assert.match(built.body.en, /1\.2 km to pick up/u);
    assert.match(built.body.bn, /৳৮৪|৳84/u);
  });

  test("a short distance is metres, not a fraction of a kilometre", () => {
    assert.match(alarm({ pickupDistanceM: 640 }).body.en, /640 m/u);
  });

  test("the payload is data only and carries what the app needs to draw the alarm", () => {
    const built = alarm();
    assert.deepEqual(Object.keys(built.data).sort(), [
      "expiresAtMs",
      "offerId",
      "orderCode",
      "payoutPaisa",
      "pickupDistanceM",
      "secondsRemaining",
    ]);
    assert.equal(built.data.expiresAtMs, NOW + 25_000);
    assert.equal(built.data.orderCode, "UND-7K2M9QX4");
  });

  test("both languages are always present, and they differ", () => {
    const built = alarm();
    assert.notEqual(built.title.en, built.title.bn);
    assert.notEqual(built.body.en, built.body.bn);
    assert.match(built.title.bn, /[\u0980-\u09FF]/u, "the Bangla title is in Bangla script");
  });

  test("the event name is the catalogue's, so the app switches on one string", () => {
    assert.equal(alarm().event, "offer.new");
  });
});
