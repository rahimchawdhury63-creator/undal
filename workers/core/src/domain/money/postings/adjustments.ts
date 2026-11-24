/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { applyRate } from "@undal/money";

import { PLATFORM_ACCOUNTS, customerAccount, riderAccount, riderCashAccount, vendorAccount } from "../../ledger/accounts.ts";
import type { PostingSet } from "../../ledger/types.ts";
import { RIDER_BONUS_BPS } from "../rates.ts";

/**
 * The adjustments that ride alongside an order: refunds, tips, promos, weather, rounding,
 * bundle credit and the rare platform-funded bonus.
 *
 * Each of these is a separate entry rather than extra lines on the order posting, because
 * each has its own cause and its own audit reason. A refund that happened three days later
 * must be a row an auditor can find by date, not a mutation of a set posted on delivery.
 */

/** A refund credited to the customer's balance, since a bank reversal is not always possible. */
export function refundCredit(input: { readonly orderId: string; readonly customerId: string; readonly amountPaisa: number }): PostingSet {
  return {
    entryType: "REFUND_CREDIT",
    description: `Refund credited for order ${input.orderId}`,
    postings: [
      { account: PLATFORM_ACCOUNTS.EXPENSE_COMPENSATION, amountPaisa: input.amountPaisa },
      { account: customerAccount(input.customerId), amountPaisa: -input.amountPaisa },
    ],
    orderId: input.orderId,
  };
}

/**
 * A tip, passed through in full.
 *
 * Two postings and nothing else: the platform's cut is zero, and the shape of the entry is
 * the proof. A tip posted with a commission line would be the single most damaging bug the
 * ledger could have, and it cannot be written through this function.
 */
export function tip(input: { readonly orderId: string; readonly riderId: string; readonly amountPaisa: number }): PostingSet {
  return {
    entryType: "TIP",
    description: `Tip for rider on order ${input.orderId}`,
    postings: [
      { account: riderCashAccount(input.riderId), amountPaisa: input.amountPaisa },
      { account: riderAccount(input.riderId), amountPaisa: -input.amountPaisa },
    ],
    orderId: input.orderId,
  };
}

/** A promo the platform paid for, which is an expense and reduces the cash the rider holds. */
export function promoPlatform(input: { readonly orderId: string; readonly amountPaisa: number }): PostingSet {
  return {
    entryType: "PROMO_PLATFORM",
    description: `Platform-funded promo on order ${input.orderId}`,
    postings: [
      { account: PLATFORM_ACCOUNTS.EXPENSE_PROMO, amountPaisa: input.amountPaisa },
      { account: PLATFORM_ACCOUNTS.BANK, amountPaisa: -input.amountPaisa },
    ],
    orderId: input.orderId,
  };
}

/**
 * A promo the vendor paid for.
 *
 * The discount reduces what the vendor is owed rather than costing the platform anything:
 * the vendor's liability is debited, and the cash the rider collects is correspondingly
 * smaller.
 */
export function promoVendor(input: { readonly orderId: string; readonly vendorId: string; readonly amountPaisa: number }): PostingSet {
  return {
    entryType: "PROMO_VENDOR",
    description: `Vendor-funded promo on order ${input.orderId}`,
    postings: [
      { account: vendorAccount(input.vendorId), amountPaisa: input.amountPaisa },
      { account: PLATFORM_ACCOUNTS.BANK, amountPaisa: -input.amountPaisa },
    ],
    orderId: input.orderId,
  };
}

/** A weather premium, paid to the rider and borne by the platform. */
export function weatherSubsidy(input: { readonly orderId: string; readonly riderId: string; readonly amountPaisa: number }): PostingSet {
  return {
    entryType: "WEATHER_SUBSIDY",
    description: `Weather subsidy for rider on order ${input.orderId}`,
    postings: [
      { account: PLATFORM_ACCOUNTS.EXPENSE_WEATHER_SUBSIDY, amountPaisa: input.amountPaisa },
      { account: riderAccount(input.riderId), amountPaisa: -input.amountPaisa },
    ],
    orderId: input.orderId,
  };
}

/**
 * The rounding entry, when it is posted on its own.
 *
 * Normally the delta rides inside the order posting; this exists for the adjustment case,
 * where a reconciliation finds a floor that was applied twice and the paisa has to move.
 */
export function rounding(input: { readonly orderId: string; readonly deltaPaisa: number }): PostingSet {
  return {
    entryType: "ROUNDING",
    description: `Rounding adjustment on order ${input.orderId}`,
    postings: [
      { account: PLATFORM_ACCOUNTS.EXPENSE_ROUNDING, amountPaisa: -input.deltaPaisa },
      { account: PLATFORM_ACCOUNTS.BANK, amountPaisa: input.deltaPaisa },
    ],
    orderId: input.orderId,
  };
}

/** A bundle credit: the platform pays, the customer's cash is reduced. */
export function bundleCredit(input: { readonly orderId: string; readonly amountPaisa: number }): PostingSet {
  return {
    entryType: "BUNDLE_CREDIT",
    description: `Bundle credit on order ${input.orderId}`,
    postings: [
      { account: PLATFORM_ACCOUNTS.EXPENSE_PROMO, amountPaisa: input.amountPaisa },
      { account: PLATFORM_ACCOUNTS.BANK, amountPaisa: -input.amountPaisa },
    ],
    orderId: input.orderId,
  };
}

/**
 * A platform-funded rider bonus: the only case where `EXPENSE_RIDER_BONUS` is used.
 *
 * The ordinary 3% bonus is vendor-funded and rides inside the order posting. This function
 * exists for the promotional case `24 §2.3` carves out, and the entry type is different so
 * that a report can tell the two apart.
 */
export function riderBonusPlatform(input: { readonly orderId: string; readonly riderId: string; readonly subtotalPaisa: number }): PostingSet {
  const amountPaisa = applyRate(input.subtotalPaisa, RIDER_BONUS_BPS);
  return {
    entryType: "RIDER_BONUS_PLATFORM",
    description: `Platform-funded rider bonus on order ${input.orderId}`,
    postings: [
      { account: PLATFORM_ACCOUNTS.EXPENSE_RIDER_BONUS, amountPaisa },
      { account: riderAccount(input.riderId), amountPaisa: -amountPaisa },
    ],
    orderId: input.orderId,
  };
}

/**
 * A customer credit: compensation granted as store credit rather than a cash refund.
 *
 * `24 §3` posts it against the loyalty liability because that is where the customer's credit
 * balance lives — granting it twice, once as an expense and once as a liability, would leave
 * the platform owing the same taka from two places.
 */
export function customerCredit(input: { readonly customerId: string; readonly amountPaisa: number }): PostingSet {
  return {
    entryType: "REFUND_CREDIT",
    description: `Customer credit granted`,
    postings: [
      { account: PLATFORM_ACCOUNTS.EXPENSE_COMPENSATION, amountPaisa: input.amountPaisa },
      { account: PLATFORM_ACCOUNTS.LOYALTY_LIABILITY, amountPaisa: -input.amountPaisa },
    ],
  };
}

/** A rider penalty: rare, admin-only, and revenue rather than an expense reversal. */
export function riderPenalty(input: { readonly riderId: string; readonly amountPaisa: number; readonly reason: string }): PostingSet {
  return {
    entryType: "RIDER_PENALTY",
    description: `Rider penalty: ${input.reason}`.slice(0, 256),
    postings: [
      { account: riderAccount(input.riderId), amountPaisa: input.amountPaisa },
      { account: PLATFORM_ACCOUNTS.REVENUE_PENALTY, amountPaisa: -input.amountPaisa },
    ],
  };
}
