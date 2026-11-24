/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Identity-verification failures for vendors and riders, whose codes double as the state machine of the KYC review a human performs.
 */
import type { ErrorRow } from "../types.ts";

/**
 * 10 definitions. One row is one code: `[code, status, en, bn, retryable, details]`.
 * The tuple is short on purpose — six fields across 10 codes in an object literal would
 * push this file past the 700-line cap and bury the copy that translators edit.
 */
export const KYC_ROWS = [
  ["KYC_DOCUMENT_REQUIRED", 422, "Upload a document to continue.", "চালিয়ে যেতে একটি কাগজ আপলোড করুন।", false, "{ allowed: string[] }"],
  ["KYC_ALREADY_SUBMITTED", 409, "Your documents are already under review.", "আপনার কাগজপত্র আগেই যাচাইয়ে আছে।", false, "{ submitted_at: string }"],
  ["KYC_REJECTED", 403, "Your verification was not accepted.", "আপনার যাচাই গ্রহণ করা হয়নি।", false, "{ reason: string }"],
  ["KYC_PENDING", 403, "Your verification is still being reviewed.", "আপনার যাচাই এখনও চলছে।", true, "{ submitted_at: string }"],
  ["KYC_EXPIRED", 403, "Your verification expired. Submit new documents.", "আপনার যাচাইয়ের মেয়াদ শেষ। নতুন কাগজ দিন।", false, "{ expired_at: string }"],
  ["KYC_FILE_INVALID", 422, "That file cannot be used.", "এই ফাইলটি ব্যবহার করা যাবে না।", false, "{ reason: string }"],
  ["KYC_NID_MISMATCH", 422, "The NID details do not match your profile.", "এনআইডির তথ্য প্রোফাইলের সাথে মিলছে না।", false, "{}"],
  ["KYC_SELFIE_MISMATCH", 422, "The selfie does not match the ID photo.", "সেলফি পরিচয়পত্রের ছবির সাথে মিলছে না।", false, "{}"],
  ["KYC_VENDOR_LICENSE_REQUIRED", 422, "Upload a trade licence to sell on Undal.", "আন্ডালে বিক্রি করতে ট্রেড লাইসেন্স আপলোড করুন।", false, "{}"],
  ["KYC_RESUBMISSION_LIMIT", 429, "Too many submissions today. Try tomorrow.", "আজ অনেকবার জমা দেওয়া হয়েছে। কাল চেষ্টা করুন।", true, "{ retry_after_seconds: number }"],
] as const satisfies readonly ErrorRow[];
