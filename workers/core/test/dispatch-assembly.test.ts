/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Joining the two halves of a candidate (`11 §7`, D120).
 *
 * The test that matters most is the identity one: the feed is keyed by the token's `sub` and the offer table by
 * `riders.id`, and a join on the wrong one does not throw — it makes every rider look unconnected, so every wave is
 * empty and nothing in the logs says why. That is D110's bug seen from the read side, and it is asserted here as a
 * difference in behaviour rather than as a comment.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { PointE7 } from "@undal/contracts";
import { FILTERS } from "../src/domain/order/assignment.ts";
import { assembleSnapshots, type AssemblyInput, type FeedFix } from "../src/domain/order/dispatch-assembly.ts";
import { VEHICLE_POLICY } from "../src/domain/order/dispatch-policy.ts";
import { distanceOutsideZoneM, parseZoneRing, type ZoneRing } from "../src/domain/geo/zone-shape.ts";
import type { DispatchCandidate } from "../src/repositories/dispatch.ts";

const ZONE_HEX = "0193f2a17c3e7890abcdef0123456703";
const RIDER_HEX = "0193f2a17c3e7890abcdef0123456707";
const USER_HEX = "0193f2a17c3e7890abcdef0123456701";
const VENDOR_HEX = "0193f2a17c3e7890abcdef0123456709";

const LAT0 = 248_981_000;
const LON0 = 918_698_000;
const STEP = 10_000;

const NOW = 1_700_000_000_000;

function ring(): ZoneRing {
  const parsed = parseZoneRing([
    [LON0 - 49 * STEP, LAT0 - 45 * STEP],
    [LON0 + 49 * STEP, LAT0 - 45 * STEP],
    [LON0 + 49 * STEP, LAT0 + 45 * STEP],
    [LON0 - 49 * STEP, LAT0 + 45 * STEP],
    [LON0 - 49 * STEP, LAT0 - 45 * STEP],
  ]);
  assert.ok(parsed !== null);
  return parsed;
}

function bytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "hex"));
}

function candidate(overrides: Partial<DispatchCandidate> = {}): DispatchCandidate {
  return {
    riderId: bytes(RIDER_HEX),
    userId: bytes(USER_HEX),
    code: "RDR-4K2M",
    status: "APPROVED",
    shiftState: "ONLINE",
    vehicle: "MOTORBIKE",
    zoneId: ZONE_HEX,
    selfieVerified: true,
    cashCollectedPaisa: 0,
    cashOwedPaisa: 0,
    activeLoad: 0,
    policy: VEHICLE_POLICY.MOTORBIKE,
    cashLimitPaisa: 350_000,
    ...overrides,
  };
}

function fix(overrides: Partial<FeedFix> = {}): FeedFix {
  return {
    riderId: USER_HEX,
    latE7: LAT0,
    lonE7: LON0,
    accuracyM: 8,
    batteryPct: 74,
    updatedAtMs: NOW - 4_000,
    staleAfterMs: NOW + 26_000,
    ...overrides,
  };
}

const VENDOR: PointE7 = { latE7: LAT0 + 10 * STEP, lonE7: LON0 + 10 * STEP };

function input(overrides: Partial<AssemblyInput> = {}): AssemblyInput {
  return {
    candidates: [candidate()],
    fixes: [fix()],
    zones: new Map([[ZONE_HEX, ring()]]),
    vendor: VENDOR,
    target: { zoneId: ZONE_HEX, vendorId: VENDOR_HEX, totalPaisa: 24_000 },
    nowMs: NOW,
    signals: {
      rejectedWavesByRider: new Map(),
      notificationsAllowed: new Set([RIDER_HEX]),
      suspendedRiders: new Set(),
      vendorCooldownRiders: new Set(),
    },
    ...overrides,
  };
}

