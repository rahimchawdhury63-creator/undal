/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Authorisation failures — the caller is who they say they are, but is not allowed. Kept separate from AUTH_ so clients can branch on `status === 403 && code.startsWith("PERM_")` to mean "ask an admin" rather than "ask the user to sign in again".
 */
import type { ErrorRow } from "../types.ts";

/**
 * 8 definitions. One row is one code: `[code, status, en, bn, retryable, details]`.
 * The tuple is short on purpose — six fields across 8 codes in an object literal would
 * push this file past the 700-line cap and bury the copy that translators edit.
 */
export const PERM_ROWS = [
  ["PERM_DENIED", 403, "You do not have permission to do this.", "এটি করার অনুমতি আপনার নেই।", false, "{ permission: string }"],
  ["PERM_ZONE_OUT_OF_SCOPE", 403, "This request is outside your zone.", "এই অনুরোধ আপনার জোনের বাইরে।", false, "{ zone_id: string }"],
  ["PERM_ROLE_EXPIRED", 403, "Your role assignment has ended.", "আপনার দায়িত্বের মেয়াদ শেষ হয়েছে।", false, "{ ended_at: string }"],
  ["PERM_STEP_UP_REQUIRED", 428, "Confirm your identity to continue.", "চালিয়ে যেতে আপনার পরিচয় নিশ্চিত করুন।", false, "{ method: string }"],
  ["PERM_TENANT_MISMATCH", 403, "This record belongs to another vendor.", "এই রেকর্ডটি অন্য ভেন্ডরের।", false, "{}"],
  ["PERM_SCOPE_INSUFFICIENT", 403, "Your scope does not cover this action.", "আপনার অনুমতির পরিসর এই কাজটি কভার করে না।", false, "{ required_scope: string }"],
  ["PERM_IMPERSONATION_READONLY", 403, "Impersonation sessions cannot make changes.", "প্রতিনিধিত্ব সেশন থেকে পরিবর্তন করা যায় না।", false, "{}"],
  ["PERM_ACCOUNT_DISABLED", 403, "This account is disabled.", "এই অ্যাকাউন্ট নিষ্ক্রিয় আছে।", false, "{}"],
] as const satisfies readonly ErrorRow[];
