/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Cash-collection failures. Undal is a COD business, so this group is where money-in disputes are prevented: duplicate bKash transaction IDs, short collections and unphotographed handovers are refused at the door, not reconciled a week later.
 */
import type { ErrorRow } from "../types.ts";

/**
 * 11 definitions. One row is one code: `[code, status, en, bn, retryable, details]`.
 * The tuple is short on purpose — six fields across 11 codes in an object literal would
 * push this file past the 700-line cap and bury the copy that translators edit.
 */
export const CASH_ROWS = [
  ["CASH_TRXID_DUPLICATE", 409, "This bKash transaction was already recorded.", "এই বিকাশ লেনদেন আগেই লেখা হয়েছে।", false, "{ trx_id: string }"],
  ["CASH_AMOUNT_MISMATCH", 422, "The amount does not match what is owed.", "পরিমাণটি বাকির সাথে মিলছে না।", false, "{ expected: number, received: number }"],
  ["CASH_SELFIE_REQUIRED", 422, "Take a photo of the handover.", "হস্তান্তরের একটি ছবি তুলুন।", false, "{}"],
  ["CASH_TRXID_INVALID", 422, "Enter a valid bKash transaction ID.", "সঠিক বিকাশ ট্রানজেকশন আইডি দিন।", false, "{ pattern: string }"],
  ["CASH_ALREADY_SETTLED", 409, "This cash was already settled.", "এই নগদ আগেই নিষ্পত্তি হয়েছে।", false, "{ settled_at: string }"],
  ["CASH_SETTLEMENT_WINDOW_CLOSED", 409, "The settlement window for that day is closed.", "ওই দিনের নিষ্পত্তির সময় শেষ।", false, "{}"],
  ["CASH_OVERPAYMENT", 422, "You entered more than is owed.", "বাকির চেয়ে বেশি লিখেছেন।", false, "{ expected: number, received: number }"],
  ["CASH_UNDERPAYMENT", 422, "The collected cash is short.", "সংগৃহীত নগদ কম হয়েছে।", false, "{ expected: number, received: number, short_by: number }"],
  ["CASH_DEPOSIT_REQUIRED", 409, "Deposit collected cash before continuing.", "চালিয়ে যাওয়ার আগে সংগৃহীত নগদ জমা দিন।", false, "{ outstanding: number }"],
  ["CASH_CASE_UNAVAILABLE", 409, "This case is closed, not routed for review, or already claimed.", "এই মামলাটি বন্ধ, পর্যালোচনার জন্য পাঠানো হয়নি, অথবা ইতিমধ্যে গ্রহণ করা হয়েছে।", false, "{}"],
  ["CASH_DECLARATION_NOT_FOUND", 404, "That cash case does not exist.", "এই নগদ মামলাটি নেই।", false, "{ declaration_id: string }"],
] as const satisfies readonly ErrorRow[];
