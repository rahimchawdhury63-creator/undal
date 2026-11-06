/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The history a rider is scored on (`11 §5`, D125).
 *
 * The Wilson bound is the part worth testing hardest: it is the reason a rider with one accepted offer does not
 * outrank one with four hundred, and the reason a rider with no history scores zero rather than one. The loader is
 * tested for the merge — three separate statements whose rows must combine into one history each — because three
 * queries answering about the same rider is exactly where a `set` overwrites instead of merges.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { idleSeconds, riderHistory } from "../src/repositories/dispatch-stats.ts";
import { acceptanceFrom, medianDeliveries, ratesFrom, startOfDayMs } from "../src/domain/order/dispatch-facts.ts";
import { wilsonLowerBound } from "../src/domain/order/scoring.ts";
import { stubDb } from "../src/db/client.ts";

const RIDER_HEX = "0193f2a17c3e7890abcdef0123456707";
const OTHER_HEX = "0193f2a17c3e7890abcdef0123456711";
const VENDOR_HEX = "0193f2a17c3e7890abcdef0123456709";
const NOW = 1_700_000_000_000;

function bytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "hex"));
}

describe("the Wilson lower bound (11 §5 factors 3, 4, 6)", () => {
  test("no observations is zero, not a hopeful half", () => {
    assert.equal(wilsonLowerBound(0, 0), 0);
    assert.equal(wilsonLowerBound(0, -3), 0);
  });

  test("one success out of one is priced as inexperience, not as a perfect rate", () => {
    const one = wilsonLowerBound(1, 1);
    assert.ok(one < 0.25, `one of one scored ${String(one)}`);
    assert.ok(one > 0);
  });

  test("a veteran's many successes approach their real rate, from below", () => {
    const veteran = wilsonLowerBound(300, 400);
    assert.ok(veteran > 0.7);
    assert.ok(veteran < 0.75, "still a lower bound");
  });

  test("the one-of-one rider is outranked by the veteran, which is the whole point", () => {
    assert.ok(wilsonLowerBound(300, 400) > wilsonLowerBound(1, 1));
  });

  test("an inconsistent aggregate cannot escape the unit interval", () => {
    assert.equal(wilsonLowerBound(10, 5), wilsonLowerBound(5, 5));
    assert.ok(wilsonLowerBound(10, 5) <= 1);
  });
});

