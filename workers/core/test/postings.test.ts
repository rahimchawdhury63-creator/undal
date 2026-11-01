/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { assertClosed, sumPaisa } from "../src/domain/ledger/closure.ts";
import {
  adjustment,
  bundleCredit,
  cashSettled,
  cashWriteOff,
  deliveredBreakdown,
  invoiceAccrual,
  loyalty,
  orderCancelled,
  orderDelivered,
  orderDeliveredPickup,
  promoPlatform,
  promoVendor,
  refundCredit,
  riderBonusPlatform,
  riderPayout,
  riderPenalty,
  rounding,
  tip,
  vendorPayout,
  weatherSubsidy,
} from "../src/domain/money/postings/index.ts";

/**
 * The posting sets, against the worked example in `24 §2`.
 *
 * Vector 01 is the one case in the corpus with a printed answer for every line, so it is
 * asserted line by line rather than only for closure: a set that closes with the wrong
 * distribution is worse than one that fails, because the failure is silent and the money is
 * still wrong.
 */

const VENDOR = "0193f2a1-7c3e-7890-abcd-ef0123456789";
const RIDER = "0193f2a1-7c3e-7890-abcd-ef01234567bb";
const ORDER = "0193f2a1-7c3e-7890-abcd-ef01234567cc";
const CUSTOMER = "0193f2a1-7c3e-7890-abcd-ef01234567dd";

describe("vector 01 — the canonical order posting", () => {
  const money = deliveredBreakdown({ orderId: ORDER, vendorId: VENDOR, riderId: RIDER, subtotalPaisa: 45_000, rideCorePaisa: 6_520 });

  test("derives the figures the document prints", () => {
    assert.equal(money.platformDeliveryMarginPaisa, 522);
    assert.equal(money.deliveryFeePaisa, 7_042);
    assert.equal(money.commissionPaisa, 6_750);
    assert.equal(money.riderBonusPaisa, 1_350);
    assert.equal(money.taxableBasePaisa, 7_272);
    assert.equal(money.taxPaisa, 364);
    assert.equal(money.rawTotalPaisa, 52_406);
    assert.equal(money.cashCollectedPaisa, 52_400);
    assert.equal(money.roundingDeltaPaisa, -6);
  });

  test("posts the seven lines the document prints, and closes", () => {
    const set = orderDelivered({ orderId: ORDER, vendorId: VENDOR, riderId: RIDER, subtotalPaisa: 45_000, rideCorePaisa: 6_520 });
    const byCode = new Map(set.postings.map((posting) => [posting.account.code, posting.amountPaisa]));
    assert.equal(byCode.get(`RIDER_CASH:${RIDER}`), 52_400);
    assert.equal(byCode.get(`VENDOR:${VENDOR}`), -36_900);
    assert.equal(byCode.get(`RIDER:${RIDER}`), -7_870);
    assert.equal(byCode.get("PLATFORM:REVENUE_COMMISSION"), -6_750);
    assert.equal(byCode.get("PLATFORM:REVENUE_DELIVERY_MARGIN"), -522);
    assert.equal(byCode.get("PLATFORM:TAX_PAYABLE"), -364);
    assert.equal(byCode.get("PLATFORM:EXPENSE_ROUNDING"), 6);
    assert.equal(set.postings.length, 7);
    assert.equal(sumPaisa(set.postings), 0);
  });

  test("the rider bonus is vendor-funded: no platform expense line appears", () => {
    const set = orderDelivered({ orderId: ORDER, vendorId: VENDOR, riderId: RIDER, subtotalPaisa: 45_000, rideCorePaisa: 6_520 });
    assert.ok(!set.postings.some((posting) => posting.account.code === "PLATFORM:EXPENSE_RIDER_BONUS"));
  });

  test("the taxable base is fee revenue and nothing else", () => {
    // A tip and a small-order fee change the total, but not the base the tax is levied on.
    const tipped = deliveredBreakdown({
      orderId: ORDER,
      vendorId: VENDOR,
      riderId: RIDER,
      subtotalPaisa: 45_000,
      rideCorePaisa: 6_520,
      tipPaisa: 5_000,
      smallOrderFeePaisa: 2_500,
      smallOrderRiderSharePaisa: 500,
      smallOrderVendorSharePaisa: 500,
    });
    assert.equal(tipped.taxableBasePaisa, 6_750 + 522 + 1_500, "the fee minus the rider's and the vendor's shares");
    assert.equal(tipped.taxPaisa, 439, "438.6 paisa rounds up, exactly as 10 §12.1 prints it");
  });

  test("a tip rides through untouched, and the set still closes", () => {
    const set = orderDelivered({
      orderId: ORDER,
      vendorId: VENDOR,
      riderId: RIDER,
      subtotalPaisa: 45_000,
      rideCorePaisa: 6_520,
      tipPaisa: 5_000,
    });
    // One cash line, because the tip is already inside the collected total; the rider's
    // payable grows by the tip, and the platform keeps none of it.
    const cashLines = set.postings.filter((posting) => posting.account.code === `RIDER_CASH:${RIDER}`);
    assert.equal(cashLines.length, 1);
    const riderLine = set.postings.find((posting) => posting.account.code === `RIDER:${RIDER}`);
    assert.equal(riderLine?.amountPaisa, -(6_520 + 1_350 + 5_000));
    assert.equal(sumPaisa(set.postings), 0);
    assertClosed("ORDER_DELIVERED", set.postings);
  });
});

