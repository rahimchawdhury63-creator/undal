/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Order lifecycle refusals. The largest group, because with 21 legal transitions almost every transition has a way to arrive too late; the guard that rejects it names the reason here rather than returning a generic 409.
 */
import type { ErrorRow } from "../types.ts";

/**
 * 31 definitions. One row is one code: `[code, status, en, bn, retryable, details]`.
 * The tuple is short on purpose — six fields across 31 codes in an object literal would
 * push this file past the 700-line cap and bury the copy that translators edit.
 */
export const ORDER_ROWS = [
  ["ORDER_NOT_FOUND", 404, "That order does not exist.", "এই অর্ডারটি নেই।", false, "{ order_id: string }"],
  ["ORDER_NOT_ACCEPTABLE", 409, "This order can no longer be accepted.", "এই অর্ডারটি আর গ্রহণ করা যাবে না।", false, "{ state: string }"],
  ["ORDER_ALREADY_ACCEPTED", 409, "This order was already accepted.", "এই অর্ডারটি আগেই গ্রহণ করা হয়েছে।", false, "{ accepted_at: string }"],
  ["ORDER_ALREADY_COMPLETED", 409, "This order is already finished.", "এই অর্ডারটি আগেই শেষ হয়েছে।", false, "{ state: string }"],
  ["ORDER_ALREADY_CANCELLED", 409, "This order was already cancelled.", "এই অর্ডারটি আগেই বাতিল হয়েছে।", false, "{ cancelled_at: string }"],
  ["ORDER_CANNOT_CANCEL", 409, "This order cannot be cancelled now.", "এই অর্ডারটি এখন বাতিল করা যায় না।", false, "{ state: string }"],
  ["ORDER_NOT_YOURS", 403, "This order belongs to another vendor or rider.", "এই অর্ডারটি অন্য ভেন্ডর বা রাইডারের।", false, "{}"],
  ["ORDER_PREP_TIME_OUT_OF_RANGE", 422, "Choose a preparation time between 5 and 90 minutes.", "৫ থেকে ৯০ মিনিটের মধ্যে প্রস্তুতির সময় দিন।", false, "{ min_minutes: number, max_minutes: number }"],
  ["ORDER_ITEMS_EMPTY", 422, "Add at least one item.", "কমপক্ষে একটি আইটেম যোগ করুন।", false, "{}"],
  ["ORDER_ITEMS_CHANGED", 409, "The cart changed. Review it before ordering.", "কার্ট বদলেছে। অর্ডারের আগে দেখুন।", true, "{}"],
  ["ORDER_PRICE_CHANGED", 409, "An item's price changed. Review the total.", "কোনো আইটেমের দাম বদলেছে। মোট দেখুন।", true, "{ item_id: string }"],
  ["ORDER_TOTAL_CHANGED", 409, "The order total changed. Confirm the new amount.", "অর্ডারের মোট বদলেছে। নতুন পরিমাণ নিশ্চিত করুন।", true, "{ expected_total: number, actual_total: number }"],
  ["ORDER_ADDRESS_TOO_FAR", 422, "That address is beyond this vendor's delivery range.", "ঠিকানাটি ভেন্ডরের ডেলিভারি সীমার বাইরে।", false, "{ distance_m: number, max_m: number }"],
  ["ORDER_SCHEDULED_TOO_SOON", 422, "Pick a later time — the vendor needs more notice.", "পরের সময় বেছে নিন — ভেন্ডরের আরও সময় দরকার।", false, "{ earliest_at: string }"],
  ["ORDER_SCHEDULED_TOO_LATE", 422, "Pick an earlier time — that is too far ahead.", "আগের সময় বেছে নিন — এটি অনেক দূরের।", false, "{ latest_at: string }"],
  ["ORDER_SCHEDULED_SLOT_FULL", 409, "That time slot is full. Choose another.", "এই সময়টি পূর্ণ। অন্য সময় বেছে নিন।", true, "{ slot: string }"],
  ["ORDER_REJECT_REASON_REQUIRED", 422, "Choose a reason for rejecting this order.", "অর্ডার প্রত্যাখ্যানের কারণ বেছে নিন।", false, "{ allowed: string[] }"],
  ["ORDER_REJECT_NOT_ALLOWED", 409, "This order can no longer be rejected.", "এই অর্ডারটি আর প্রত্যাখ্যান করা যাবে না।", false, "{ state: string }"],
  ["ORDER_CUSTOMER_UNREACHABLE", 409, "The customer could not be reached.", "গ্রাহকের সাথে যোগাযোগ করা যায়নি।", true, "{ attempts: number }"],
  ["ORDER_DUPLICATE", 409, "You just placed this order.", "আপনি এইমাত্র এই অর্ডারটি দিয়েছেন।", false, "{ order_id: string }"],
  ["ORDER_LOCKED", 409, "This order is being updated. Try again.", "এই অর্ডারটি এখন হালনাগাদ হচ্ছে। আবার চেষ্টা করুন।", true, "{ retry_after_seconds: number }"],
  ["ORDER_TIMEOUT", 409, "This action took too long and was cancelled.", "এই কাজটি সময়ের বেশি নিয়েছিল, বাতিল হয়েছে।", true, "{}"],
  ["ORDER_AWAITING_PICKUP", 409, "The rider has not reached the vendor yet.", "রাইডার এখনও ভেন্ডরে পৌঁছাননি।", true, "{}"],
  ["ORDER_NOT_PICKED_UP", 409, "Mark the order picked up first.", "আগে অর্ডারটি পিকআপ হিসেবে চিহ্নিত করুন।", false, "{}"],
  ["ORDER_ALREADY_PICKED_UP", 409, "This order was already picked up.", "এই অর্ডারটি আগেই পিকআপ হয়েছে।", false, "{ picked_up_at: string }"],
  ["ORDER_RIDER_ASSIGNED", 409, "A rider is already assigned to this order.", "এই অর্ডারে একজন রাইডার আগেই নির্ধারিত।", false, "{ rider_id: string }"],
  ["ORDER_NO_RIDER", 409, "No rider accepted this order yet.", "এখনও কোনো রাইডার এই অর্ডার নেননি।", true, "{}"],
  ["ORDER_OFFLINE_SHIFT_CLOSED", 409, "Your shift ended. Open a new shift to deliver.", "আপনার শিফট শেষ। ডেলিভারি দিতে নতুন শিফট খুলুন।", false, "{}"],
  ["ORDER_DELIVERY_CODE_INVALID", 422, "That delivery code is not correct.", "এই ডেলিভারি কোডটি সঠিক নয়।", false, "{ attempts_remaining: number }"],
  ["ORDER_RATING_WINDOW_CLOSED", 409, "The time to rate this order has passed.", "এই অর্ডার রেটিং দেওয়ার সময় শেষ।", false, "{}"],
  ["ORDER_REFUND_PENDING", 409, "A refund for this order is still being processed.", "এই অর্ডারের রিফান্ড এখনও প্রক্রিয়াধীন।", true, "{ refund_id: string }"],
] as const satisfies readonly ErrorRow[];
