/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { PointE7 } from "@undal/contracts";

import type { TransitionContext } from "../src/domain/order/guards.ts";
import { cancellationFeeApplies } from "../src/domain/order/guards.ts";
import { applyTransition, replay, requiredGuards } from "../src/domain/order/lifecycle.ts";
import { renderPickupPayload, sixDigitFallback, verifyFallback, verifyPickupCode, windowIndex } from "../src/domain/order/qr.ts";
import {
  assertTransition,
  canTransition,
  legalTargets,
  TRANSITIONS,
  TransitionRefused,
  transitionsFrom,
} from "../src/domain/order/state-machine.ts";
import { isOrderState, isTerminal, ORDER_STATES } from "../src/domain/order/states.ts";

/**
 * The transition table, exhaustively — every edge, every actor, every guard.
 *
 * The gate in `35 §3` is 100% transition coverage *including illegal edges*, so the test is
 * written as a sweep of the table rather than as a handful of journeys: a journey tests the paths
 * somebody remembered, and the bugs live on the edges that only the table knows about.
 */

const CONTEXT: TransitionContext = {
  cartItemCount: 2,
  vendorApproved: true,
  vendorOpenState: "OPEN",
  unavailableItemCount: 0,
  addressZoneActive: true,
  customerBanned: false,
  fareQuotePresent: true,
  vendorOwnsOrder: true,
  prepTimeSeconds: 900,
  reasonCode: "OUT_OF_STOCK",
  fulfilment: "DELIVERY",
  elapsedSeconds: 130,
  vendorUnreachable: true,
  dispatchOpened: true,
  riderClaimedOffer: true,
  pickupCodeMatches: true,
  riderDistanceToVendorM: 20,
  riderDistanceToCustomerM: 30,
  cashCollectedPaisa: 54_900,
  totalPaisa: 54_900,
  varianceReason: null,
  minutesSinceDelivered: 20,
  disputeOpen: false,
  adminDecided: true,
};

/** A context that satisfies every guard, adjusted for the edge under test. */
function contextFor(from: string, to: string, actor: string): TransitionContext {
  const ctx: TransitionContext = { ...CONTEXT };
  if (to === "PICKED_UP" && actor === "CUSTOMER") return { ...ctx, fulfilment: "PICKUP" };
  if (from === "PICKED_UP" && to === "DELIVERED") return { ...ctx, fulfilment: "PICKUP" };
  return ctx;
}

