/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { PLATFORM_ACCOUNTS, customerAccount, riderAccount, riderCashAccount, vendorAccount } from "../../ledger/accounts.ts";
import type { PostingSet } from "../../ledger/types.ts";

/**
 * Money leaving the platform: payouts, cash settlements, write-offs, loyalty and the manual
 * adjustment.
 *
 * These sets move a liability to the bank or a rider's cash float to the bank. They are the
 * sets that can make the platform insolvent in a spreadsheet while looking fine in a
 * dashboard, so each asserts its direction: a payout debits the liability and credits the
 * bank, never the reverse.
 */

/** A rider payout: the platform's debt to the rider is discharged from the bank. */
export function riderPayout(input: { readonly riderId: string; readonly amountPaisa: number }): PostingSet {
  return {
    entryType: "PAYOUT_PAID",
    description: `Rider payout of ${input.amountPaisa} paisa`,
    postings: [
      { account: riderAccount(input.riderId), amountPaisa: input.amountPaisa },
      { account: PLATFORM_ACCOUNTS.BANK, amountPaisa: -input.amountPaisa },
    ],
  };
}

/** A vendor payout. */
export function vendorPayout(input: { readonly vendorId: string; readonly amountPaisa: number }): PostingSet {
  return {
    entryType: "PAYOUT_PAID",
    description: `Vendor payout of ${input.amountPaisa} paisa`,
    postings: [
      { account: vendorAccount(input.vendorId), amountPaisa: input.amountPaisa },
      { account: PLATFORM_ACCOUNTS.BANK, amountPaisa: -input.amountPaisa },
    ],
  };
}

/** A rider handing over the cash they collected: the float falls, the bank rises. */
export function cashSettled(input: { readonly riderId: string; readonly amountPaisa: number; readonly settlementId?: string }): PostingSet {
  return {
    entryType: "CASH_SETTLED",
    description: `Cash settlement of ${input.amountPaisa} paisa handed over`,
    postings: [
      { account: riderCashAccount(input.riderId), amountPaisa: -input.amountPaisa },
      { account: PLATFORM_ACCOUNTS.BANK, amountPaisa: input.amountPaisa },
    ],
    ...(input.settlementId === undefined ? {} : { settlementId: input.settlementId }),
  };
}

/**
 * A shortfall written off: the cash will never arrive, and pretending otherwise would keep a
 * rider permanently in debt for money somebody else took.
 */
export function cashWriteOff(input: { readonly riderId: string; readonly amountPaisa: number; readonly reason: string }): PostingSet {
  return {
    entryType: "CASH_WRITE_OFF",
    description: `Cash shortfall written off: ${input.reason}`.slice(0, 256),
    postings: [
      { account: PLATFORM_ACCOUNTS.EXPENSE_COMPENSATION, amountPaisa: input.amountPaisa },
      { account: riderCashAccount(input.riderId), amountPaisa: -input.amountPaisa },
    ],
  };
}

/**
 * A manual adjustment: two postings, a reason, and step-up auth at the route.
 *
 * It is the only set whose accounts the caller chooses, which is why the route that reaches
 * it requires a fresh TOTP code, a reason from the register, and a step-up-capable role.
 */
export function adjustment(input: {
  readonly debitCode: "PLATFORM:BANK" | "PLATFORM:EXPENSE_COMPENSATION" | "PLATFORM:EXPENSE_PROMO";
  readonly creditTarget: { readonly kind: "VENDOR" | "RIDER" | "CUSTOMER"; readonly id: string };
  readonly amountPaisa: number;
  readonly reason: string;
}): PostingSet {
  const credit =
    input.creditTarget.kind === "VENDOR"
      ? vendorAccount(input.creditTarget.id)
      : input.creditTarget.kind === "RIDER"
        ? riderAccount(input.creditTarget.id)
        : customerAccount(input.creditTarget.id);

  return {
    entryType: "ADJUSTMENT",
    description: `Manual adjustment: ${input.reason}`.slice(0, 256),
    postings: [
      {
        account: PLATFORM_ACCOUNTS[input.debitCode.replace("PLATFORM:", "") as "BANK" | "EXPENSE_COMPENSATION" | "EXPENSE_PROMO"],
        amountPaisa: input.amountPaisa,
      },
      { account: credit, amountPaisa: -input.amountPaisa },
    ],
  };
}

/**
 * Loyalty points issued and redeemed.
 *
 * Issuing creates a liability to the customer; redeeming discharges it into the order. Both
 * directions go through `PLATFORM:LOYALTY_LIABILITY`, so the balance is the points'
 * outstanding value rather than a number in a second system.
 */
export function loyalty(input: { readonly customerId: string; readonly amountPaisa: number; readonly direction: "ISSUE" | "REDEEM" }): PostingSet {
  const issuing = input.direction === "ISSUE";
  return {
    entryType: "LOYALTY",
    description: issuing ? `Loyalty points issued` : `Loyalty points redeemed`,
    postings: [
      { account: PLATFORM_ACCOUNTS.EXPENSE_PROMO, amountPaisa: issuing ? input.amountPaisa : -input.amountPaisa },
      {
        account: PLATFORM_ACCOUNTS.LOYALTY_LIABILITY,
        amountPaisa: issuing ? -input.amountPaisa : input.amountPaisa,
      },
    ],
  };
}

/**
 * An invoice accrual: the period's revenue is recognised as owed before it is paid.
 *
 * Posted at invoice generation, reversed at payout. Between the two, the vendor's liability
 * and the platform's accrued revenue both exist, which is what makes the invoice a document
 * about a real obligation rather than a report.
 */
export function invoiceAccrual(input: { readonly vendorId: string; readonly amountPaisa: number; readonly invoiceId: string }): PostingSet {
  return {
    entryType: "INVOICE_ACCRUAL",
    description: `Invoice accrual ${input.invoiceId}`,
    postings: [
      { account: PLATFORM_ACCOUNTS.BANK, amountPaisa: input.amountPaisa },
      { account: vendorAccount(input.vendorId), amountPaisa: -input.amountPaisa },
    ],
    invoiceId: input.invoiceId,
  };
}
