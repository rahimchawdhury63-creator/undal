/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Account, AccountKind, OwnerType } from "./types.ts";

/**
 * The account catalogue: fourteen accounts, named exactly as `24 §1.1` names them.
 *
 * Accounts are addressed by a code that embeds the owner id, so a vendor's liability is a
 * row rather than a column on the vendor — which is what lets the trial balance be a query
 * instead of a reconciliation, and lets a vendor's history survive a rename.
 */

/** The platform's own accounts, whose codes carry no owner. */
export const PLATFORM_ACCOUNTS = {
  BANK: { code: "PLATFORM:BANK", kind: "ASSET", ownerType: "PLATFORM" },
  LOYALTY_LIABILITY: { code: "PLATFORM:LOYALTY_LIABILITY", kind: "LIABILITY", ownerType: "PLATFORM" },
  TAX_PAYABLE: { code: "PLATFORM:TAX_PAYABLE", kind: "LIABILITY", ownerType: "PLATFORM" },
  REVENUE_COMMISSION: { code: "PLATFORM:REVENUE_COMMISSION", kind: "REVENUE", ownerType: "PLATFORM" },
  REVENUE_DELIVERY_MARGIN: { code: "PLATFORM:REVENUE_DELIVERY_MARGIN", kind: "REVENUE", ownerType: "PLATFORM" },
  REVENUE_SMALL_ORDER: { code: "PLATFORM:REVENUE_SMALL_ORDER", kind: "REVENUE", ownerType: "PLATFORM" },
  EXPENSE_RIDER_BONUS: { code: "PLATFORM:EXPENSE_RIDER_BONUS", kind: "EXPENSE", ownerType: "PLATFORM" },
  EXPENSE_WEATHER_SUBSIDY: { code: "PLATFORM:EXPENSE_WEATHER_SUBSIDY", kind: "EXPENSE", ownerType: "PLATFORM" },
  EXPENSE_ROUNDING: { code: "PLATFORM:EXPENSE_ROUNDING", kind: "EXPENSE", ownerType: "PLATFORM" },
  EXPENSE_PROMO: { code: "PLATFORM:EXPENSE_PROMO", kind: "EXPENSE", ownerType: "PLATFORM" },
  EXPENSE_COMPENSATION: { code: "PLATFORM:EXPENSE_COMPENSATION", kind: "EXPENSE", ownerType: "PLATFORM" },
  REVENUE_PENALTY: { code: "PLATFORM:REVENUE_PENALTY", kind: "REVENUE", ownerType: "PLATFORM" },
} as const satisfies Record<string, Account>;

/** A vendor's liability: negative means Undal owes them. */
export function vendorAccount(vendorId: string): Account {
  return { code: `VENDOR:${vendorId}`, kind: "LIABILITY", ownerType: "VENDOR", ownerId: vendorId };
}

/** A rider's earned liability: negative means Undal owes them a payout. */
export function riderAccount(riderId: string): Account {
  return { code: `RIDER:${riderId}`, kind: "LIABILITY", ownerType: "RIDER", ownerId: riderId };
}

/** A rider's cash float: positive means the rider is holding Undal's money. */
export function riderCashAccount(riderId: string): Account {
  return { code: `RIDER_CASH:${riderId}`, kind: "ASSET", ownerType: "RIDER", ownerId: riderId };
}

/** A customer's credit balance, for refunds the bank cannot return. */
export function customerAccount(customerId: string): Account {
  return { code: `CUSTOMER:${customerId}`, kind: "LIABILITY", ownerType: "CUSTOMER", ownerId: customerId };
}

/** Every platform account, in catalogue order, for the accounts migration and the panel. */
export const ALL_PLATFORM_ACCOUNTS: readonly Account[] = Object.values(PLATFORM_ACCOUNTS);

/**
 * Parse an account code back into its parts.
 *
 * The ledger export and the admin account list both need to group by kind without joining
 * `ledger_accounts`, and a code is the only thing some rows carry.
 */
export function parseAccountCode(code: string): { prefix: string; ownerId: string | null } {
  const separator = code.indexOf(":");
  if (separator === -1) return { prefix: code, ownerId: null };
  return { prefix: code.slice(0, separator), ownerId: code.slice(separator + 1) };
}

/**
 * The sign convention, expressed once: a positive posting debits, a negative credits.
 *
 * `naturalBalance` converts a raw balance into the number a human expects for the kind —
 * a liability of 369 taka reads as 369 rather than −36 900 paisa.
 */
export function naturalBalance(kind: AccountKind, rawPaisa: number): number {
  return kind === "LIABILITY" || kind === "REVENUE" || kind === "EQUITY" ? -rawPaisa : rawPaisa;
}

/** The kind an owner type implies, used when creating a new account row. */
export function kindForOwner(ownerType: OwnerType): AccountKind {
  switch (ownerType) {
    case "VENDOR":
    case "RIDER":
    case "CUSTOMER":
      return "LIABILITY";
    default:
      return "ASSET";
  }
}
