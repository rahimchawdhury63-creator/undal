/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { orderCode, PlacementRefused, planPlacement, type CurrentPrice, type PlacementContext, type PlacementRequest } from "../src/domain/order/placement.ts";
import { diffQuote, encodeQuote, issueQuote, QUOTE_TTL_MS, sameItems, verifyQuoteToken, type QuoteSnapshot, type QuoteTotals } from "../src/domain/order/quote.ts";

/**
 * The five-minute promise: the customer is charged what they were shown, or told what moved.
 *
 * The tests are written from the customer's side — a token that is ours, one that is not, one that
 * is six minutes old, a cart whose item vanished — because every one of these is a support call
 * that has actually happened to somebody running a delivery platform.
 */

const SECRET = "quote-signing-secret-for-tests-0123456789";
const NOW = 1_700_000_000_000;

const ITEMS = [
  { menuItemId: "0193f2a1-7c3e-7890-abcd-ef0123450011", quantity: 2, unitPricePaisa: 22_500, modifiersPaisa: 0 },
];

const TOTALS: QuoteTotals = {
  subtotalPaisa: 45_000,
  discountPaisa: 0,
  deliveryFeePaisa: 7_042,
  smallOrderFeePaisa: 2_500,
  taxPaisa: 439,
  tipPaisa: 0,
  roundingPaisa: -81,
  totalPaisa: 54_900,
};

const BASE: Omit<QuoteSnapshot, "issuedAtMs" | "expiresAtMs"> = {
  quoteId: "0193f2a1-7c3e-7890-abcd-ef01234567aa",
  customerId: "0193f2a1-7c3e-7890-abcd-ef01234567dd",
  vendorId: "0193f2a1-7c3e-7890-abcd-ef0123456789",
  zoneId: "0193f2a1-7c3e-7890-abcd-ef01234567ff",
  fulfilment: "DELIVERY",
  items: ITEMS,
  totals: TOTALS,
  surgeBps: 10_000,
  weatherCondition: "CLEAR",
  routeDistanceM: 3_800,
  routeDurationS: 780,
  trafficDelayS: 0,
  fareSource: "BRAIN",
};

const CONTEXT: PlacementContext = {
  vendorApproved: true,
  vendorOpenState: "OPEN",
  unavailableItemCount: 0,
  addressZoneActive: true,
  customerBanned: false,
};

const REQUEST: PlacementRequest = {
  quoteToken: "",
  customerId: BASE.customerId,
  vendorId: BASE.vendorId,
  zoneId: BASE.zoneId,
  fulfilment: "DELIVERY",
  customerNote: "extra napkins",
  pickupPointE7: { latE7: 248_944_000, lonE7: 917_699_000 },
  deliveryPointE7: { latE7: 248_951_000, lonE7: 917_705_000 },
};

const PRICE: CurrentPrice = { totals: TOTALS, items: ITEMS, surgeBps: 10_000, fareSource: "BRAIN" };

describe("issuing and verifying a quote", () => {
  test("a fresh token verifies and carries the price it was signed with", async () => {
    const signed = await issueQuote(BASE, SECRET, NOW);
    assert.equal(signed.snapshot.expiresAtMs, NOW + QUOTE_TTL_MS);
    const verdict = await verifyQuoteToken(encodeQuote(signed), SECRET, NOW + 1_000);
    assert.equal(verdict.ok, true);
    assert.deepEqual(verdict.ok ? verdict.snapshot.totals : null, TOTALS);
  });

  test("the token is not the snapshot: the customer cannot read a price and change it", async () => {
    const signed = await issueQuote(BASE, SECRET, NOW);
    const token = encodeQuote(signed);
    const tampered = token.replace('"totalPaisa":54900', '"totalPaisa":44900');
    assert.notEqual(tampered, token);
    assert.deepEqual(await verifyQuoteToken(tampered, SECRET, NOW), { ok: false, code: "QUOTE_MISMATCH" });
  });

  test("a token signed with another secret is refused", async () => {
    const signed = await issueQuote(BASE, SECRET, NOW);
    const verdict = await verifyQuoteToken(encodeQuote(signed), "a-different-secret", NOW);
    assert.deepEqual(verdict, { ok: false, code: "QUOTE_MISMATCH" });
  });

  test("six minutes is expired, five is not", async () => {
    const signed = await issueQuote(BASE, SECRET, NOW);
    const token = encodeQuote(signed);
    assert.equal((await verifyQuoteToken(token, SECRET, NOW + QUOTE_TTL_MS)).ok, true);
    assert.deepEqual(await verifyQuoteToken(token, SECRET, NOW + QUOTE_TTL_MS + 1), { ok: false, code: "QUOTE_EXPIRED" });
  });

  test("a quote refuses negative money at issue", async () => {
    await assert.rejects(() => issueQuote({ ...BASE, totals: { ...TOTALS, deliveryFeePaisa: -1 } }, SECRET, NOW), /non-negative/u);
  });
});