describe("the join (D120)", () => {
  test("the feed is matched by user id, and a row id in the feed is not a match", () => {
    const wrongIdentity = assembleSnapshots(
      input({ fixes: [fix({ riderId: RIDER_HEX, updatedAtMs: NOW - 1_000 })] }),
    );
    const [snapshot] = wrongIdentity.snapshots;
    assert.ok(snapshot !== undefined);
    assert.equal(snapshot.riderId, RIDER_HEX, "the snapshot carries the row an offer will point at");
    assert.equal(
      snapshot.positionAgeS,
      Number.POSITIVE_INFINITY,
      "a feed keyed by rider id must not look like a fix for this rider",
    );
    assert.equal(FILTERS[3]?.passes(snapshot, input().target), false, "filter 4 refuses by name");

    const rightIdentity = assembleSnapshots(input());
    assert.equal(rightIdentity.snapshots[0]?.positionAgeS, 4);
    assert.equal(rightIdentity.snapshots[0]?.riderId, RIDER_HEX);
  });

  test("a snapshot with no live row is still assembled, with an age nobody can measure", () => {
    const { snapshots, refusals } = assembleSnapshots(input({ fixes: [] }));
    assert.equal(refusals.length, 0, "no position is not a data error");
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0]?.positionAgeS, Number.POSITIVE_INFINITY);
    assert.equal(snapshots[0]?.positionStaleAfterS, 0);
  });

  test("two fixes for one rider: the first is used, because the feed is newest-first", () => {
    const { snapshots } = assembleSnapshots(
      input({ fixes: [fix({ updatedAtMs: NOW - 2_000 }), fix({ updatedAtMs: NOW - 60_000 })] }),
    );
    assert.equal(snapshots[0]?.positionAgeS, 2);
  });
});

describe("the fields the snapshot is judged on", () => {
  test("age and budget are both measured from the rider's own row", () => {
    const { snapshots } = assembleSnapshots(
      input({ fixes: [fix({ updatedAtMs: NOW - 7_500, staleAfterMs: NOW + 22_500 })] }),
    );
    assert.equal(snapshots[0]?.positionAgeS, 7, "floored, not rounded up into a refusal");
    assert.equal(snapshots[0]?.positionStaleAfterS, 30, "the budget is the deadline minus the fix");
  });

  test("a clock that reads before the fix does not produce a negative age", () => {
    const { snapshots } = assembleSnapshots(input({ fixes: [fix({ updatedAtMs: NOW + 5_000 })] }));
    assert.equal(snapshots[0]?.positionAgeS, 0);
  });

  test("the routed distance is the straight line to the vendor, in whole metres", () => {
    const { snapshots } = assembleSnapshots(input());
    const expected = Math.round(Math.hypot(10 * 111.19, 10 * 111.19 * Math.cos((24.8981 * Math.PI) / 180)));
    const actual = snapshots[0]?.routedDistanceToVendorM ?? -1;
    assert.ok(Math.abs(actual - expected) <= 2, `${String(actual)} is within 2 m of ${String(expected)}`);
  });

  test("a rider outside their zone carries the distance to its edge, and one inside carries zero", () => {
    const inside = assembleSnapshots(input());
    assert.equal(inside.snapshots[0]?.distanceToZoneEdgeM, 0);

    const outsidePoint = { latE7: LAT0 + 55 * STEP, lonE7: LON0 };
    const outside = assembleSnapshots(input({ fixes: [fix({ latE7: outsidePoint.latE7 })] }));
    assert.equal(outside.snapshots[0]?.distanceToZoneEdgeM, distanceOutsideZoneM(ring(), outsidePoint));
    assert.equal(outside.snapshots[0]?.distanceToZoneEdgeM, 1_112);
  });

  test("the vehicle's limits come from the policy table, not from the row", () => {
    const bicycle = assembleSnapshots(
      input({ candidates: [candidate({ vehicle: "BICYCLE", policy: VEHICLE_POLICY.BICYCLE })] }),
    );
    assert.equal(bicycle.snapshots[0]?.vehicleMaxRadiusM, 4_000);
    assert.equal(bicycle.snapshots[0]?.maxConcurrent, 1);
  });

  test("BREAK becomes ON_BREAK, which filter 2 refuses", () => {
    const { snapshots } = assembleSnapshots(input({ candidates: [candidate({ shiftState: "BREAK" })] }));
    assert.equal(snapshots[0]?.shiftState, "ON_BREAK");
    assert.equal(FILTERS[1]?.passes(snapshots[0]!, input().target), false);
  });

  test("the signals reach the filters they belong to", () => {
    const { snapshots } = assembleSnapshots(
      input({
        signals: {
          rejectedWavesByRider: new Map([[RIDER_HEX, [1, 2]]]),
          notificationsAllowed: new Set(),
          suspendedRiders: new Set([RIDER_HEX]),
          vendorCooldownRiders: new Set([RIDER_HEX]),
        },
      }),
    );
    const snapshot = snapshots[0];
    assert.ok(snapshot !== undefined);
    assert.deepEqual(snapshot.rejectedWaves, [1, 2]);
    assert.equal(snapshot.suspended, true);
    assert.equal(snapshot.vendorCooldown, true);
    assert.equal(snapshot.notificationsAllowed, false);
    assert.equal(FILTERS[5]?.passes(snapshot, input().target), false, "suspension");
    assert.equal(FILTERS[11]?.passes(snapshot, input().target), false, "rejected before");
    assert.equal(FILTERS[12]?.passes(snapshot, input().target), false, "cooldown");
    assert.equal(FILTERS[13]?.passes(snapshot, input().target), false, "notifications");
  });

  test("a rider with no rejections is not refused by absence", () => {
    const { snapshots } = assembleSnapshots(input());
    assert.deepEqual(snapshots[0]?.rejectedWaves, []);
    assert.equal(FILTERS[11]?.passes(snapshots[0]!, input().target), true);
  });
});

