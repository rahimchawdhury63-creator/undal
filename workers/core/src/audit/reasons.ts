/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { STEP_UP_KEYS } from "../rbac/step-up.ts";
import type { PermissionKey } from "../rbac/keys.ts";

/**
 * The reason codes a mutating action must carry, and the reason they exist.
 *
 * A free-text reason is a paragraph nobody reads six months later. A closed list is
 * something the audit list can group by, the exception tower can chart, and a support agent
 * can filter — "how many force-cancels were `VENDOR_UNREACHABLE` last week" is a question
 * with an answer only if the reasons are enumerable.
 *
 * The register is the 23 step-up actions plus the settlement, cancellation and dispute
 * causes the specification names. Every code below maps to a permission key it is allowed
 * to accompany, so a route cannot record `CUSTOMER_REQUESTED` on a payout.
 */

/** One approved reason: what it means, and which actions it may justify. */
export interface ReasonCode {
  readonly code: string;
  readonly labelEn: string;
  readonly labelBn: string;
  /** The keys this reason is valid for; an empty list means any key in its domain. */
  readonly appliesTo: readonly PermissionKey[];
}

/** Reasons that apply to every step-up action, because the cause is human either way. */
const OPERATIONAL: readonly ReasonCode[] = [
  { code: "CUSTOMER_REQUESTED", labelEn: "Customer requested it", labelBn: "গ্রাহক অনুরোধ করেছেন", appliesTo: [] },
  { code: "OPERATOR_ERROR", labelEn: "Operator error being corrected", labelBn: "অপারেটরের ভুল সংশোধন", appliesTo: [] },
  { code: "SYSTEM_RECONCILIATION", labelEn: "System reconciliation", labelBn: "সিস্টেম মিলকরণ", appliesTo: [] },
  { code: "DUPLICATE_POSTING", labelEn: "Duplicate posting reversal", labelBn: "ডুপ্লিকেট পোস্টিং বাতিল", appliesTo: [] },
  { code: "LEGAL_REQUEST", labelEn: "Legal or regulatory request", labelBn: "আইনি বা নিয়ন্ত্রক অনুরোধ", appliesTo: [] },
  { code: "FRAUD_INVESTIGATION", labelEn: "Fraud investigation", labelBn: "প্রতারণা তদন্ত", appliesTo: [] },
];