describe("re-pricing", () => {
  test("an unchanged price produces no diff", () => {
    assert.deepEqual(diffQuote(TOTALS, { ...TOTALS }), []);
  });

  test("a risen delivery fee produces one line with the delta", () => {
    const diffs = diffQuote(TOTALS, { ...TOTALS, deliveryFeePaisa: 8_500, totalPaisa: 56_400 });
    assert.equal(diffs.length, 2);
    assert.deepEqual(diffs[0], { field: "deliveryFeePaisa", quotedPaisa: 7_042, nowPaisa: 8_500, deltaPaisa: 1_458 });
    assert.equal(diffs[1]?.deltaPaisa, 1_500);
  });

  test("every moved line is reported, not just the first", () => {
    const diffs = diffQuote(TOTALS, { ...TOTALS, smallOrderFeePaisa: 0, taxPaisa: 415, totalPaisa: 52_300 });
    assert.deepEqual(diffs.map((diff) => diff.field).sort(), ["smallOrderFeePaisa", "taxPaisa", "totalPaisa"]);
  });

  test("a cart comparison notices a quantity, a price and a removed line", () => {
    assert.equal(sameItems(ITEMS, ITEMS), true);
    assert.equal(sameItems(ITEMS, [{ ...ITEMS[0]!, quantity: 1 }]), false);
    assert.equal(sameItems(ITEMS, [{ ...ITEMS[0]!, unitPricePaisa: 23_000 }]), false);
    assert.equal(sameItems(ITEMS, []), false);
  });
});

describe("placement", () => {
  const place = async (token: string, price: CurrentPrice = PRICE, nowMs = NOW + 1_000) =>
    planPlacement({ request: { ...REQUEST, quoteToken: token }, price, context: CONTEXT, secret: SECRET, nowMs, nextSeq: 1 });

  test("a matching quote places the order with the quoted money", async () => {
    const signed = await issueQuote(BASE, SECRET, NOW);
    const plan = await place(encodeQuote(signed));
    assert.equal(plan.order.state, "PLACED");
    assert.equal(plan.order.totals.totalPaisa, 54_900);
    assert.equal(plan.cashDuePaisa, 54_900, "COD: the rider collects exactly what was quoted");
    assert.equal(plan.order.paymentMethod, "COD");
    assert.equal(plan.event.fromState, "DRAFT");
    assert.equal(plan.event.toState, "PLACED");
    assert.equal(plan.effects.notifyVendor, true);
    assert.match(plan.order.code, /^UND-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/u);
  });

  test("a price that moved is refused with the lines that moved", async () => {
    const signed = await issueQuote(BASE, SECRET, NOW);
    const price: CurrentPrice = { ...PRICE, totals: { ...TOTALS, deliveryFeePaisa: 8_500, totalPaisa: 56_400 } };
    await assert.rejects(
      () => place(encodeQuote(signed), price),
      (error: unknown) => {
        assert.ok(error instanceof PlacementRefused);
        assert.equal(error.code, "QUOTE_MISMATCH");
        assert.deepEqual(error.diffs.map((diff) => diff.field), ["deliveryFeePaisa", "totalPaisa"]);
        return true;
      },
    );
  });

  test("a cart whose item vanished is refused as an ingredient change, not a price change", async () => {
    const signed = await issueQuote(BASE, SECRET, NOW);
    await assert.rejects(
      () => place(encodeQuote(signed), { ...PRICE, items: [] }),
      (error: unknown) => error instanceof PlacementRefused && error.code === "QUOTE_INGREDIENTS_CHANGED",
    );
  });

  test("an expired quote is refused even when the price is identical", async () => {
    const signed = await issueQuote(BASE, SECRET, NOW);
    await assert.rejects(
      () => place(encodeQuote(signed), PRICE, NOW + QUOTE_TTL_MS + 1),
      (error: unknown) => error instanceof PlacementRefused && error.code === "QUOTE_EXPIRED",
    );
  });

  test("a quote for another vendor cannot be reused", async () => {
    const signed = await issueQuote(BASE, SECRET, NOW);
    await assert.rejects(
      () => planPlacement({ request: { ...REQUEST, quoteToken: encodeQuote(signed), vendorId: "someone-else" }, price: PRICE, context: CONTEXT, secret: SECRET, nowMs: NOW + 1_000, nextSeq: 1 }),
      (error: unknown) => error instanceof PlacementRefused && error.code === "QUOTE_MISMATCH",
    );
  });

  test("a banned customer or a closed vendor cannot place at all", async () => {
    const signed = await issueQuote(BASE, SECRET, NOW);
    for (const context of [{ ...CONTEXT, customerBanned: true }, { ...CONTEXT, vendorOpenState: "CLOSED" as const }, { ...CONTEXT, unavailableItemCount: 1 }]) {
      await assert.rejects(
        () => planPlacement({ request: { ...REQUEST, quoteToken: encodeQuote(signed) }, price: PRICE, context, secret: SECRET, nowMs: NOW + 1_000, nextSeq: 1 }),
        /order cannot move/u,
      );
    }
  });

  test("the order code is derived from the id, so two orders cannot collide", () => {
    const first = orderCode("0193f2a1-7c3e-7890-abcd-ef0123456789");
    const second = orderCode("0193f2a2-7c3e-7890-abcd-ef0123456789");
    assert.notEqual(first, second);
    assert.equal(first.length, 12);
  });
});
