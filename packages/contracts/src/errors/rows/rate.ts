/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Rate-limit refusals. They are errors rather than silent retries because a customer who is being throttled deserves to know, and a rider whose accept was throttled must not be shown a false success.
 */
import type { ErrorRow } from "../types.ts";

/**
 * 3 definitions. One row is one code: `[code, status, en, bn, retryable, details]`.
 * The tuple is short on purpose — six fields across 3 codes in an object literal would
 * push this file past the 700-line cap and bury the copy that translators edit.
 */
export const RATE_ROWS = [
  ["RATE_LIMITED", 429, "Too many requests. Slow down for a moment.", "অনেক বেশি অনুরোধ। একটু থামুন।", true, "{ retry_after_seconds: number, limit: number }"],
  ["RATE_LIMITED_LOGIN", 429, "Too many sign-in attempts. Wait a minute.", "অনেকবার সাইন ইন চেষ্টা। এক মিনিট অপেক্ষা করুন।", true, "{ retry_after_seconds: number, limit: number }"],
  ["RATE_LIMITED_GLOBAL", 503, "Undal is very busy. Try again shortly.", "আন্ডালে এখন অনেক চাপ। কিছুক্ষণ পরে চেষ্টা করুন।", true, "{ retry_after_seconds: number }"],
] as const satisfies readonly ErrorRow[];