describe("every posting set closes", () => {
  const sets = {
    delivered: orderDelivered({ orderId: ORDER, vendorId: VENDOR, riderId: RIDER, subtotalPaisa: 45_000, rideCorePaisa: 6_520 }),
    pickup: orderDeliveredPickup({ orderId: ORDER, vendorId: VENDOR, subtotalPaisa: 30_000, smallOrderFeePaisa: 2_500 }),
    cancelled: orderCancelled({ orderId: ORDER, vendorId: VENDOR, customerId: CUSTOMER, preparedCostPaisa: 12_000, refundedToCustomerPaisa: 20_000 }),
    refund: refundCredit({ orderId: ORDER, customerId: CUSTOMER, amountPaisa: 9_000 }),
    tip: tip({ orderId: ORDER, riderId: RIDER, amountPaisa: 2_000 }),
    promoPlatform: promoPlatform({ orderId: ORDER, amountPaisa: 3_000 }),
    promoVendor: promoVendor({ orderId: ORDER, vendorId: VENDOR, amountPaisa: 3_000 }),
    weather: weatherSubsidy({ orderId: ORDER, riderId: RIDER, amountPaisa: 1_500 }),
    rounding: rounding({ orderId: ORDER, deltaPaisa: -42 }),
    bundle: bundleCredit({ orderId: ORDER, amountPaisa: 4_000 }),
    bonus: riderBonusPlatform({ orderId: ORDER, riderId: RIDER, subtotalPaisa: 45_000 }),
    penalty: riderPenalty({ riderId: RIDER, amountPaisa: 5_000, reason: "late start, third time" }),
    loyaltyIssue: loyalty({ customerId: CUSTOMER, amountPaisa: 1_200, direction: "ISSUE" }),
    loyaltyRedeem: loyalty({ customerId: CUSTOMER, amountPaisa: 1_200, direction: "REDEEM" }),
    invoice: invoiceAccrual({ vendorId: VENDOR, amountPaisa: 120_000, invoiceId: ORDER }),
    adjustment: adjustment({
      debitCode: "PLATFORM:EXPENSE_COMPENSATION",
      creditTarget: { kind: "VENDOR", id: VENDOR },
      amountPaisa: 7_500,
      reason: "cold food complaint upheld",
    }),
    riderPaid: riderPayout({ riderId: RIDER, amountPaisa: 8_370 }),
    vendorPaid: vendorPayout({ vendorId: VENDOR, amountPaisa: 37_400 }),
    cashSettled: cashSettled({ riderId: RIDER, amountPaisa: 52_400 }),
    cashWriteOff: cashWriteOff({ riderId: RIDER, amountPaisa: 2_000, reason: "customer short-paid and left" }),
  };

  test("twenty sets, twenty zeros, no zero-amount lines", () => {
    for (const [name, set] of Object.entries(sets)) {
      assert.equal(sumPaisa(set.postings), 0, name);
      assert.ok(set.postings.length >= 2, name);
      for (const posting of set.postings) {
        assert.notEqual(posting.amountPaisa, 0, `${name} ${posting.account.code}`);
        assert.ok(Number.isSafeInteger(posting.amountPaisa), name);
      }
      assertClosed(set.entryType, set.postings);
    }
  });

  test("money moves in the direction the account demands", () => {
    assert.equal(sets.riderPaid.postings[0]?.amountPaisa, 8_370, "a payout debits the liability");
    assert.equal(sets.riderPaid.postings[1]?.amountPaisa, -8_370, "and credits the bank");
    assert.equal(sets.cashSettled.postings[0]?.amountPaisa, -52_400, "settling reduces the rider's float");
    assert.equal(sets.tip.postings[0]?.amountPaisa, 2_000, "a tip reaches the rider in full");
  });
});
