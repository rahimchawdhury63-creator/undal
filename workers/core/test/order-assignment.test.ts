/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  FALLBACK_AT_S,
  FILTERS,
  decideClaim,
  eligibility,
  fallbackDue,
  planWaves,
  waveExpiryMs,
  type AssignmentTarget,
  type RiderSnapshot,
} from "../src/domain/order/assignment.ts";
import { planEffects } from "../src/domain/order/effects.ts";

/**
 * Dispatch and effects, decided as values.
 *
 * Both modules exist so a decision can be asserted without a network or a clock: which rider may be
 * asked, who is asked first, who won a claim, and what a state change must set in motion. The tests
 * mirror the worked example in `11 §7.2` and the fourteen filters of `11 §3`, because a dispatch
 * rule that drifts from the document is a rule nobody can review.
 */

const TARGET: AssignmentTarget = { zoneId: "zone-1", vendorId: "vendor-1", totalPaisa: 55_000 };

const RIDER: RiderSnapshot = {
  riderId: "rider-1",
  status: "APPROVED",
  shiftState: "ONLINE",
  selfieVerified: true,
  positionAgeS: 10,
  positionStaleAfterS: 60,
  cashLocked: false,
  suspended: false,
  zoneId: "zone-1",
  distanceToZoneEdgeM: 0,
  vehicleMaxRadiusM: 12_000,
  routedDistanceToVendorM: 2_000,
  currentLoad: 0,
  maxConcurrent: 3,
  cashInHandPaisa: 0,
  cashLimitPaisa: 350_000,
  rejectedWaves: [],
  vendorCooldown: false,
  notificationsAllowed: true,
};

const rider = (overrides: Partial<RiderSnapshot>): RiderSnapshot => ({ ...RIDER, ...overrides });

describe("the fourteen filters", () => {
  test("a healthy rider passes them all", () => {
    assert.deepEqual(eligibility(RIDER, TARGET), { eligible: true, filter: null, reason: null });
  });

  test("each filter refuses by number, and the number is the document's", () => {
    const cases: readonly (readonly [Partial<RiderSnapshot>, number, string])[] = [
      [{ status: "PENDING" }, 1, "KYC_APPROVED"],
      [{ shiftState: "OFFLINE" }, 2, "ON_SHIFT"],
      [{ selfieVerified: false }, 3, "SELFIE_VERIFIED"],
      [{ positionAgeS: 61 }, 4, "POSITION_FRESH"],
      [{ cashLocked: true }, 5, "NOT_CASH_LOCKED"],
      [{ suspended: true }, 6, "NOT_SUSPENDED"],
      [{ zoneId: "zone-2", distanceToZoneEdgeM: 2_000 }, 7, "ZONE_MATCH_OR_NEAR"],
      [{ routedDistanceToVendorM: 12_001 }, 8, "WITHIN_VEHICLE_RADIUS"],
      [{ currentLoad: 3 }, 9, "UNDER_LOAD_LIMIT"],
      [{ currentLoad: 1 }, 10, "BATCH_FEASIBLE"],
      [{ cashInHandPaisa: 300_000 }, 11, "CASH_WITHIN_LIMIT"],
      [{ rejectedWaves: [1] }, 12, "NOT_ALREADY_REJECTED"],
      [{ vendorCooldown: true }, 13, "NOT_IN_REJECTION_COOLDOWN"],
      [{ notificationsAllowed: false }, 14, "NOTIFICATIONS_ENABLED"],
    ];

    for (const [override, number, name] of cases) {
      const result = eligibility(rider(override), TARGET);
      assert.equal(result.eligible, false, `${name} should refuse`);
      assert.equal(result.filter, number, `${name} should be filter ${number}`);
      assert.equal(result.reason, name);
    }
  });

  test("the filter numbers are one to fourteen with no gaps", () => {
    assert.deepEqual(
      FILTERS.map((filter) => filter.number),
      Array.from({ length: 14 }, (_, index) => index + 1),
    );
  });

  test("an edge-of-zone rider is useful, and a rider one metre past the tolerance is not", () => {
    assert.equal(eligibility(rider({ zoneId: "zone-2", distanceToZoneEdgeM: 1_500 }), TARGET).eligible, true);
    assert.equal(eligibility(rider({ zoneId: "zone-2", distanceToZoneEdgeM: 1_501 }), TARGET).eligible, false);
  });

  test("the cash cap counts the order, not just what is already in hand", () => {
    // The order is ৳550 and the default cap is ৳3 500: ৳2 900 in hand fits, ৳3 000 does not.
    assert.equal(eligibility(rider({ cashInHandPaisa: 290_000 }), TARGET).eligible, true);
    assert.equal(eligibility(rider({ cashInHandPaisa: 300_000 }), TARGET).eligible, false);
  });
});

