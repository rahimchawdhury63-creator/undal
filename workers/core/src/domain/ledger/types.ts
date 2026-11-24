/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The shapes the ledger is built from, and the fourteen accounts the platform has.
 *
 * Amounts are signed paisa: a debit is positive and a credit is negative, so "the entry
 * sums to zero" is `reduce((a, b) => a + b) === 0` and not a comparison of two totals.
 * That single convention is what makes closure a one-line assertion instead of a rule
 * with exceptions, and exceptions in a ledger are where money quietly disappears.
 */

/** The five accounting kinds, matching the `ledger_accounts.kind` CHECK. */
export type AccountKind = "ASSET" | "LIABILITY" | "REVENUE" | "EXPENSE" | "EQUITY";

/** Who owns an account, matching the `owner_type` CHECK. */
export type OwnerType = "PLATFORM" | "VENDOR" | "RIDER" | "CUSTOMER";

/** One side of a posting: an account code plus its metadata. */
export interface Account {
  /** The `ledger_accounts.code`, e.g. `VENDOR:0193…` or `PLATFORM:BANK`. */
  readonly code: string;
  readonly kind: AccountKind;
  readonly ownerType: OwnerType;
  /** The vendor, rider or customer id; absent for platform accounts. */
  readonly ownerId?: string;
}

/** A single posting. Positive is a debit, negative a credit. */
export interface Posting {
  readonly account: Account;
  readonly amountPaisa: number;
}

/**
 * The entry types the platform can post.
 *
 * A closed union rather than a string: the entry type decides which postings are legal,
 * the invoice generator groups by it, and a typo here would silently create a category
 * that no report queries.
 */
export type EntryType =
  | "ORDER_DELIVERED"
  | "ORDER_DELIVERED_PICKUP"
  | "ORDER_CANCELLED"
  | "REFUND_CREDIT"
  | "TIP"
  | "PROMO_PLATFORM"
  | "PROMO_VENDOR"
  | "WEATHER_SUBSIDY"
  | "ROUNDING"
  | "BUNDLE_CREDIT"
  | "PAYOUT_PAID"
  | "CASH_SETTLED"
  | "CASH_WRITE_OFF"
  | "ADJUSTMENT"
  | "LOYALTY"
  | "INVOICE_ACCRUAL"
  | "RIDER_PENALTY"
  | "RIDER_BONUS_PLATFORM";

/** A complete posting set: what to record, and what it describes. */
export interface PostingSet {
  readonly entryType: EntryType;
  /** One sentence, in English, that an auditor reads in the ledger list. */
  readonly description: string;
  readonly postings: readonly Posting[];
  /** The order this set belongs to, when it belongs to one. */
  readonly orderId?: string;
  readonly invoiceId?: string;
  readonly settlementId?: string;
}
