/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { applyRate, floorToTaka } from "@undal/money";

import {
  PLATFORM_ACCOUNTS,
  customerAccount,
  riderAccount,
  riderCashAccount,
  vendorAccount,
} from "../../ledger/accounts.ts";
import type { Posting, PostingSet } from "../../ledger/types.ts";
import { COMMISSION_BPS, DELIVERY_MARGIN_BPS, RIDER_BONUS_BPS, TAX_BPS } from "../rates.ts";

/**
 * The order posting sets: delivered for cash, delivered as a pickup, and cancelled after
 * preparation.
 *
 * Every figure is derived here from the order's inputs rather than accepted from the caller,
 * because `24 §2.3` makes three promises that only hold if the arithmetic lives in one
 * place: the rider bonus is vendor-funded and never a platform expense, the taxable base is
 * the platform's fee revenue and nothing else, and every set closes.
 */

/** What an order delivered for cash carries, as the order row already knows it. */
export interface DeliveredInput {
  readonly orderId: string;
  readonly vendorId: string;
  readonly riderId: string;
  /** The food subtotal, before discounts. */
  readonly subtotalPaisa: number;
  /** The ride core: base fare plus distance, after surge, before the platform margin. */
  readonly rideCorePaisa: number;
  /** The tip the customer added, if any. */
  readonly tipPaisa?: number;
  /** The small-order fee charged, if any. */
  readonly smallOrderFeePaisa?: number;
  /** The part of the small-order fee that goes to the rider. */
  readonly smallOrderRiderSharePaisa?: number;
  /** The part that goes to the vendor, who is owed more because of it. */
  readonly smallOrderVendorSharePaisa?: number;
}

/** The arithmetic a delivered order implies, exported so the invoice and the app agree. */
export interface DeliveredBreakdown {
  readonly subtotalPaisa: number;
  readonly rideCorePaisa: number;
  readonly platformDeliveryMarginPaisa: number;
  readonly deliveryFeePaisa: number;
  readonly commissionPaisa: number;
  readonly riderBonusPaisa: number;
  readonly taxableBasePaisa: number;
  readonly taxPaisa: number;
  readonly smallOrderVendorPaisa: number;
  readonly smallOrderPlatformPaisa: number;
  readonly rawTotalPaisa: number;
  readonly cashCollectedPaisa: number;
  readonly roundingDeltaPaisa: number;
}

/**
 * Derive the money for a delivered order.
 *
 * `cashCollectedPaisa` is the floored total: the customer pays whole taka in cash, and the
 * `roundingDeltaPaisa` (always in (−100, 0]) is what the platform absorbs.
 */
export function deliveredBreakdown(input: DeliveredInput): DeliveredBreakdown {
  const tip = input.tipPaisa ?? 0;
  const smallOrderFee = input.smallOrderFeePaisa ?? 0;
  const smallOrderShare = input.smallOrderRiderSharePaisa ?? 0;
  const smallOrderVendor = input.smallOrderVendorSharePaisa ?? 0;
  // `10 §8`: the fee is split three ways, and the platform keeps only what is left. A
  // two-way split here would quietly move the vendor's ৳5 onto the platform's revenue line.
  const smallOrderPlatform = smallOrderFee - smallOrderShare - smallOrderVendor;

  const platformDeliveryMarginPaisa = applyRate(input.rideCorePaisa, DELIVERY_MARGIN_BPS);
  const deliveryFeePaisa = input.rideCorePaisa + platformDeliveryMarginPaisa;
  const commissionPaisa = applyRate(input.subtotalPaisa, COMMISSION_BPS);
  const riderBonusPaisa = applyRate(input.subtotalPaisa, RIDER_BONUS_BPS);
  const taxableBasePaisa = commissionPaisa + platformDeliveryMarginPaisa + smallOrderPlatform;
  const taxPaisa = applyRate(taxableBasePaisa, TAX_BPS);

  const rawTotalPaisa = input.subtotalPaisa + deliveryFeePaisa + taxPaisa + tip + smallOrderFee;
  const floored = floorToTaka(rawTotalPaisa);

  return {
    subtotalPaisa: input.subtotalPaisa,
    rideCorePaisa: input.rideCorePaisa,
    platformDeliveryMarginPaisa,
    deliveryFeePaisa,
    commissionPaisa,
    riderBonusPaisa,
    taxableBasePaisa,
    taxPaisa,
    smallOrderVendorPaisa: smallOrderVendor,
    smallOrderPlatformPaisa: smallOrderPlatform,
    rawTotalPaisa,
    cashCollectedPaisa: floored.total,
    roundingDeltaPaisa: floored.delta,
  };
}

/**
 * The canonical order posting: seven lines, and the two that appear only when they exist.
 *
 * A zero-amount posting is never emitted — the schema refuses it, and the reason it refuses
 * is here: a set with `RIDER_CASH +0` would make "which accounts moved" untrue.
 */
