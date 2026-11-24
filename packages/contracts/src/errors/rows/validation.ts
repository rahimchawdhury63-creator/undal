/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Malformed input. Every one of these is payable-to-fix by the client, so the envelope carries the failing field path and the message key — never a stack, never a database detail.
 */
import type { ErrorRow } from "../types.ts";

/**
 * 14 definitions. One row is one code: `[code, status, en, bn, retryable, details]`.
 * The tuple is short on purpose — six fields across 14 codes in an object literal would
 * push this file past the 700-line cap and bury the copy that translators edit.
 */
export const VALIDATION_ROWS = [
  ["VALIDATION_FAILED", 422, "Some fields need attention.", "কিছু তথ্য ঠিক করতে হবে।", false, "{ fields: { path: string, message_key: string }[] }"],
  ["VALIDATION_REQUIRED", 422, "A required field is missing.", "একটি প্রয়োজনীয় তথ্য দেওয়া হয়নি।", false, "{ field: string }"],
  ["VALIDATION_PHONE_INVALID", 422, "Enter a valid Bangladeshi mobile number.", "সঠিক বাংলাদেশি মোবাইল নম্বর দিন।", false, "{ field: string }"],
  ["VALIDATION_EMAIL_INVALID", 422, "Enter a valid email address.", "সঠিক ইমেইল ঠিকানা দিন।", false, "{ field: string }"],
  ["VALIDATION_COORDINATES_INVALID", 422, "That location is not usable.", "এই অবস্থানটি ব্যবহার করা যাচ্ছে না।", false, "{ lat_e7: number, lon_e7: number }"],
  ["VALIDATION_RANGE", 422, "That value is outside the allowed range.", "এই মানটি অনুমোদিত সীমার বাইরে।", false, "{ field: string, min: number, max: number }"],
  ["VALIDATION_ENUM", 422, "Choose one of the listed options.", "তালিকার একটি অপশন বেছে নিন।", false, "{ field: string, allowed: string[] }"],
  ["VALIDATION_TOO_LONG", 422, "That text is too long.", "এই লেখাটি বেশি বড়।", false, "{ field: string, max_length: number }"],
  ["VALIDATION_TOO_SHORT", 422, "That text is too short.", "এই লেখাটি বেশি ছোট।", false, "{ field: string, min_length: number }"],
  ["VALIDATION_JSON_INVALID", 400, "The request body is not valid JSON.", "অনুরোধের বডি বৈধ JSON নয়।", false, "{ path?: string }"],
  ["VALIDATION_ID_MALFORMED", 422, "That identifier is not valid.", "এই আইডেন্টিফায়ারটি বৈধ নয়।", false, "{ field: string }"],
  ["VALIDATION_DATE_IN_PAST", 422, "That date has already passed.", "এই তারিখ পেরিয়ে গেছে।", false, "{ field: string }"],
  ["VALIDATION_CURRENCY_MISMATCH", 422, "Amounts must be in Bangladeshi taka.", "টাকার পরিমাণ বাংলাদেশি টাকায় হতে হবে।", false, "{ expected: string, received: string }"],
  ["VALIDATION_UNSUPPORTED_LOCALE", 422, "That language is not supported.", "এই ভাষাটি সমর্থিত নয়।", false, "{ allowed: string[] }"],
] as const satisfies readonly ErrorRow[];