describe("the table", () => {
  test("every state is a real state and every edge names real states", () => {
    for (const row of TRANSITIONS) {
      assert.ok(isOrderState(row.from), row.from);
      assert.ok(isOrderState(row.to), row.to);
      assert.ok(row.actors.length > 0, `${row.from}→${row.to} has no actor`);
      assert.notEqual(row.from, row.to, "an edge to itself is not a transition");
    }
  });

  test("every explicit row is reproduced once, plus the admin wildcard", () => {
    assert.equal(TRANSITIONS.filter((row) => row.to === "CANCELLED_BY_ADMIN").length,
      ORDER_STATES.filter((state) => !isTerminal(state)).length, "an admin can cancel anything still in flight, exactly once");
    const keys = new Set(TRANSITIONS.map((row) => `${row.from}|${row.to}|${row.actors.join(",")}`));
    assert.equal(keys.size, TRANSITIONS.length, "a duplicate edge would hide a missing one");
  });

  test("terminal states lead nowhere", () => {
    for (const state of ORDER_STATES) {
      if (!isTerminal(state)) continue;
      assert.deepEqual(legalTargets(state), [], `${state} is terminal but has exits`);
    }
  });

  test("every non-terminal state has at least one exit", () => {
    for (const state of ORDER_STATES) {
      if (isTerminal(state)) continue;
      assert.ok(legalTargets(state).length > 0, `${state} is a trap`);
    }
  });

  test("every edge is reachable from DRAFT", () => {
    const seen = new Set<string>(["DRAFT"]);
    const queue: string[] = ["DRAFT"];
    while (queue.length > 0) {
      const state = queue.shift();
      if (state === undefined) break;
      for (const target of legalTargets(state as never)) {
        if (!seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }
    assert.equal(seen.size, ORDER_STATES.length, `unreachable: ${ORDER_STATES.filter((s) => !seen.has(s)).join(", ")}`);
    for (const row of TRANSITIONS) assert.ok(seen.has(row.to), `${row.to} is a dead end`);
  });
});

describe("100% transition coverage", () => {
  for (const row of TRANSITIONS) {
    for (const actor of row.actors) {
      test(`${row.from} → ${row.to} as ${actor}`, () => {
        const verdict = canTransition(row.from, row.to, actor, contextFor(row.from, row.to, actor));
        assert.equal(verdict.allowed, true, `${row.from}→${row.to} refused: ${verdict.guard}`);
        const outcome = applyTransition({
          orderId: "0193f2a1-7c3e-7890-abcd-ef01234567cc",
          from: row.from,
          to: row.to,
          actor,
          context: contextFor(row.from, row.to, actor),
          nextSeq: 7,
          nowMs: 1_700_000_000_000,
        });
        assert.equal(outcome.state, row.to);
        assert.equal(outcome.event.seq, 7);
        assert.equal(outcome.effects.writeStateEvent, true);
        assert.equal(outcome.event.event, row.event);
        assert.equal(requiredGuards(row.from, row.to).length, row.guards.length);
      });
    }
  }
});

describe("illegal edges are refused, every one of them", () => {
  test("every pair outside the table is refused", () => {
    let refused = 0;
    for (const from of ORDER_STATES) {
      for (const to of ORDER_STATES) {
        if (from === to) continue;
        const legal = transitionsFrom(from).some((row) => row.to === to);
        const verdict = canTransition(from, to, "ADMIN", CONTEXT);
        if (legal && (findActor(from, to) as string[]).includes("ADMIN")) continue;
        if (!legal) {
          assert.equal(verdict.allowed, false, `${from}→${to} should not exist`);
          assert.equal(verdict.refusal, "ILLEGAL_EDGE");
          refused += 1;
        }
      }
    }
    assert.ok(refused > 200, `only ${refused} illegal pairs found — the sweep is wrong`);
  });

  test("an actor outside the edge is refused, with the actor named", () => {
    const verdict = canTransition("PLACED", "ACCEPTED", "CUSTOMER", CONTEXT);
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.refusal, "ACTOR_NOT_PERMITTED");
    assert.throws(() => assertTransition("PLACED", "ACCEPTED", "CUSTOMER", CONTEXT), TransitionRefused);
  });

  test("a failed guard names itself and the code the app renders", () => {
    const verdict = canTransition("ARRIVED", "DELIVERED", "RIDER", { ...CONTEXT, cashCollectedPaisa: 50_000, varianceReason: null });
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.guard, "cashReconciles");
    try {
      assertTransition("ARRIVED", "DELIVERED", "RIDER", { ...CONTEXT, cashCollectedPaisa: 50_000 });
      assert.fail("expected a refusal");
    } catch (error) {
      assert.ok(error instanceof TransitionRefused);
      assert.equal(error.code, "ORDER_TOTAL_CHANGED");
      assert.equal(error.kind, "GUARD_FAILED");
    }
  });

  test("a cash shortfall with a variance reason is accepted", () => {
    const verdict = canTransition("ARRIVED", "DELIVERED", "RIDER", {
      ...CONTEXT,
      cashCollectedPaisa: 50_000,
      varianceReason: "customer short-paid, refused change",
    });
    assert.equal(verdict.allowed, true);
  });

  test("a placement without a quote, a cart or an approved vendor is refused", () => {
    for (const [field, value] of [["fareQuotePresent", false], ["cartItemCount", 0], ["vendorApproved", false], ["customerBanned", true], ["addressZoneActive", false]] as const) {
      const verdict = canTransition("DRAFT", "PLACED", "CUSTOMER", { ...CONTEXT, [field]: value });
      assert.equal(verdict.allowed, false, `guard did not fire for ${field}`);
    }
  });

  test("a delivery cannot be completed as a pickup, and vice versa", () => {
    assert.equal(canTransition("ACCEPTED", "PICKED_UP", "CUSTOMER", { ...CONTEXT, fulfilment: "DELIVERY" }).allowed, false);
    assert.equal(canTransition("ACCEPTED", "RIDER_SEARCH", "SYSTEM", { ...CONTEXT, fulfilment: "PICKUP" }).allowed, false);
  });
});

describe("the lifecycle", () => {
  test("the effects are the ones the document promises", () => {
    const placed = applyTransition({ orderId: "o", from: "DRAFT", to: "PLACED", actor: "CUSTOMER", context: CONTEXT, nextSeq: 1, nowMs: 0 });
    assert.equal(placed.effects.notifyVendor, true, "a vendor must hear about a new order");
    assert.equal(placed.effects.notifyCustomer, false);

    const delivered = applyTransition({ orderId: "o", from: "ARRIVED", to: "DELIVERED", actor: "RIDER", context: CONTEXT, nextSeq: 2, nowMs: 0 });
    assert.equal(delivered.effects.settlesMoney, true);
    assert.equal(delivered.effects.notifyCustomer, true);
  });

  test("a replay proves the materialised state, and refuses a divergent log", () => {
    const events = [
      { fromState: "DRAFT", toState: "PLACED" },
      { fromState: "PLACED", toState: "ACCEPTED" },
      { fromState: "ACCEPTED", toState: "RIDER_SEARCH" },
    ] as const;
    assert.equal(replay(events, "DRAFT"), "RIDER_SEARCH");
    assert.throws(() => replay([{ fromState: "DRAFT", toState: "PLACED" }, { fromState: "ARRIVED", toState: "DELIVERED" }], "DRAFT"), /diverges/);
  });

  test("the free-cancellation window is one rule, not two", () => {
    assert.equal(cancellationFeeApplies({ elapsedSeconds: 59 }), false);
    assert.equal(cancellationFeeApplies({ elapsedSeconds: 61 }), true);
  });
});