describe("reading a candidate list's history (D125)", () => {
  function dbFor(): ReturnType<typeof stubDb> {
    return stubDb([
      {
        match: /FROM `rider_stats` WHERE `rider_id` IN \(\?[^)]*\) AND `stat_date`/u,
        rows: [{ rider_id: bytes(RIDER_HEX), deliveries: 4, offers_sent: 9, offers_accepted: 6 }],
      },
      {
        match: /FROM `rider_stats` WHERE `rider_id` IN \(\?[^)]*\) GROUP BY/u,
        rows: [{ rider_id: bytes(RIDER_HEX), sent: 320, accepted: 240 }],
      },
      {
        match: /FROM `orders` WHERE `rider_id` IN/u,
        rows: [{ rider_id: bytes(RIDER_HEX), delivered: 210, from_vendor: 12, last_delivered: "2023-11-14 22:00:00.000000" }],
      },
    ]);
  }

  test("three statements cover the whole candidate list, whatever its size", async () => {
    const db = dbFor();
    await riderHistory(db, {
      riderIds: [bytes(RIDER_HEX), bytes(OTHER_HEX)],
      vendorId: bytes(VENDOR_HEX),
      nowMs: NOW,
      dayStartMs: NOW - 3_600_000,
    });
    assert.equal(db.calls.length, 3);
    for (const call of db.calls) {
      assert.match(call.sql, /IN \(\?, \?\)/u, "one placeholder per candidate, never a query per candidate");
    }
  });

  test("the three answers merge into one history per rider", async () => {
    const history = await riderHistory(dbFor(), {
      riderIds: [bytes(RIDER_HEX)],
      vendorId: bytes(VENDOR_HEX),
      nowMs: NOW,
      dayStartMs: NOW - 3_600_000,
    });
    const rider = history.get(RIDER_HEX);
    assert.ok(rider !== undefined);
    assert.equal(rider.deliveriesToday, 4);
    assert.equal(rider.offersAcceptedLifetime, 240);
    assert.equal(rider.deliveredFromVendor, 12);
    assert.equal(rider.deliveredLifetime, 210);
    assert.equal(rider.lastDeliveredAtMs, Date.parse("2023-11-14T22:00:00.000Z"));
  });

  test("a rider with no history at all is absent from the map, which the caller reads as empty", async () => {
    const db = stubDb([
      { match: /rider_stats/u, rows: [] },
      { match: /FROM `orders`/u, rows: [] },
    ]);
    const history = await riderHistory(db, {
      riderIds: [bytes(RIDER_HEX)],
      vendorId: bytes(VENDOR_HEX),
      nowMs: NOW,
      dayStartMs: NOW,
    });
    assert.equal(history.size, 0);
  });

  test("an empty candidate list costs no queries", async () => {
    const db = dbFor();
    const history = await riderHistory(db, {
      riderIds: [],
      vendorId: bytes(VENDOR_HEX),
      nowMs: NOW,
      dayStartMs: NOW,
    });
    assert.equal(history.size, 0);
    assert.equal(db.calls.length, 0);
  });

  test("the vendor is the first binding of the delivery query, so the split is right", async () => {
    const db = dbFor();
    await riderHistory(db, {
      riderIds: [bytes(RIDER_HEX)],
      vendorId: bytes(VENDOR_HEX),
      nowMs: NOW,
      dayStartMs: NOW,
    });
    const delivery = db.calls.find((call) => /FROM `orders`/u.test(call.sql));
    assert.ok(delivery !== undefined);
    assert.deepEqual(delivery.params[0], bytes(VENDOR_HEX));
    assert.match(delivery.sql, /state` IN \('DELIVERED', 'SETTLED'\)/u, "settlement bookkeeping is not lateness");
  });

  test("idle time is measured from the last delivery and capped at a day", () => {
    const base = {
      deliveriesToday: 0,
      offersSentToday: 0,
      offersAcceptedToday: 0,
      offersSentLifetime: 0,
      offersAcceptedLifetime: 0,
      deliveredFromVendor: 0,
      deliveredLifetime: 1,
      rating: null,
    };
    assert.equal(idleSeconds({ ...base, lastDeliveredAtMs: NOW - 600_000 }, NOW), 600);
    assert.equal(idleSeconds({ ...base, lastDeliveredAtMs: null }, NOW), 0, "never delivered is zero idle, not infinite");
    assert.equal(idleSeconds({ ...base, lastDeliveredAtMs: NOW - 2 * 86_400_000 }, NOW), 86_400);
    assert.equal(idleSeconds({ ...base, lastDeliveredAtMs: NOW + 5_000 }, NOW), 0, "a future stamp is not idle time");
  });
});

describe("history into factors (D129)", () => {
  const base = {
    deliveriesToday: 0,
    offersSentToday: 0,
    offersAcceptedToday: 0,
    offersSentLifetime: 0,
    offersAcceptedLifetime: 0,
    deliveredFromVendor: 0,
    deliveredLifetime: 0,
    lastDeliveredAtMs: null,
    rating: null,
  };

  test("acceptance is the Wilson bound of lifetime offers, and zero without any", () => {
    assert.equal(acceptanceFrom(undefined), 0);
    assert.equal(acceptanceFrom({ ...base, offersSentLifetime: 0 }), 0);
    assert.ok(acceptanceFrom({ ...base, offersSentLifetime: 400, offersAcceptedLifetime: 300 }) > 0.7);
  });

  test("completion is deliveries over accepted offers, and on-time borrows it until lateness is recorded", () => {
    const rates = ratesFrom({ ...base, offersAcceptedLifetime: 100, deliveredLifetime: 95 });
    assert.ok(rates.completion > 0.85 && rates.completion < 0.95);
    assert.equal(rates.onTime, rates.completion);
    assert.deepEqual(ratesFrom(undefined), { completion: 0, onTime: 0 });
  });

  test("the median is over the riders in play, and an even count averages the middle two", () => {
    const history = new Map([
      ["a", { ...base, deliveriesToday: 1 }],
      ["b", { ...base, deliveriesToday: 5 }],
      ["c", { ...base, deliveriesToday: 6 }],
      ["d", { ...base, deliveriesToday: 12 }],
    ]);
    assert.equal(medianDeliveries(history), 5.5);
    assert.equal(medianDeliveries(new Map()), 0);
  });

  test("the day boundary is UTC midnight of the instant", () => {
    assert.equal(startOfDayMs(Date.parse("2023-11-14T22:13:20.000Z")), Date.parse("2023-11-14T00:00:00.000Z"));
  });
});
