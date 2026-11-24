/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Invoices, payouts, the ledger, cash and tax — 56 keys.
 *
 * Every key is `resource.action` beneath a domain prefix, spelled out rather than
 * composed at runtime: a permission a client cannot grep for is a permission nobody
 * can review, and the RBAC matrix test reads these arrays as the source of truth.
 */
export const FINANCE_KEYS = [
  // finance.invoice
  "finance.invoice.read",
  "finance.invoice.list",
  "finance.invoice.create",
  "finance.invoice.void",
  "finance.invoice.regenerate",
  "finance.invoice.send",
  "finance.invoice.download",
  "finance.invoice.mark_paid",
  "finance.invoice.adjust",
  "finance.invoice.view_lines",
  "finance.invoice.export",
  "finance.invoice.view_audit",
  // finance.payout
  "finance.payout.read",
  "finance.payout.list",
  "finance.payout.create",
  "finance.payout.approve",
  "finance.payout.mark_paid",
  "finance.payout.retry",
  "finance.payout.cancel",
  "finance.payout.view_bank_account",
  "finance.payout.change_bank_account",
  "finance.payout.view_period",
  "finance.payout.close_period",
  "finance.payout.export",
  // finance.ledger
  "finance.ledger.read",
  "finance.ledger.post",
  "finance.ledger.reverse",
  "finance.ledger.view_trial_balance",
  "finance.ledger.view_account",
  "finance.ledger.adjust",
  "finance.ledger.export",
  "finance.ledger.view_closure",
  "finance.ledger.view_postings",
  "finance.ledger.reconcile",
  // finance.cash
  "finance.cash.read",
  "finance.cash.list_outstanding",
  "finance.cash.settle",
  "finance.cash.write_off",
  "finance.cash.view_settlement",
  "finance.cash.approve_settlement",
  "finance.cash.reject_settlement",
  "finance.cash.view_rider_wallet",
  "finance.cash.adjust",
  "finance.cash.export",
  // finance.tax
  "finance.tax.read",
  "finance.tax.configure",
  "finance.tax.file",
  "finance.tax.view_records",
  // finance.rounding
  "finance.rounding.read",
  "finance.rounding.view_adjustments",
  "finance.rounding.write_off",
  "finance.rounding.export",
  // finance.document
  "finance.document.read",
  "finance.document.upload",
  "finance.document.delete",
  "finance.document.download",
] as const;
