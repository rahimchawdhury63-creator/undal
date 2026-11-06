/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The numbers dispatch filters with, and the TiDB half of a candidate (`11 §7`, `§9`, D118).
 *
 * Two things are being pinned here that had no test because they had no code. The first is the policy table:
 * `max_concurrent` and the vehicle radius were cited in `11 §7` and implemented nowhere, so the risk was not a
 * wrong number but a *new* one, invented at whichever call site wrote the wave eventually. The second is the
 * candidate statement: everything it excludes must be something no relaxation could ever re-admit, because
 * anything else it excludes is a refusal the rider never gets told about.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_CASH_LIMIT_PAISA,
  FALLBACK_RELAXATION,
  VEHICLE_POLICY,
  relaxForFallback,
  vehiclePolicy,
} from "../src/domain/order/dispatch-policy.ts";
import {
  insertOfferWave,
  rejectedWavesForOrder,
  ridersInZone,
  type WaveOffer,
} from "../src/repositories/dispatch.ts";
import { stubDb } from "../src/db/client.ts";

const ZONE_HEX = "0193f2a17c3e7890abcdef0123456703";
const RIDER_HEX = "0193f2a17c3e7890abcdef0123456707";
const USER_HEX = "0193f2a17c3e7890abcdef0123456701";
const ORDER_HEX_2 = "0193f2a17c3e7890abcdef0123456705";

function bytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "hex"));
}

function candidateRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rider_id: Uint8Array.from(Buffer.from(RIDER_HEX, "hex")),
    user_id: Uint8Array.from(Buffer.from(USER_HEX, "hex")),
    code: "RDR-4K2M",
    status: "APPROVED",
    shift_state: "ONLINE",
    vehicle: "MOTORBIKE",
    zone_id: ZONE_HEX,
    selfie_verified: 1,
    cash_collected_paisa: 12_500,
    active_load: 2,
    ...overrides,
  };
}

describe("the vehicle policy table (11 §7 filters 8–9)", () => {
  test("each vehicle's radius and concurrent ceiling is the documented one", () => {
    assert.deepEqual(VEHICLE_POLICY.BICYCLE, { maxRadiusM: 4_000, maxConcurrent: 1 });
    assert.deepEqual(VEHICLE_POLICY.MOTORBIKE, { maxRadiusM: 12_000, maxConcurrent: 3 });
  });

  test("the table cannot be edited by a caller with a reference to it", () => {
    assert.throws(() => {
      (VEHICLE_POLICY as unknown as Record<string, unknown>)["BICYCLE"] = { maxRadiusM: 40_000, maxConcurrent: 9 };
    });
  });

  test("an unknown vehicle has no limits rather than borrowed ones", () => {
    assert.equal(vehiclePolicy("TRUCK"), null);
    assert.equal(vehiclePolicy(""), null);
    assert.equal(vehiclePolicy("bicycle"), null, "a case slip is a data error, not a bicycle");
    assert.deepEqual(vehiclePolicy("BICYCLE"), { maxRadiusM: 4_000, maxConcurrent: 1 });
  });

  test("the default cash ceiling is the settlement threshold", () => {
    assert.equal(DEFAULT_CASH_LIMIT_PAISA, 350_000);
  });
});

describe("the T+112 s relaxation (11 §9 fallback row 1)", () => {
  test("radius and cash cap loosen by a fifth, and the load ceiling does not move", () => {
    const relaxed = relaxForFallback(VEHICLE_POLICY.MOTORBIKE, DEFAULT_CASH_LIMIT_PAISA);
    assert.deepEqual(relaxed, {
      maxRadiusM: 14_400,
      maxConcurrent: 3,
      cashLimitPaisa: 420_000,
      zoneEdgeAllowanceM: 3_000,
    });
  });

  test("a bicycle's 4 km becomes 4.8 km, not the motorbike's radius", () => {
    const relaxed = relaxForFallback(VEHICLE_POLICY.BICYCLE, DEFAULT_CASH_LIMIT_PAISA);
    assert.equal(relaxed.maxRadiusM, 4_800);
    assert.equal(relaxed.maxConcurrent, 1, "a slow order is not a reason to let one rider carry two bags");
  });

  test("the relaxed limit never lands short of the documented figure", () => {
    // 350 000 × 1.2 in binary floating point is 419 999.99999999994; the promise is 420 000.
    assert.equal(relaxForFallback(VEHICLE_POLICY.MOTORBIKE, 350_000).cashLimitPaisa, 420_000);
    assert.equal(relaxForFallback(VEHICLE_POLICY.BICYCLE, 123_457).cashLimitPaisa, Math.ceil(123_457 * 1.2));
  });

  test("the relaxation is data, so a caller cannot widen it in place", () => {
    assert.equal(FALLBACK_RELAXATION.radiusFactor, 1.2);
    assert.equal(FALLBACK_RELAXATION.cashLimitFactor, 1.2);
    assert.equal(FALLBACK_RELAXATION.outsideZoneEdgeM, 3_000);
    assert.throws(() => {
      (FALLBACK_RELAXATION as unknown as Record<string, unknown>)["outsideZoneEdgeM"] = 30_000;
    });
  });
});