/** Reasons specific to one action, keyed to it so the audit row cannot be nonsense. */
const SPECIFIC: readonly ReasonCode[] = [
  { code: "BKASH_TRANSFER_CONFIRMED", labelEn: "bKash transfer confirmed", labelBn: "বিকাশ ট্রান্সফার নিশ্চিত", appliesTo: ["finance.payout.mark_paid"] },
  { code: "BANK_TRANSFER_CONFIRMED", labelEn: "Bank transfer confirmed", labelBn: "ব্যাংক ট্রান্সফার নিশ্চিত", appliesTo: ["finance.payout.mark_paid"] },
  { code: "CASH_HANDOVER_CONFIRMED", labelEn: "Cash handover confirmed", labelBn: "নগদ হস্তান্তর নিশ্চিত", appliesTo: ["finance.payout.mark_paid"] },
  { code: "INVOICE_WRONG_PERIOD", labelEn: "Invoice raised in the wrong period", labelBn: "ভুল সময়ের ইনভয়েস", appliesTo: ["finance.invoice.void"] },
  { code: "INVOICE_WRONG_PARTY", labelEn: "Invoice billed to the wrong party", labelBn: "ভুল পক্ষকে ইনভয়েস", appliesTo: ["finance.invoice.void"] },
  { code: "INVOICE_DUPLICATE", labelEn: "Duplicate invoice", labelBn: "ডুপ্লিকেট ইনভয়েস", appliesTo: ["finance.invoice.void"] },
  { code: "MANUAL_LEDGER", labelEn: "Manual ledger adjustment", labelBn: "ম্যানুয়াল লেজার সমন্বয়", appliesTo: ["finance.ledger.adjust"] },
  { code: "GOODWILL_CREDIT", labelEn: "Goodwill credit", labelBn: "শুভেচ্ছা ক্রেডিট", appliesTo: ["support.credit.issue"] },
  { code: "COMPLAINT_UPHELD", labelEn: "Complaint upheld", labelBn: "অভিযোগ গৃহীত", appliesTo: ["support.credit.issue", "order.refund"] },
  { code: "VENDOR_UNREACHABLE", labelEn: "Vendor unreachable", labelBn: "ভেন্ডরের সাথে যোগাযোগ হয়নি", appliesTo: ["order.force_cancel", "order.cancel"] },
  { code: "RIDER_EMERGENCY", labelEn: "Rider emergency", labelBn: "রাইডারের জরুরি অবস্থা", appliesTo: ["order.force_cancel", "order.reassign" as PermissionKey] },
  { code: "ZONE_UNSAFE", labelEn: "Zone unsafe to deliver", labelBn: "এলাকা নিরাপদ নয়", appliesTo: ["order.force_cancel", "zone.deactivate"] },
  { code: "VEHICLE_UNAVAILABLE", labelEn: "No vehicle available", labelBn: "কোনো যানবাহন নেই", appliesTo: ["order.force_cancel"] },
  { code: "WEATHER_EMERGENCY", labelEn: "Weather emergency", labelBn: "আবহাওয়ার জরুরি অবস্থা", appliesTo: ["order.force_cancel", "zone.deactivate"] },
  { code: "CASH_NOT_HANDED_OVER", labelEn: "Rider did not hand over cash", labelBn: "রাইডার নগদ জমা দেয়নি", appliesTo: ["finance.cash.write_off", "finance.cash.approve_settlement"] },
  { code: "CASH_COUNTED_SHORT", labelEn: "Cash counted short", labelBn: "নগদ কম গণনা হয়েছে", appliesTo: ["finance.cash.approve_settlement", "finance.cash.reject_settlement"] },
  { code: "SETTLEMENT_DISPUTED", labelEn: "Settlement disputed", labelBn: "নিষ্পত্তি বিতর্কিত", appliesTo: ["finance.cash.reject_settlement"] },
  { code: "BANK_ACCOUNT_CORRECTION", labelEn: "Bank account correction", labelBn: "ব্যাংক অ্যাকাউন্ট সংশোধন", appliesTo: ["finance.payout.change_bank_account"] },
  { code: "NID_DISPUTED", labelEn: "NID disputed", labelBn: "এনআইডি বিতর্কিত", appliesTo: ["kyc.document.view_nid_front", "kyc.document.view_nid_back"] },
  { code: "SUSPICIOUS_DOCUMENT", labelEn: "Suspicious document", labelBn: "সন্দেহজনক নথি", appliesTo: ["kyc.decision.override", "vendor.suspend", "rider.suspend"] },
  { code: "COMPLIANCE_REQUEST", labelEn: "Compliance request", labelBn: "কমপ্লায়েন্স অনুরোধ", appliesTo: ["analytics.export.personal_data"] },
  { code: "SUBJECT_ACCESS_REQUEST", labelEn: "Data subject access request", labelBn: "তথ্য বিষয়কের অনুরোধ", appliesTo: ["analytics.export.personal_data", "customer.export_personal_data"] },
  { code: "ROLE_CHANGE_APPROVED", labelEn: "Role change approved", labelBn: "রোল পরিবর্তন অনুমোদিত", appliesTo: ["admin.role.edit", "admin.role.assign"] },
  { code: "NEW_STAFF_MEMBER", labelEn: "New staff member", labelBn: "নতুন কর্মী", appliesTo: ["admin.user.create"] },
  { code: "STAFF_LEFT", labelEn: "Staff member left", labelBn: "কর্মী চলে গেছেন", appliesTo: ["admin.user.delete"] },
  { code: "BREAK_GLASS_INCIDENT", labelEn: "Break-glass incident", labelBn: "ব্রেক-গ্লাস ঘটনা", appliesTo: ["admin.security.break_glass"] },
  { code: "KEY_COMPROMISE", labelEn: "Key compromise", labelBn: "কী প্রকাশ", appliesTo: ["admin.security.rotate_qr_secret"] },
  { code: "PRICING_CORRECTION", labelEn: "Pricing correction", labelBn: "মূল্য সংশোধন", appliesTo: ["pricing.matrix.update", "pricing.matrix.rollback"] },
  { code: "ZONE_BOUNDARY_FIX", labelEn: "Zone boundary correction", labelBn: "এলাকার সীমানা সংশোধন", appliesTo: ["zone.polygon.update"] },
  { code: "MODEL_RETUNE_FROM_REPLAY", labelEn: "Brain retuned from a replay", labelBn: "রিপ্লে থেকে ব্রেইন টিউন", appliesTo: ["brain.weights.edit", "brain.weights.tune"] },
  { code: "BULK_NOTICE_APPROVED", labelEn: "Bulk notice approved", labelBn: "বাল্ক নোটিশ অনুমোদিত", appliesTo: ["support.notification.bulk_send"] },
  { code: "VENDOR_CLOSED", labelEn: "Vendor closed permanently", labelBn: "ভেন্ডর স্থায়ীভাবে বন্ধ", appliesTo: ["vendor.delete"] },
  { code: "EXCEPTION_FALSE_POSITIVE", labelEn: "Exception trigger was a false positive", labelBn: "ব্যতিক্রম ভুল সংকেত", appliesTo: ["support.exception.configure_trigger"] },
  { code: "IMPERSONATION_SUPPORT", labelEn: "Support impersonation", labelBn: "সাপোর্ট ছদ্মবেশ", appliesTo: ["vendor.impersonate", "rider.impersonate", "customer.export_personal_data"] },
];

/** The full register. */
export const REASON_CODES: readonly ReasonCode[] = [...OPERATIONAL, ...SPECIFIC];

/** How many reason codes exist. */
export const REASON_COUNT = REASON_CODES.length;

/**
 * Whether a reason is acceptable for an action.
 *
 * A code with an empty `appliesTo` is an operational reason and is valid anywhere; a code
 * with a list is valid only there. This is what stops a route recording
 * `BKASH_TRANSFER_CONFIRMED` on a customer's address change.
 */
export function reasonAllowed(code: string, key: PermissionKey): boolean {
  const entry = REASON_CODES.find((candidate) => candidate.code === code);
  if (entry === undefined) return false;
  if (entry.appliesTo.length === 0) return true;
  return entry.appliesTo.includes(key);
}

/** The codes a UI may offer for an action, in register order. */
export function reasonsFor(key: PermissionKey): ReasonCode[] {
  return REASON_CODES.filter((entry) => entry.appliesTo.length === 0 || entry.appliesTo.includes(key));
}

/**
 * Every step-up action must have at least one reason to choose.
 *
 * Asserted here rather than in a test alone, because a step-up action with no reasons is a
 * screen with an empty dropdown and a form that can never be submitted.
 */
export const UNREACHABLE_STEP_UP: readonly PermissionKey[] = STEP_UP_KEYS.filter((key) => reasonsFor(key).length === 0);

if (UNREACHABLE_STEP_UP.length > 0) {
  throw new Error(`step-up actions without a reason code: ${UNREACHABLE_STEP_UP.join(", ")}`);
}
