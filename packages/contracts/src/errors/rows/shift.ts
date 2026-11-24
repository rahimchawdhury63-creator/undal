/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Rider shift failures. A rider cannot deliver without an open shift, cleared cash and approved papers, and each blocker is named so the app can deep-link the rider to the exact screen that unblocks them.
 */
import type { ErrorRow } from "../types.ts";

/**
 * 13 definitions. One row is one code: `[code, status, en, bn, retryable, details]`.
 * The tuple is short on purpose — six fields across 13 codes in an object literal would
 * push this file past the 700-line cap and bury the copy that translators edit.
 */
export const SHIFT_ROWS = [
  ["SHIFT_NOT_FOUND", 404, "You have no open shift.", "আপনার কোনো চলমান শিফট নেই।", false, "{}"],
  ["SHIFT_ALREADY_OPEN", 409, "You already have an open shift.", "আপনার একটি শিফট চলছে।", false, "{ shift_id: string }"],
  ["SHIFT_NOT_OPEN", 409, "Open a shift before going online.", "অনলাইনে যাওয়ার আগে শিফট খুলুন।", false, "{}"],
  ["SHIFT_SELFIE_REQUIRED", 422, "Take a selfie to start your shift.", "শিফট শুরু করতে সেলফি তুলুন।", false, "{}"],
  ["SHIFT_CASH_OVERDUE", 409, "Settle yesterday's cash before starting.", "শুরু করার আগে গতকালের নগদ জমা দিন।", false, "{ outstanding: number, due_at: string }"],
  ["SHIFT_ZONE_INACTIVE", 409, "That zone is not running deliveries now.", "এই জোনে এখন ডেলিভারি চলছে না।", true, "{ zone_id: string }"],
  ["SHIFT_ZONE_NOT_ASSIGNED", 409, "You are not assigned to that zone.", "আপনি এই জোনে নির্ধারিত নন।", false, "{ zone_id: string }"],
  ["SHIFT_VEHICLE_NOT_APPROVED", 409, "Your vehicle type is not approved yet.", "আপনার যানের ধরন এখনও অনুমোদিত হয়নি।", false, "{ vehicle_type: string }"],
  ["SHIFT_KYC_PENDING", 409, "Finish identity verification to start shifts.", "শিফট শুরু করতে পরিচয় যাচাই শেষ করুন।", false, "{}"],
  ["SHIFT_CLOSING_CHECKLIST_INCOMPLETE", 422, "Complete the cash handover checklist.", "নগদ হস্তান্তরের চেকলিস্ট সম্পূর্ণ করুন।", false, "{ missing: string[] }"],
  ["SHIFT_HANDOVER_PENDING", 409, "A cash handover is waiting for confirmation.", "একটি নগদ হস্তান্তর নিশ্চিত হওয়ার অপেক্ষায়।", true, "{ handover_id: string }"],
  ["SHIFT_ALREADY_CLOSED", 409, "This shift is already closed.", "এই শিফট আগেই বন্ধ হয়েছে।", false, "{ closed_at: string }"],
  ["SHIFT_ORDERS_ACTIVE", 409, "Finish your deliveries before ending your shift.", "শিফট শেষ করার আগে ডেলিভারিগুলো শেষ করুন।", false, "{ active_orders: number }"],
] as const satisfies readonly ErrorRow[];
