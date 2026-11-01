/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Pickup-code failures. The QR handshake is the only proof a rider collected the right parcel, so each way it can fail is separately named and separately logged.
 */
import type { ErrorRow } from "../types.ts";

/**
 * 6 definitions. One row is one code: `[code, status, en, bn, retryable, details]`.
 * The tuple is short on purpose — six fields across 6 codes in an object literal would
 * push this file past the 700-line cap and bury the copy that translators edit.
 */
export const QR_ROWS = [
  ["QR_INVALID", 422, "This QR code could not be read.", "এই QR কোডটি পড়া যায়নি।", true, "{}"],
  ["QR_WRONG_ORDER", 409, "This code belongs to a different order.", "এই কোডটি অন্য অর্ডারের।", false, "{}"],
  ["QR_EXPIRED", 410, "This pickup code expired. Ask the vendor to show the current one.", "এই পিকআপ কোডের সময় শেষ। ভেন্ডরকে বর্তমান কোড দেখাতে বলুন।", true, "{ expires_at: string }"],
  ["QR_TOO_FAR", 422, "Move closer to the vendor to scan.", "স্ক্যান করতে ভেন্ডরের কাছে যান।", true, "{ distance_m: number, max_m: number }"],
  ["QR_WRONG_RIDER", 403, "This pickup code is for another rider.", "এই পিকআপ কোডটি অন্য রাইডারের জন্য।", false, "{}"],
  ["QR_ALREADY_SCANNED", 409, "This pickup was already confirmed.", "এই পিকআপ আগেই নিশ্চিত হয়েছে।", false, "{ picked_up_at: string }"],
] as const satisfies readonly ErrorRow[];