const VENDOR: PointE7 = { latE7: 248_944_000, lonE7: 917_699_000 };
const NEAR: PointE7 = { latE7: 248_944_500, lonE7: 917_699_500 };
const FAR: PointE7 = { latE7: 248_984_000, lonE7: 917_739_000 };
const SECRET = "pickup-secret-for-tests-0123456789";
const CODE = "UNDAL-7F3K";
const NOW = 1_700_000_000_000;

describe("the pickup proof", () => {
  test("a fresh code from a rider at the counter is accepted", async () => {
    const presented = await renderPickupPayload(SECRET, CODE, NOW);
    const result = await verifyPickupCode({ presented, secret: SECRET, orderCode: CODE, riderPoint: NEAR, vendorPoint: VENDOR, nowMs: NOW, alreadyScanned: false });
    assert.equal(result.ok, true);
    assert.equal(windowIndex(NOW), (result as { window: number }).window);
  });

  test("the code rotates, and the old one stays valid inside four hours", async () => {
    const earlier = await renderPickupPayload(SECRET, CODE, NOW - 10 * 60_000);
    const fresh = await renderPickupPayload(SECRET, CODE, NOW);
    assert.notEqual(earlier, fresh);
    const old = await verifyPickupCode({ presented: earlier, secret: SECRET, orderCode: CODE, riderPoint: NEAR, vendorPoint: VENDOR, nowMs: NOW, alreadyScanned: false });
    assert.equal(old.ok, true, "ten minutes old is a rider in traffic, not an attack");
  });

  test("a five-hour-old code is expired", async () => {
    const stale = await renderPickupPayload(SECRET, CODE, NOW - 5 * 60 * 60 * 1000);
    const result = await verifyPickupCode({ presented: stale, secret: SECRET, orderCode: CODE, riderPoint: NEAR, vendorPoint: VENDOR, nowMs: NOW, alreadyScanned: false });
    assert.deepEqual(result, { ok: false, code: "QR_EXPIRED" });
  });

  test("a code for another order, a forged signature and a distant rider are all refused", async () => {
    const presented = await renderPickupPayload(SECRET, CODE, NOW);
    assert.deepEqual(await verifyPickupCode({ presented, secret: SECRET, orderCode: "OTHER", riderPoint: NEAR, vendorPoint: VENDOR, nowMs: NOW, alreadyScanned: false }), { ok: false, code: "QR_WRONG_ORDER" });
    const forged = presented.split("|");
    forged[2] = "0".repeat(64);
    assert.deepEqual(await verifyPickupCode({ presented: forged.join("|"), secret: SECRET, orderCode: CODE, riderPoint: NEAR, vendorPoint: VENDOR, nowMs: NOW, alreadyScanned: false }), { ok: false, code: "QR_INVALID" });
    assert.deepEqual(await verifyPickupCode({ presented, secret: SECRET, orderCode: CODE, riderPoint: FAR, vendorPoint: VENDOR, nowMs: NOW, alreadyScanned: false }), { ok: false, code: "QR_TOO_FAR" });
    assert.deepEqual(await verifyPickupCode({ presented, secret: SECRET, orderCode: CODE, riderPoint: NEAR, vendorPoint: VENDOR, nowMs: NOW, alreadyScanned: true }), { ok: false, code: "QR_ALREADY_SCANNED" });
  });

  test("the six-digit fallback works one window late and not two", async () => {
    const digits = await sixDigitFallback(SECRET, CODE, windowIndex(NOW));
    const accepted = await verifyFallback({ digits, secret: SECRET, orderCode: CODE, riderPoint: NEAR, vendorPoint: VENDOR, nowMs: NOW, alreadyScanned: false });
    assert.equal(accepted.ok, true);

    const late = await sixDigitFallback(SECRET, CODE, windowIndex(NOW) - 1);
    assert.equal((await verifyFallback({ digits: late, secret: SECRET, orderCode: CODE, riderPoint: NEAR, vendorPoint: VENDOR, nowMs: NOW, alreadyScanned: false })).ok, true);

    const stale = await sixDigitFallback(SECRET, CODE, windowIndex(NOW) - 5);
    assert.deepEqual(await verifyFallback({ digits: stale, secret: SECRET, orderCode: CODE, riderPoint: NEAR, vendorPoint: VENDOR, nowMs: NOW, alreadyScanned: false }), { ok: false, code: "QR_INVALID" });
    assert.deepEqual(await verifyFallback({ digits: "12345", secret: SECRET, orderCode: CODE, riderPoint: NEAR, vendorPoint: VENDOR, nowMs: NOW, alreadyScanned: false }), { ok: false, code: "QR_INVALID" });
  });
});

/** The actors a legal edge allows, for the sweep above. */
function findActor(from: string, to: string): readonly string[] {
  return transitionsFrom(from as never).find((row) => row.to === to)?.actors ?? [];
}
