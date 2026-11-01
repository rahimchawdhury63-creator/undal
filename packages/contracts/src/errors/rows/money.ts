/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Ledger and payout failures. Several of these (unbalanced invoice, rounding invariant, settlement mismatch) are `500`s on purpose: they mean Undal's own arithmetic broke and the customer or vendor must not be blamed.
 */
import type { ErrorRow } from "../types.ts";

/**
 * 13 definitions. One row is one code: `[code, status, en, bn, retryable, details]`.
 * The tuple is short on purpose — six fields across 13 codes in an object literal would
 * push this file past the 700-line cap and bury the copy that translators edit.
 */
export const MONEY_ROWS = [
  ["MONEY_INVOICE_UNBALANCED", 500, "The invoice does not balance. This is our fault, not yours.", "ইনভয়েসের হিসাব মিলছে না। এটি আমাদের ত্রুটি।", false, "{ order_id: string, drift: number }"],
  ["MONEY_PERIOD_CLOSED", 409, "That accounting period is closed.", "এই হিসাবকাল বন্ধ।", false, "{ period: string }"],
  ["MONEY_ALREADY_PAID", 409, "This payout was already made.", "এই পরিশোধ আগেই হয়েছে।", false, "{ paid_at: string }"],
  ["MONEY_AMOUNT_NEGATIVE", 422, "The amount must be positive.", "পরিমাণ ধনাত্মক হতে হবে।", false, "{}"],
  ["MONEY_CURRENCY_MISMATCH", 422, "All amounts must be in the same currency.", "সব পরিমাণ একই মুদ্রায় হতে হবে।", false, "{ expected: string, received: string }"],
  ["MONEY_PAYOUT_NOT_FOUND", 404, "That payout does not exist.", "এই পরিশোধ নেই।", false, "{ payout_id: string }"],
  ["MONEY_PAYOUT_FAILED", 502, "The payout could not be sent. It will be retried.", "পরিশোধ পাঠানো যায়নি। আবার চেষ্টা হবে।", true, "{ payout_id: string, provider_status: string }"],
  ["MONEY_ROUNDING_INVARIANT", 500, "Rounding left a taka total off by paisa. This is our fault.", "রাউন্ডিংয়ে হিসাব মিলছে না। এটি আমাদের ত্রুটি।", false, "{ value: number }"],
  ["MONEY_LEDGER_CLOSED", 409, "The ledger for that period is locked.", "ওই সময়ের খতিয়ান বন্ধ।", false, "{ period: string }"],
  ["MONEY_SETTLEMENT_MISMATCH", 500, "Settlement totals do not match the ledger. This is our fault.", "নিষ্পত্তির মোট খতিয়ানের সাথে মিলছে না। এটি আমাদের ত্রুটি।", false, "{ drift: number }"],
  ["MONEY_WALLET_INSUFFICIENT", 422, "Your balance does not cover this.", "আপনার ব্যালেন্স এটি কভারের জন্য যথেষ্ট নয়।", false, "{ balance: number, required: number }"],
  ["MONEY_PAYOUT_LIMIT_EXCEEDED", 422, "This exceeds the daily payout limit.", "এটি দৈনিক পরিশোধ সীমা ছাড়িয়েছে।", false, "{ limit: number }"],
  ["MONEY_REFUND_EXCEEDS_PAID", 422, "A refund cannot exceed what was charged.", "রিফান্ড চার্জের বেশি হতে পারে না।", false, "{ paid: number, requested: number }"],
] as const satisfies readonly ErrorRow[];