describe("reading a zone's candidates from TiDB (D118)", () => {
  test("the statement excludes only what no relaxation could re-admit", async () => {
    const db = stubDb([{ match: /FROM `riders` r/u, rows: [candidateRow()] }]);
    await ridersInZone(db, ZONE_HEX);
    const [call] = db.calls;
    assert.ok(call !== undefined);
    assert.deepEqual(call.params, [ZONE_HEX], "one zone, one parameter");
    assert.match(call.sql, /s\.`ended_at` IS NULL/u, "a closed shift is not a candidate");
    assert.match(call.sql, /r\.`status` = 'APPROVED'/u);
    assert.match(call.sql, /r\.`shift_state` IN \('ONLINE', 'ON_ORDER', 'BREAK'\)/u);
    assert.doesNotMatch(call.sql, /CASH_LOCKED/u, "a cash-locked rider is excluded before any filter, on purpose");
    assert.doesNotMatch(call.sql, /VERIFYING/u, "the selfie check is a gate, not a filter");
    assert.match(call.sql, /LIMIT 200/u, "a zone cannot make one query unbounded");
  });

  test("the active load counts the three states a delivered order is not in", async () => {
    const db = stubDb([{ match: /FROM `riders` r/u, rows: [] }]);
    await ridersInZone(db, ZONE_HEX);
    const sql = db.calls[0]?.sql ?? "";
    assert.match(sql, /o\.`state` IN \('RIDER_ASSIGNED', 'PICKED_UP', 'ARRIVED'\)/u);
  });

  test("a row arrives with its limits already resolved, keyed by both identities", async () => {
    const db = stubDb([{ match: /FROM `riders` r/u, rows: [candidateRow()] }]);
    const [candidate] = await ridersInZone(db, ZONE_HEX);
    assert.ok(candidate !== undefined);
    assert.equal(Buffer.from(candidate.riderId).toString("hex"), RIDER_HEX);
    assert.equal(Buffer.from(candidate.userId).toString("hex"), USER_HEX, "the feed joins on this, never on riderId");
    assert.equal(candidate.shiftState, "ONLINE");
    assert.equal(candidate.selfieVerified, true);
    assert.equal(candidate.activeLoad, 2);
    assert.deepEqual(candidate.policy, { maxRadiusM: 12_000, maxConcurrent: 3 });
    assert.equal(candidate.cashLimitPaisa, DEFAULT_CASH_LIMIT_PAISA);
  });

  test("a rider on a break is BREAK here and ON_BREAK on the snapshot, never OFFLINE", async () => {
    const db = stubDb([
      {
        match: /FROM `riders` r/u,
        rows: [candidateRow({ shift_state: "BREAK" }), candidateRow({ shift_state: "ON_ORDER", code: "RDR-99" })],
      },
    ]);
    const candidates = await ridersInZone(db, ZONE_HEX);
    assert.deepEqual(
      candidates.map((c) => c.shiftState),
      ["BREAK", "ON_ORDER"],
    );
  });

  test("a row whose state the mapper does not believe is dropped, not guessed at", async () => {
    const db = stubDb([{ match: /FROM `riders` r/u, rows: [candidateRow({ shift_state: "OFFLINE" })] }]);
    assert.deepEqual(await ridersInZone(db, ZONE_HEX), []);
  });

  test("an unknown vehicle is a candidate with no limits, so filter 8 can refuse it by name", async () => {
    const db = stubDb([{ match: /FROM `riders` r/u, rows: [candidateRow({ vehicle: "TRUCK" })] }]);
    const [candidate] = await ridersInZone(db, ZONE_HEX);
    assert.ok(candidate !== undefined);
    assert.equal(candidate.policy, null);
    assert.equal(candidate.vehicle, "TRUCK", "the row is still reported, with the vehicle that caused it");
  });

  test("a cash figure read back as a string is still a number", async () => {
    const db = stubDb([
      { match: /FROM `riders` r/u, rows: [candidateRow({ cash_collected_paisa: "250000", active_load: "0", selfie_verified: 0 })] },
    ]);
    const [candidate] = await ridersInZone(db, ZONE_HEX);
    assert.equal(candidate?.cashCollectedPaisa, 250_000);
    assert.equal(candidate?.activeLoad, 0);
    assert.equal(candidate?.selfieVerified, false, "selfie_verified 0 is not verified");
  });

  test("a zone with nobody in it costs one statement and returns nothing", async () => {
    const db = stubDb([{ match: /FROM `riders` r/u, rows: [] }]);
    assert.deepEqual(await ridersInZone(db, ZONE_HEX), []);
    assert.equal(db.calls.length, 1);
  });
});

