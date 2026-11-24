/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The fourteen posting sets, in one place so a reader can see them all at once.
 *
 * Every function here returns a `PostingSet` that closes; none of them writes anything. The
 * write happens in `domain/ledger/post-entry.ts`, which asserts closure again against the
 * rows the database actually holds — the separation is what lets ten thousand generated
 * cases run in a test without a database.
 */
export { deliveredBreakdown, orderCancelled, orderDelivered, orderDeliveredPickup, type DeliveredBreakdown, type DeliveredInput } from "./order.ts";
export {
  bundleCredit,
  customerCredit,
  promoPlatform,
  promoVendor,
  refundCredit,
  riderBonusPlatform,
  riderPenalty,
  rounding,
  tip,
  weatherSubsidy,
} from "./adjustments.ts";
export { adjustment, cashSettled, cashWriteOff, invoiceAccrual, loyalty, riderPayout, vendorPayout } from "./movements.ts";
