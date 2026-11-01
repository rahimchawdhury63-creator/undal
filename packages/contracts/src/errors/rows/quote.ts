/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Price quote failures. A quote is a five-minute promise; these codes exist so the customer is told precisely which part of the promise broke before any money moves.
 */
import type { ErrorRow } from "../types.ts";

/**
 * 9 definitions. One row is one code: `[code, status, en, bn, retryable, details]`.
 * The tuple is short on purpose — six fields across 9 codes in an object literal would
 * push this file past the 700-line cap and bury the copy that translators edit.
 */
export const QUOTE_ROWS = [
  ["QUOTE_EXPIRED", 410, "This price is no longer valid. Refresh to see the current total.", "এই মূল্য আর বৈধ নয়। বর্তমান মোট দেখতে রিফ্রেশ করুন।", true, "{ expired_at: string }"],
  ["QUOTE_MISMATCH", 409, "The total changed since you quoted. Review before paying.", "আপনার কোটের পর মোট বদলেছে। পেমেন্টের আগে দেখুন।", true, "{ expected_total: number, actual_total: number }"],
  ["QUOTE_BELOW_MINIMUM", 422, "The order is below this vendor's minimum.", "অর্ডারটি এই ভেন্ডরের সর্বনিম্ন সීমার নিচে।", false, "{ minimum: number, subtotal: number }"],
  ["QUOTE_NO_ZONE", 422, "Delivery is not available for that address yet.", "এই ঠিকানায় এখন ডেলিভারি চালু নেই।", true, "{}"],
  ["QUOTE_NOT_FOUND", 404, "That quote does not exist. Get a new price.", "এই কোটটি নেই। নতুন মূল্য নিন।", false, "{ quote_id: string }"],
  ["QUOTE_ALREADY_USED", 409, "This quote was already turned into an order.", "এই কোট থেকে অর্ডার তৈরি হয়েছে।", false, "{ order_id: string }"],
  ["QUOTE_ADDRESS_OUT_OF_RANGE", 422, "That address is too far from the vendor.", "ঠিকানাটি ভেন্ডর থেকে অনেক দূরে।", false, "{ distance_m: number, max_m: number }"],
  ["QUOTE_PAYMENT_METHOD_UNSUPPORTED", 422, "This payment method is not available.", "এই পেমেন্ট মাধ্যমটি চালু নেই।", false, "{ allowed: string[] }"],
  ["QUOTE_INGREDIENTS_CHANGED", 409, "The vendor changed this item. Review before ordering.", "ভেন্ডর আইটেমটি বদলেছে। অর্ডারের আগে দেখুন।", true, "{ item_id: string }"],
] as const satisfies readonly ErrorRow[];