describe("writing a wave (D121)", () => {
  const ORDER_HEX = "0193f2a17c3e7890abcdef0123456705";
  const TRACE_HEX = "0193f2a17c3e7890abcdef0123456721";
  const OTHER_RIDER_HEX = "0193f2a17c3e7890abcdef0123456711";

  function offer(rider: string, rank: number, score = 0.75): WaveOffer {
    return { id: bytes(rider), riderId: bytes(rider), rankInWave: rank, score, payoutPaisa: 8_400, propensity: null };
  }

  test("eight offers are one statement with one instant", async () => {
    const db = stubDb([{ match: /INSERT INTO `order_offers`/u, affectedRows: 8 }]);
    const riders = Array.from({ length: 8 }, (_, i) =>
      offer(`0193f2a17c3e7890abcdef01234567${(16 + i).toString(16).padStart(2, "0")}`, i + 1),
    );
    const written = await insertOfferWave(db, {
      orderId: bytes(ORDER_HEX),
      wave: 1,
      traceId: bytes(TRACE_HEX),
      offeredAtMs: 1_700_000_000_000,
      expiresAtMs: 1_700_000_025_000,
      offers: riders,
    });
    assert.equal(written, 8);
    assert.equal(db.calls.length, 1, "one statement, not eight");
    const [insert] = db.calls;
    assert.ok(insert !== undefined);
    assert.equal(insert.params.length, 88, "eleven bindings per row: the feature vector rides with the offer (D134)");
    assert.match(insert.sql, /VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?\),/u);
    assert.match(insert.sql, /`propensity_features`/u);
    // Every row carries the same offered_at and expires_at: the TTL is a promise about the wave.
    const offeredAt = new Set(insert.params.filter((_, i) => i % 11 === 9));
    const expiresAt = new Set(insert.params.filter((_, i) => i % 11 === 10));
    assert.equal(offeredAt.size, 1, "one offered_at for the whole wave");
    assert.equal(expiresAt.size, 1, "one expires_at for the whole wave");
    assert.notEqual([...offeredAt][0], [...expiresAt][0]);
    assert.equal(insert.params[3], 1, "the wave number is on every row");
  });

  test("rank and score travel with the rider they belong to", async () => {
    const db = stubDb([{ match: /INSERT INTO `order_offers`/u, affectedRows: 2 }]);
    await insertOfferWave(db, {
      orderId: bytes(ORDER_HEX),
      wave: 3,
      traceId: bytes(TRACE_HEX),
      offeredAtMs: 1_700_000_000_000,
      expiresAtMs: 1_700_000_020_000,
      offers: [offer(RIDER_HEX, 1, 0.9), offer(OTHER_RIDER_HEX, 2, 0.8)],
    });
    const params = db.calls[0]?.params ?? [];
    assert.deepEqual(params.slice(3, 6), [3, 1, 0.9]);
    assert.deepEqual(params.slice(14, 17), [3, 2, 0.8]);
  });

  test("the feature vector rides with the offer, as JSON (D134)", async () => {
    const db = stubDb([{ match: /INSERT INTO `order_offers`/u, affectedRows: 2 }]);
    const vector = [0.84, 0.15, 0.3, 0.5, 0.62, 0.38, 0, 0];
    await insertOfferWave(db, {
      orderId: bytes(ORDER_HEX),
      wave: 1,
      traceId: bytes(TRACE_HEX),
      offeredAtMs: 1_700_000_000_000,
      expiresAtMs: 1_700_000_025_000,
      offers: [
        { ...offer(RIDER_HEX, 1, 0.9), propensity: vector },
        { ...offer(OTHER_RIDER_HEX, 2, 0.8), propensity: null },
      ],
    });
    const params = db.calls[0]?.params ?? [];
    assert.equal(params[8], JSON.stringify(vector), "the column is JSON, so the driver gets a string");
    assert.equal(params[19], null, "an offer judged without a model records nothing, not zeroes");
  });

  test("an empty wave writes nothing at all", async () => {
    const db = stubDb([{ match: /INSERT INTO `order_offers`/u, affectedRows: 0 }]);
    const written = await insertOfferWave(db, {
      orderId: bytes(ORDER_HEX),
      wave: 5,
      traceId: bytes(TRACE_HEX),
      offeredAtMs: 1_700_000_000_000,
      expiresAtMs: 1_700_000_020_000,
      offers: [],
    });
    assert.equal(written, 0);
    assert.equal(db.calls.length, 0, "no statement, not a malformed one");
  });

  test("asking the same rider twice in one wave is refused before the database sees it", async () => {
    const db = stubDb([{ match: /INSERT INTO `order_offers`/u, affectedRows: 2 }]);
    await assert.rejects(
      insertOfferWave(db, {
        orderId: bytes(ORDER_HEX),
        wave: 1,
        traceId: bytes(TRACE_HEX),
        offeredAtMs: 1_700_000_000_000,
        expiresAtMs: 1_700_000_025_000,
        offers: [offer(RIDER_HEX, 1), offer(RIDER_HEX, 2)],
      }),
      RangeError,
    );
    assert.equal(db.calls.length, 0, "the unique index is the second line of defence, not the first");
  });

  test("an offer that expires when it was written is refused", async () => {
    const db = stubDb([{ match: /INSERT INTO `order_offers`/u, affectedRows: 1 }]);
    await assert.rejects(
      insertOfferWave(db, {
        orderId: bytes(ORDER_HEX),
        wave: 1,
        traceId: bytes(TRACE_HEX),
        offeredAtMs: 1_700_000_000_000,
        expiresAtMs: 1_700_000_000_000,
        offers: [offer(RIDER_HEX, 1)],
      }),
      RangeError,
    );
    assert.equal(db.calls.length, 0);
  });
});

