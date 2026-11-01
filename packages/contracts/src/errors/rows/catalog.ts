/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Menu and vendor availability. These are the codes that turn a browse failure into a useful sentence ("sold out", "closed until 11:00") instead of an empty screen; the customer app maps each to one of the 44 empty states.
 */
import type { ErrorRow } from "../types.ts";

/**
 * 17 definitions. One row is one code: `[code, status, en, bn, retryable, details]`.
 * The tuple is short on purpose — six fields across 17 codes in an object literal would
 * push this file past the 700-line cap and bury the copy that translators edit.
 */
export const CATALOG_ROWS = [
  ["CATALOG_VENDOR_NOT_FOUND", 404, "That vendor does not exist.", "এই ভেন্ডরটি নেই।", false, "{ vendor_id: string }"],
  ["CATALOG_VENDOR_CLOSED", 409, "This vendor is closed right now.", "এই ভেন্ডরটি এখন বন্ধ।", true, "{ next_open_at: string }"],
  ["CATALOG_VENDOR_PAUSED", 409, "This vendor has paused new orders.", "এই ভেন্ডরটি নতুন অর্ডার বন্ধ রেখেছে।", true, "{ resumes_at: string }"],
  ["CATALOG_VENDOR_NOT_VERIFIED", 409, "This vendor is not verified yet.", "এই ভেন্ডরটি এখনও যাচাই হয়নি।", false, "{}"],
  ["CATALOG_VENDOR_MAX_ORDERS", 409, "This vendor has too many orders in progress.", "এই ভেন্ডরের চলমান অর্ডার অনেক বেশি।", true, "{ capacity: number }"],
  ["CATALOG_OUTSIDE_RADIUS", 422, "This vendor does not deliver to that address.", "এই ভেন্ডরটি ওই ঠিকানায় ডেলিভারি দেয় না।", false, "{ radius_m: number, distance_m: number }"],
  ["CATALOG_OUTSIDE_ZONE", 422, "That address is outside the live zones.", "এই ঠিকানাটি চালু জোনের বাইরে।", false, "{}"],
  ["CATALOG_ITEM_NOT_FOUND", 404, "That item is no longer on the menu.", "এই আইটেমটি এখন মেনুতে নেই।", false, "{ item_id: string }"],
  ["CATALOG_ITEM_SOLD_OUT", 409, "This item is sold out.", "এই আইটেমটি শেষ।", true, "{ item_id: string }"],
  ["CATALOG_ITEM_UNAVAILABLE", 409, "This item is unavailable right now.", "এই আইটেমটি এখন পাওয়া যাচ্ছে না।", true, "{ item_id: string, until?: string }"],
  ["CATALOG_ITEM_HIDDEN", 409, "This item is not available for delivery.", "এই আইটেমটি ডেলিভারির জন্য নেই।", false, "{ item_id: string }"],
  ["CATALOG_ITEM_VARIANT_INVALID", 422, "Choose a valid size or variant.", "সঠিক সাইজ বা ধরন বেছে নিন।", false, "{ item_id: string, allowed: string[] }"],
  ["CATALOG_ITEM_OPTION_INVALID", 422, "One of the chosen options is not available.", "বেছে নেওয়া একটি অপশন নেই।", false, "{ option_id: string }"],
  ["CATALOG_ITEM_QTY_INVALID", 422, "That quantity is not allowed.", "এই পরিমাণ গ্রহণযোগ্য নয়।", false, "{ item_id: string, min: number, max: number }"],
  ["CATALOG_MENU_EMPTY", 409, "This vendor has no items available.", "এই ভেন্ডরের কোনো আইটেম নেই।", false, "{ vendor_id: string }"],
  ["CATALOG_CATEGORY_NOT_FOUND", 404, "That menu category does not exist.", "এই মেনু ক্যাটাগরিটি নেই।", false, "{ category_id: string }"],
  ["CATALOG_HOURS_UNAVAILABLE", 409, "This vendor has no opening hours set.", "এই ভেন্ডরের খোলার সময় নির্ধারিত নেই।", false, "{ vendor_id: string }"],
] as const satisfies readonly ErrorRow[];