describe("what the assembly refuses instead of guessing", () => {
  test("a vehicle the policy does not describe is a refusal with the rider's code", () => {
    const { snapshots, refusals } = assembleSnapshots(
      input({ candidates: [candidate({ vehicle: "TRUCK", policy: null })] }),
    );
    assert.equal(snapshots.length, 0, "no snapshot means no filter can wave a truck through");
    assert.deepEqual(refusals, [{ riderId: RIDER_HEX, code: "RDR-4K2M", reason: "UNKNOWN_VEHICLE" }]);
  });

  test("a zone with no polygon is a refusal, not a zero distance", () => {
    const { snapshots, refusals } = assembleSnapshots(input({ zones: new Map() }));
    assert.equal(snapshots.length, 0);
    assert.deepEqual(refusals, [{ riderId: RIDER_HEX, code: "RDR-4K2M", reason: "ZONE_SHAPE_UNKNOWN" }]);
  });

  test("the zone lookup is case-insensitive on hex, because TiDB's hex output is not always lower", () => {
    const { snapshots, refusals } = assembleSnapshots(
      input({ zones: new Map([[ZONE_HEX.toUpperCase(), ring()]]) }),
    );
    assert.equal(refusals.length, 0);
    assert.equal(snapshots.length, 1);
  });

  test("one bad candidate does not remove the good ones", () => {
    const { snapshots, refusals } = assembleSnapshots(
      input({
        candidates: [
          candidate({ vehicle: "TRUCK", policy: null }),
          candidate({ riderId: bytes("0193f2a17c3e7890abcdef0123456711"), code: "RDR-99" }),
        ],
      }),
    );
    assert.equal(snapshots.length, 1);
    assert.equal(refusals.length, 1);
    assert.equal(snapshots[0]?.riderId, "0193f2a17c3e7890abcdef0123456711", "the second candidate survived");
  });

  test("a part-paid rider goes online with the ceiling reduced by what they still owe (D152)", async () => {
    // `25 §7`: the rider who paid part of a balance may work, "with a reduced cash limit equal to their remaining
    // headroom". The debt is not in this shift's collections, so it has to come from the balance.
    const { snapshots } = assembleSnapshots(
      input({ candidates: [candidate({ cashCollectedPaisa: 12_500, cashOwedPaisa: 114_000 })] }),
    );
    assert.equal(snapshots[0]?.cashInHandPaisa, 126_500, "both halves of what the rider is carrying");
    assert.equal(snapshots[0]?.cashLimitPaisa, 350_000, "the ceiling itself is unchanged; the headroom is what shrinks");
  });
});
