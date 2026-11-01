/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Image upload failures, sized for the two free tiers that serve them: imgbb for originals and Cloudinary for derivatives.
 */
import type { ErrorRow } from "../types.ts";

/**
 * 8 definitions. One row is one code: `[code, status, en, bn, retryable, details]`.
 * The tuple is short on purpose — six fields across 8 codes in an object literal would
 * push this file past the 700-line cap and bury the copy that translators edit.
 */
export const MEDIA_ROWS = [
  ["MEDIA_TOO_LARGE", 413, "That file is too large.", "ফাইলটি অনেক বড়।", false, "{ max_bytes: number, received_bytes: number }"],
  ["MEDIA_UNSUPPORTED_TYPE", 415, "Only JPEG, PNG or WebP images can be uploaded.", "শুধু JPEG, PNG বা WebP ছবি আপলোড করা যায়।", false, "{ allowed: string[] }"],
  ["MEDIA_UPLOAD_FAILED", 502, "The upload did not finish. Try again.", "আপলোড শেষ হয়নি। আবার চেষ্টা করুন।", true, "{ provider: string }"],
  ["MEDIA_SCAN_REJECTED", 422, "That file was rejected by the safety check.", "ফাইলটি নিরাপত্তা যাচাইয়ে বাতিল হয়েছে।", false, "{}"],
  ["MEDIA_DIMENSIONS_INVALID", 422, "That image's size or shape is not accepted.", "ছবির মাপ বা অনুপাত গ্রহণযোগ্য নয়।", false, "{ width: number, height: number, min_side: number }"],
  ["MEDIA_STORAGE_QUOTA_EXCEEDED", 422, "You have used all your image storage.", "আপনার ছবির জায়গা শেষ।", false, "{ quota_bytes: number }"],
  ["MEDIA_NOT_FOUND", 404, "That image does not exist.", "এই ছবিটি নেই।", false, "{ media_id: string }"],
  ["MEDIA_SIGNATURE_INVALID", 422, "The upload link expired. Request a new one.", "আপলোড লিংকের সময় শেষ। নতুন লিংক নিন।", true, "{}"],
] as const satisfies readonly ErrorRow[];
