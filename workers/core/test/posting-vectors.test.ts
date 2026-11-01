/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { sumPaisa } from "../src/domain/ledger/closure.ts";
import type { PostingSet } from "../src/domain/ledger/types.ts";
import {
  adjustment,
  bundleCredit,
  cashSettled,
  cashWriteOff,
  customerCredit,
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
 * The thirty-four golden posting sets, produced by a second implementation.
 *
 * `scripts/money/posting_sets.py` builds each set from the formulas in `24 §2.1` and the rows
 * in `§3` and refuses to write one that does not close; this test replays the same inputs
 * through the TypeScript builders and demands the same postings, to the paisa. Two
 * independent implementations agreeing on thirty-four sets is a check; one implementation
 * agreeing with a file it generated is not.
 */

interface GoldenPosting {
  readonly code: string;
  readonly amount_paisa: number;
}

interface GoldenBreakdown {
  readonly subtotal_paisa: number;
  readonly ride_core_paisa: number;
  readonly platform_delivery_margin_paisa: number;
  readonly delivery_fee_paisa: number;
  readonly commission_paisa: number;
  readonly rider_bonus_paisa: number;
  readonly taxable_base_paisa: number;
  readonly tax_paisa: number;
  readonly small_order_platform_paisa: number;
  readonly raw_total_paisa: number;
  readonly cash_collected_paisa: number;
  readonly rounding_delta_paisa: number;
}

interface GoldenCase {
  readonly id: string;
  readonly builder: string;
  readonly title: string;
  readonly inputs: Record<string, number | string>;
  readonly entry_type: string;
  readonly postings: readonly GoldenPosting[];
  readonly breakdown?: GoldenBreakdown;
}

const VENDOR = "0193f2a1-7c3e-7890-abcd-ef0123456789";
const RIDER = "0193f2a1-7c3e-7890-abcd-ef01234567bb";
const CUSTOMER = "0193f2a1-7c3e-7890-abcd-ef01234567dd";
const ORDER = "0193f2a1-7c3e-7890-abcd-ef01234567cc";
const INVOICE = "0193f2a1-7c3e-7890-abcd-ef01234567ee";

const file = JSON.parse(
  readFileSync(new URL("../src/domain/money/vectors/posting_sets.json", import.meta.url), "utf8"),
) as { cases: GoldenCase[] };

/** Read an input as an integer, refusing a missing one rather than defaulting to zero. */
function num(inputs: Record<string, number | string>, key: string): number {
  const value = inputs[key];
  if (typeof value !== "number") throw new Error(`golden case is missing numeric input ${key}`);
  return value;
}

/** Read an optional input. */
function optional(inputs: Record<string, number | string>, key: string): number | undefined {
  const value = inputs[key];
  return typeof value === "number" ? value : undefined;
}

/**
 * Build the set a golden case describes.
 *
 * The switch is exhaustive over the `builder` names the generator emits, and it throws on an
 * unknown one: a new builder without a vector shows up as a failing test, not as a case that
 * silently stopped being covered.
 */
function build(golden: GoldenCase): PostingSet {
  const input = golden.inputs;
  const amount = optional(input, "amount_paisa");

  switch (golden.builder) {
    case "delivered":
      return orderDelivered({
        orderId: ORDER,
        vendorId: VENDOR,
        riderId: RIDER,
        subtotalPaisa: num(input, "subtotal_paisa"),
        rideCorePaisa: num(input, "ride_core_paisa"),
        ...(optional(input, "tip_paisa") === undefined ? {} : { tipPaisa: num(input, "tip_paisa") }),
        ...(optional(input, "small_order_fee_paisa") === undefined
          ? {}
          : { smallOrderFeePaisa: num(input, "small_order_fee_paisa") }),
        ...(optional(input, "small_order_rider_share_paisa") === undefined
          ? {}
          : { smallOrderRiderSharePaisa: num(input, "small_order_rider_share_paisa") }),
      });
    case "pickup":
      return orderDeliveredPickup({
        orderId: ORDER,
        vendorId: VENDOR,
        subtotalPaisa: num(input, "subtotal_paisa"),
        ...(optional(input, "small_order_fee_paisa") === undefined
          ? {}
          : { smallOrderFeePaisa: num(input, "small_order_fee_paisa") }),
      });
    case "cancelled":
      return orderCancelled({
        orderId: ORDER,
        vendorId: VENDOR,
        customerId: CUSTOMER,
        preparedCostPaisa: num(input, "prepared_cost_paisa"),
        ...(optional(input, "refunded_to_customer_paisa") === undefined
          ? {}
          : { refundedToCustomerPaisa: num(input, "refunded_to_customer_paisa") }),
      });
    case "refund":
      return refundCredit({ orderId: ORDER, customerId: CUSTOMER, amountPaisa: amount ?? 0 });
    case "customer-credit":
      return customerCredit({ customerId: CUSTOMER, amountPaisa: amount ?? 0 });
    case "tip":
      return tip({ orderId: ORDER, riderId: RIDER, amountPaisa: amount ?? 0 });
    case "promo-platform":
      return promoPlatform({ orderId: ORDER, amountPaisa: amount ?? 0 });
    case "promo-vendor":
      return promoVendor({ orderId: ORDER, vendorId: VENDOR, amountPaisa: amount ?? 0 });
    case "bundle":
      return bundleCredit({ orderId: ORDER, amountPaisa: amount ?? 0 });
    case "weather":
      return weatherSubsidy({ orderId: ORDER, riderId: RIDER, amountPaisa: amount ?? 0 });
    case "rounding":
      return rounding({ orderId: ORDER, deltaPaisa: num(input, "delta_paisa") });
    case "bonus-platform":
      return riderBonusPlatform({ orderId: ORDER, riderId: RIDER, subtotalPaisa: num(input, "subtotal_paisa") });
    case "loyalty":
      return loyalty({
        customerId: CUSTOMER,
        amountPaisa: amount ?? 0,
        direction: input["direction"] === "REDEEM" ? "REDEEM" : "ISSUE",
      });
    case "invoice":
      return invoiceAccrual({ vendorId: VENDOR, amountPaisa: amount ?? 0, invoiceId: INVOICE });
    case "penalty":
      return riderPenalty({ riderId: RIDER, amountPaisa: amount ?? 0, reason: "vector case" });
    case "payout-rider":
      return riderPayout({ riderId: RIDER, amountPaisa: amount ?? 0 });
    case "payout-vendor":
      return vendorPayout({ vendorId: VENDOR, amountPaisa: amount ?? 0 });
    case "cash-settled":
      return cashSettled({ riderId: RIDER, amountPaisa: amount ?? 0 });
    case "cash-writeoff":
      return cashWriteOff({ riderId: RIDER, amountPaisa: amount ?? 0, reason: "vector case" });
    case "adjustment":
      return adjustment({
        debitCode: "PLATFORM:EXPENSE_COMPENSATION",
        creditTarget: { kind: "VENDOR", id: VENDOR },
        amountPaisa: amount ?? 0,
        reason: "vector case",
      });
    default:
      throw new Error(`golden case ${golden.id} names a builder this test does not know: ${golden.builder}`);
  }
}

/** Sum postings per account code, because one account may carry two lines. */
function fold(set: PostingSet): Map<string, number> {
  const folded = new Map<string, number>();
  for (const posting of set.postings) {
    folded.set(posting.account.code, (folded.get(posting.account.code) ?? 0) + posting.amountPaisa);
  }
  return folded;
}

describe("the thirty-four golden posting sets", () => {
  test("the file holds thirty-four cases and no duplicate ids", () => {
    assert.equal(file.cases.length, 34);
    assert.equal(new Set(file.cases.map((item) => item.id)).size, 34);
  });

  for (const golden of file.cases) {
    test(`${golden.id} — ${golden.title}`, () => {
      const set = build(golden);
      assert.equal(set.entryType, golden.entry_type);
      assert.equal(sumPaisa(set.postings), 0);

      const expected = new Map<string, number>();
      for (const posting of golden.postings) {
        expected.set(posting.code, (expected.get(posting.code) ?? 0) + posting.amount_paisa);
      }
      const actual = fold(set);
      assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort());
      for (const [code, amount] of expected) {
        assert.equal(actual.get(code), amount, `${golden.id} ${code}`);
      }

      if (golden.breakdown !== undefined) {
        const money = deliveredBreakdown({
          orderId: ORDER,
          vendorId: VENDOR,
          riderId: RIDER,
          subtotalPaisa: num(golden.inputs, "subtotal_paisa"),
          rideCorePaisa: num(golden.inputs, "ride_core_paisa"),
          ...(optional(golden.inputs, "tip_paisa") === undefined ? {} : { tipPaisa: num(golden.inputs, "tip_paisa") }),
          ...(optional(golden.inputs, "small_order_fee_paisa") === undefined
            ? {}
            : { smallOrderFeePaisa: num(golden.inputs, "small_order_fee_paisa") }),
          ...(optional(golden.inputs, "small_order_rider_share_paisa") === undefined
            ? {}
            : { smallOrderRiderSharePaisa: num(golden.inputs, "small_order_rider_share_paisa") }),
        });
        assert.deepEqual(
          {
            subtotal_paisa: money.subtotalPaisa,
            ride_core_paisa: money.rideCorePaisa,
            platform_delivery_margin_paisa: money.platformDeliveryMarginPaisa,
            delivery_fee_paisa: money.deliveryFeePaisa,
            commission_paisa: money.commissionPaisa,
            rider_bonus_paisa: money.riderBonusPaisa,
            taxable_base_paisa: money.taxableBasePaisa,
            tax_paisa: money.taxPaisa,
            small_order_platform_paisa: money.smallOrderPlatformPaisa,
            raw_total_paisa: money.rawTotalPaisa,
            cash_collected_paisa: money.cashCollectedPaisa,
            rounding_delta_paisa: money.roundingDeltaPaisa,
          },
          golden.breakdown,
        );
      }
    });
  }
});