export function orderDelivered(input: DeliveredInput): PostingSet {
  const money = deliveredBreakdown(input);
  const tip = input.tipPaisa ?? 0;
  const smallOrderFee = input.smallOrderFeePaisa ?? 0;
  const smallOrderShare = input.smallOrderRiderSharePaisa ?? 0;

  const postings: Posting[] = [
    { account: riderCashAccount(input.riderId), amountPaisa: money.cashCollectedPaisa },
    {
      account: vendorAccount(input.vendorId),
      amountPaisa: -(money.subtotalPaisa - money.commissionPaisa - money.riderBonusPaisa + money.smallOrderVendorPaisa),
    },
    { account: riderAccount(input.riderId), amountPaisa: -(money.rideCorePaisa + money.riderBonusPaisa + tip) },
    { account: PLATFORM_ACCOUNTS.REVENUE_COMMISSION, amountPaisa: -money.commissionPaisa },
    { account: PLATFORM_ACCOUNTS.REVENUE_DELIVERY_MARGIN, amountPaisa: -money.platformDeliveryMarginPaisa },
    { account: PLATFORM_ACCOUNTS.TAX_PAYABLE, amountPaisa: -money.taxPaisa },
  ];

  // The platform gives up the paisa the customer never counts, so the ledger still closes.
  if (money.roundingDeltaPaisa !== 0) {
    postings.push({ account: PLATFORM_ACCOUNTS.EXPENSE_ROUNDING, amountPaisa: -money.roundingDeltaPaisa });
  }
  // The tip is inside `cashCollectedPaisa`, so it needs exactly one credit line — on the
  // rider, who keeps all of it — and no second debit. A passing tip posted as a separate
  // pair here would count the customer's money twice; the standalone `tip()` set exists for
  // a tip added after delivery, where the cash genuinely arrives on its own.
  // The small-order fee, split between the rider's share and the platform's revenue. Like
  // the tip, the whole fee is already inside `cashCollectedPaisa`, so it needs credits and
  // not a second cash debit.
  if (smallOrderFee !== 0) {
    if (smallOrderShare !== 0) postings.push({ account: riderAccount(input.riderId), amountPaisa: -smallOrderShare });
    if (money.smallOrderPlatformPaisa !== 0) {
      postings.push({ account: PLATFORM_ACCOUNTS.REVENUE_SMALL_ORDER, amountPaisa: -money.smallOrderPlatformPaisa });
    }
  }

  return {
    entryType: "ORDER_DELIVERED",
    description: `Order ${input.orderId} delivered, ${money.cashCollectedPaisa} paisa collected in cash`,
    postings,
    orderId: input.orderId,
  };
}

/** What a pickup order carries: the same food, no rider, no delivery fee. */
export interface PickupInput {
  readonly orderId: string;
  readonly vendorId: string;
  readonly subtotalPaisa: number;
  readonly smallOrderFeePaisa?: number;
}

/**
 * A pickup order: the vendor is owed the subtotal less commission, the platform earns the
 * commission, and there is no delivery fee, no rider line and no tax on a fee nobody paid.
 */
export function orderDeliveredPickup(input: PickupInput): PostingSet {
  const commissionPaisa = applyRate(input.subtotalPaisa, COMMISSION_BPS);
  const smallOrderFee = input.smallOrderFeePaisa ?? 0;
  // A pickup fee is entirely platform revenue — there is no rider to share it with — so it
  // belongs in the taxable base alongside the commission, per invariant 2 of `24 §2.3`.
  const taxPaisa = applyRate(commissionPaisa + smallOrderFee, TAX_BPS);
  const rawTotal = input.subtotalPaisa + taxPaisa + smallOrderFee;
  const floored = floorToTaka(rawTotal);

  const postings: Posting[] = [
    { account: PLATFORM_ACCOUNTS.BANK, amountPaisa: floored.total },
    { account: vendorAccount(input.vendorId), amountPaisa: -(input.subtotalPaisa - commissionPaisa) },
    { account: PLATFORM_ACCOUNTS.REVENUE_COMMISSION, amountPaisa: -commissionPaisa },
    { account: PLATFORM_ACCOUNTS.TAX_PAYABLE, amountPaisa: -taxPaisa },
  ];
  if (smallOrderFee !== 0) postings.push({ account: PLATFORM_ACCOUNTS.REVENUE_SMALL_ORDER, amountPaisa: -smallOrderFee });
  if (floored.delta !== 0) postings.push({ account: PLATFORM_ACCOUNTS.EXPENSE_ROUNDING, amountPaisa: -floored.delta });

  return {
    entryType: "ORDER_DELIVERED_PICKUP",
    description: `Pickup order ${input.orderId} collected, ${floored.total} paisa`,
    postings,
    orderId: input.orderId,
  };
}

/**
 * A cancellation the platform pays for.
 *
 * `24 §3` is explicit: the cost of a prepared-then-cancelled order is borne by the platform,
 * never the customer and never the rider — so the vendor is made whole and the platform
 * carries the expense. The cash leg is only present when the customer had already paid.
 */
export function orderCancelled(input: {
  readonly orderId: string;
  readonly vendorId: string;
  /** The customer whose balance the refund is credited to, when one was charged. */
  readonly customerId: string;
  readonly preparedCostPaisa: number;
  readonly refundedToCustomerPaisa?: number;
  readonly customerCashHeldPaisa?: number;
}): PostingSet {
  const refunded = input.refundedToCustomerPaisa ?? 0;
  const postings: Posting[] = [
    { account: PLATFORM_ACCOUNTS.EXPENSE_COMPENSATION, amountPaisa: input.preparedCostPaisa },
    { account: vendorAccount(input.vendorId), amountPaisa: -input.preparedCostPaisa },
  ];
  if (refunded !== 0) {
    postings.push({ account: PLATFORM_ACCOUNTS.BANK, amountPaisa: refunded });
    postings.push({ account: customerAccount(input.customerId), amountPaisa: -refunded });
  }
  return {
    entryType: "ORDER_CANCELLED",
    description: `Order ${input.orderId} cancelled after preparation; platform absorbs ${input.preparedCostPaisa} paisa`,
    postings,
    orderId: input.orderId,
  };
}
