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
import { ridersInZone } from "../src/repositories/dispatch.ts";
import { stubDb } from "../src/db/client.ts";

const ZONE_HEX = "0193f2a17c3e7890abcdef0123456703";
const RIDER_HEX = "0193f2a17c3e7890abcdef0123456707";
const USER_HEX = "0193f2a17c3e7890abcdef0123456701";

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
