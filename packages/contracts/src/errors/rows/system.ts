/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Platform-wide failures. Note the prefix mismatch the specification records: this table is grouped as `SYSTEM_` but its five codes are bare (`INTERNAL`, `SERVICE_DEGRADED`, `DEPENDENCY_TIMEOUT`, `IDEMPOTENCY_CONFLICT`, `NOT_IMPLEMENTED`). The codes are authoritative — clients match on them exactly — so the group file is named after the table row while the strings stay bare; `DECISIONS.md` D36 records why we did not invent `SYSTEM_INTERNAL`.
 */
import type { ErrorRow } from "../types.ts";

/**
 * 5 definitions. One row is one code: `[code, status, en, bn, retryable, details]`.
 * The tuple is short on purpose — six fields across 5 codes in an object literal would
 * push this file past the 700-line cap and bury the copy that translators edit.
 */
export const SYSTEM_ROWS = [
  ["INTERNAL", 500, "Something went wrong on our side. We have been notified.", "আমাদের দিকে কিছু ভুল হয়েছে। আমরা জানতে পেরেছি।", true, "{ trace_id: string }"],
  ["SERVICE_DEGRADED", 503, "Part of Undal is running slowly. Try again shortly.", "আন্ডালের একটি অংশ ধীরে চলছে। কিছুক্ষণ পরে চেষ্টা করুন।", true, "{ component: string }"],
  ["DEPENDENCY_TIMEOUT", 504, "A service we rely on did not answer in time.", "নির্ভরশীল একটি সেবা সময়মতো সাড়া দেয়নি।", true, "{ component: string, timeout_ms: number }"],
  ["IDEMPOTENCY_CONFLICT", 409, "This request was already sent with different contents.", "এই অনুরোধটি আগে ভিন্ন তথ্য দিয়ে পাঠানো হয়েছে।", false, "{ idempotency_key: string }"],
  ["NOT_IMPLEMENTED", 501, "This feature is not available in this build.", "এই সংস্করণে এই সুবিধাটি নেই।", false, "{}"],
] as const satisfies readonly ErrorRow[];
