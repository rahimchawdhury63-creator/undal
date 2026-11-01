/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Dispatch offer failures, which are the most timing-sensitive codes in the platform: a rider tapping accept 200 ms after another rider is told the truth instead of being shown a spinner.
 */
import type { ErrorRow } from "../types.ts";

/**
 * 11 definitions. One row is one code: `[code, status, en, bn, retryable, details]`.
 * The tuple is short on purpose — six fields across 11 codes in an object literal would
 * push this file past the 700-line cap and bury the copy that translators edit.
 */
export const OFFER_ROWS = [
  ["OFFER_EXPIRED", 410, "This delivery offer expired.", "এই ডেলিভারি অফারটির সময় শেষ।", true, "{ expires_at: string }"],
  ["OFFER_CLAIMED", 409, "Another rider took this delivery.", "অন্য একজন রাইডার এই ডেলিভারিটি নিয়েছেন।", true, "{}"],
  ["OFFER_NOT_FOUND", 404, "That offer does not exist.", "এই অফারটি নেই।", false, "{ offer_id: string }"],
  ["OFFER_CLAIM_RACE", 409, "You were beaten to this delivery by a moment.", "এক মুহূর্তের ব্যবধানে অন্য রাইডার এগিয়ে গেছেন।", true, "{}"],
  ["OFFER_REJECT_NOT_ALLOWED", 409, "This offer can no longer be declined.", "এই অফারটি আর প্রত্যাখ্যান করা যাবে না।", false, "{ state: string }"],
  ["OFFER_REASON_REQUIRED", 422, "Choose a reason for declining.", "প্রত্যাখ্যানের কারণ বেছে নিন।", false, "{ allowed: string[] }"],
  ["OFFER_NOT_TARGETED", 403, "This offer was not sent to you.", "এই অফারটি আপনাকে পাঠানো হয়নি।", false, "{}"],
  ["OFFER_WAVE_CLOSED", 409, "This dispatch wave is over.", "এই ডিসপ্যাচ ওয়েভ শেষ।", true, "{ wave: number }"],
  ["OFFER_ACCEPT_DISABLED", 409, "Order acceptance is paused for your account.", "আপনার অ্যাকাউন্টে অর্ডার গ্রহণ বন্ধ আছে।", false, "{}"],
  ["OFFER_ALREADY_REJECTED", 409, "You already declined this delivery.", "আপনি এই ডেলিভারিটি আগেই প্রত্যাখ্যান করেছেন।", false, "{}"],
  ["OFFER_VEHICLE_MISMATCH", 409, "Your vehicle cannot carry this order.", "আপনার যানটি এই অর্ডার বহন করতে পারবে না।", false, "{ required: string, yours: string }"],
] as const satisfies readonly ErrorRow[];