describe("the waves of 11 §7.2", () => {
  const candidates = [
    { riderId: "B", acceptanceProbability: 0.72 },
    { riderId: "A", acceptanceProbability: 0.54 },
    { riderId: "D", acceptanceProbability: 0.61 },
    { riderId: "C", acceptanceProbability: 0.44 },
    { riderId: "E", acceptanceProbability: 0.31 },
  ];

  test("the first wave is the three the document picks, and its p_none is the document's", () => {
    const waves = planWaves(candidates);
    assert.deepEqual([...(waves[0]?.riderIds ?? [])].sort(), ["A", "B", "D"]);
    assert.ok(Math.abs((waves[0]?.pNone ?? 0) - 0.0502) < 0.0005, `p_none was ${waves[0]?.pNone}`);
    assert.equal(waves[0]?.ttlS, 25);
    assert.equal(waves[0]?.startsAtS, 0);
  });

  test("the second wave holds the remaining two riders", () => {
    const waves = planWaves(candidates);
    assert.deepEqual([...(waves[1]?.riderIds ?? [])].sort(), ["C", "E"]);
    assert.equal(waves[1]?.startsAtS, 25);
  });

  test("no rider is asked twice across the waves", () => {
    const asked = planWaves(candidates).flatMap((wave) => wave.riderIds);
    assert.equal(new Set(asked).size, asked.length);
    assert.equal(asked.length, candidates.length);
  });

  test("a wave never exceeds eight phones, and never restarts after the fifth", () => {
    const many = Array.from({ length: 30 }, (_, index) => ({ riderId: `r${index}`, acceptanceProbability: 0.05 }));
    const waves = planWaves(many);
    assert.ok(waves.length <= 5);
    for (const wave of waves) assert.ok(wave.riderIds.length <= 8);
  });

  test("an empty candidate list produces no waves at all", () => {
    assert.deepEqual(planWaves([]), []);
  });
});

describe("claiming an offer", () => {
  const state = { orderId: "o1", currentWave: ["A", "B"], claimedBy: null, expiredAtMs: 1_000 };

  test("the first claim wins", () => {
    assert.deepEqual(decideClaim(state, "A", 500), { ok: true, riderId: "A" });
  });

  test("the second claimant is told it was taken, and by whom", () => {
    const taken = { ...state, claimedBy: "A" };
    assert.deepEqual(decideClaim(taken, "B", 500), { ok: false, code: "OFFER_CLAIMED", claimedBy: "A" });
  });

  test("a rider outside the wave, and an expired offer, are different refusals", () => {
    assert.deepEqual(decideClaim(state, "C", 500), { ok: false, code: "OFFER_NOT_YOURS", claimedBy: null });
    assert.deepEqual(decideClaim(state, "A", 1_000), { ok: false, code: "OFFER_EXPIRED", claimedBy: null });
  });

  test("a wave's expiry follows its own TTL", () => {
    assert.equal(waveExpiryMs(1_000, 1), 26_000);
    assert.equal(waveExpiryMs(1_000, 3), 23_000);
    assert.throws(() => waveExpiryMs(1_000, 9), /there is no wave 9/);
  });

  test("the fallback ladder starts at T+112 s", () => {
    assert.equal(FALLBACK_AT_S, 112);
    assert.equal(fallbackDue(0, 111_999), false);
    assert.equal(fallbackDue(0, 112_000), true);
  });
});

describe("the effects of a transition", () => {
  const effects = { writeStateEvent: true, notifyCustomer: true, notifyVendor: true, notifyRider: false, publishSse: true, settlesMoney: false } as const;

  test("the actor is never notified of their own tap", () => {
    const plan = planEffects({ orderId: "o1", to: "PLACED", actor: "CUSTOMER", event: "order.placed", effects, nowMs: 0 });
    assert.deepEqual(
      plan.notifications.map((notification) => notification.audience),
      ["VENDOR"],
      "the customer placed it, and no rider exists yet",
    );
    assert.equal(plan.notifications[0]?.messageKey, "order.placed");
  });

  test("a placement starts the vendor's two-minute clock", () => {
    const plan = planEffects({ orderId: "o1", to: "PLACED", actor: "CUSTOMER", event: "order.placed", effects, nowMs: 1_000 });
    assert.deepEqual(plan.timers, [{ name: "VENDOR_RESPONSE", firesAtMs: 121_000, onFire: "AUTO_CANCELLED" }]);
  });

  test("delivery starts settlement, and settlement opens the dispute window", () => {
    const delivered = planEffects({ orderId: "o1", to: "DELIVERED", actor: "RIDER", event: "order.delivered", effects, nowMs: 0 });
    assert.deepEqual(delivered.timers, [{ name: "SETTLE", firesAtMs: 900_000, onFire: "SETTLED" }]);
    assert.deepEqual(
      delivered.notifications.map((notification) => notification.audience),
      ["CUSTOMER", "VENDOR"],
    );

    const settled = planEffects({ orderId: "o1", to: "SETTLED", actor: "SYSTEM", event: "order.settled", effects, nowMs: 0 });
    assert.deepEqual(settled.timers, [{ name: "DISPUTE_WINDOW", firesAtMs: 86_400_000, onFire: "DISPUTED" }]);
  });

  test("every transition publishes on the order's own topic and is audited", () => {
    const plan = planEffects({ orderId: "o1", to: "ACCEPTED", actor: "VENDOR", event: "order.accepted", effects, nowMs: 0 });
    assert.deepEqual(plan.sseTopics, ["order:o1"]);
    assert.equal(plan.sseEvent, "order.accepted");
    assert.equal(plan.audit, true);
  });
});