describe("the rejections filter 12 needs (D121)", () => {
  test("only explicit refusals count, and they are grouped by rider", async () => {
    const db = stubDb([
      {
        match: /FROM `order_offers`\s+WHERE `order_id` = \? AND `response` = 'REJECTED'/u,
        rows: [
          { rider_id: bytes(RIDER_HEX), wave: 1 },
          { rider_id: bytes(RIDER_HEX), wave: 3 },
          { rider_id: bytes("0193F2A17C3E7890ABCDEF0123456711"), wave: 2 },
        ],
      },
    ]);
    const rejected = await rejectedWavesForOrder(db, bytes(ORDER_HEX_2));
    assert.equal(db.calls.length, 1);
    assert.match(db.calls[0]?.sql ?? "", /AND `response` = 'REJECTED'/u, "expiry and withdrawal are not refusals");
    assert.match(db.calls[0]?.sql ?? "", /ORDER BY `wave` ASC/u);
    assert.deepEqual([...(rejected.get(RIDER_HEX) ?? [])], [1, 3]);
    assert.deepEqual(
      [...(rejected.get("0193f2a17c3e7890abcdef0123456711") ?? [])],
      [2],
      "TiDB's hex is normalised to lower case so the assembly's lookups match",
    );
  });

  test("an order nobody refused is an empty map, not an empty entry", async () => {
    const db = stubDb([{ match: /FROM `order_offers`/u, rows: [] }]);
    assert.equal((await rejectedWavesForOrder(db, bytes(ORDER_HEX_2))).size, 0);
  });
});
