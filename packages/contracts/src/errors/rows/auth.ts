/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Authentication and session failures: the 21 codes the AUTH_ and OAUTH_ prefixes own. They live apart from PERM_ because a caller can fix every one of them by signing in again or waiting, whereas a permission failure needs a human to change a role.
 */
import type { ErrorRow } from "../types.ts";

/**
 * 21 definitions. One row is one code: `[code, status, en, bn, retryable, details]`.
 * The tuple is short on purpose — six fields across 21 codes in an object literal would
 * push this file past the 700-line cap and bury the copy that translators edit.
 */
export const AUTH_ROWS = [
  ["AUTH_INVALID_CREDENTIALS", 401, "Phone or password is incorrect.", "ফোন নম্বর বা পাসওয়ার্ড সঠিক নয়।", false, "{}"],
  ["AUTH_TOKEN_MISSING", 401, "Sign in to continue.", "চালিয়ে যেতে সাইন ইন করুন।", false, "{}"],
  ["AUTH_TOKEN_INVALID", 401, "The access token is not valid.", "অ্যাক্সেস টোকেন বৈধ নয়।", false, "{}"],
  ["AUTH_SESSION_EXPIRED", 401, "Your session has expired. Sign in again.", "আপনার সেশন শেষ হয়েছে। আবার সাইন ইন করুন।", true, "{}"],
  ["AUTH_REFRESH_REUSED", 401, "This session was already refreshed. All sessions were signed out.", "এই সেশন আগে নবায়ন হয়েছে। সব সেশন বন্ধ করা হয়েছে।", false, "{}"],
  ["AUTH_DEVICE_MISMATCH", 403, "This account is bound to another device.", "এই অ্যাকাউন্ট অন্য ডিভাইসে বাঁধা আছে।", false, "{}"],
  ["AUTH_LOCKED_OUT", 423, "Too many failed attempts. Try again later.", "অনেকবার ভুল হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।", true, "{ retry_after_seconds: number }"],
  ["AUTH_ACCOUNT_SUSPENDED", 451, "This account is suspended.", "এই অ্যাকাউন্ট স্থগিত আছে।", false, "{ reason: string }"],
  ["AUTH_ACCOUNT_PENDING", 403, "This account is waiting for approval.", "এই অ্যাকাউন্ট অনুমোদনের অপেক্ষায় আছে।", false, "{ submitted_at: string }"],
  ["AUTH_TOTP_REQUIRED", 401, "Enter your two-factor code to continue.", "চালিয়ে যেতে দুই ধাপের কোড দিন।", false, "{}"],
  ["AUTH_TOTP_INVALID", 401, "That two-factor code is not valid.", "এই দুই ধাপের কোডটি বৈধ নয়।", false, "{ attempts_remaining: number }"],
  ["AUTH_TOTP_RECOVERY_USED", 401, "That recovery code has already been used.", "এই রিকভারি কোড আগেই ব্যবহার হয়েছে।", false, "{}"],
  ["AUTH_PHONE_CHANGED", 409, "The phone number changed while you were signed in.", "সাইন ইন থাকার সময় ফোন নম্বর বদলেছে।", false, "{}"],
  ["AUTH_PASSWORD_WEAK", 422, "Choose a longer or less common password.", "আরও দীর্ঘ বা কম প্রচলিত পাসওয়ার্ড দিন।", false, "{ min_length: number }"],
  ["OAUTH_NOT_CONFIGURED", 503, "This sign-in provider is not available.", "এই সাইন-ইন মাধ্যমটি এখন উপলব্ধ নয়।", false, "{ provider: string }"],
  ["OAUTH_STATE_MISMATCH", 400, "The sign-in attempt could not be verified. Start again.", "সাইন-ইন যাচাই করা যায়নি। আবার শুরু করুন।", true, "{}"],
  ["OAUTH_EMAIL_UNVERIFIED", 403, "The provider has not verified this email address.", "প্রদানকারী এই ইমেইল যাচাই করেনি।", false, "{ provider: string }"],
  ["AUTH_ROLE_MISMATCH", 403, "This account cannot sign in to this app.", "এই অ্যাকাউন্ট দিয়ে এই অ্যাপে সাইন ইন করা যায় না।", false, "{ expected: string }"],
  ["AUTH_PIN_SETUP_REQUIRED", 428, "Set a PIN before continuing.", "চালিয়ে যাওয়ার আগে পিন সেট করুন।", false, "{}"],
  ["AUTH_PIN_INVALID", 401, "That PIN is not correct.", "এই পিনটি সঠিক নয়।", false, "{ attempts_remaining: number }"],
  ["AUTH_ANONYMOUS_NOT_ALLOWED", 403, "Sign in to do this.", "এটি করতে সাইন ইন করুন।", false, "{}"],
] as const satisfies readonly ErrorRow[];
