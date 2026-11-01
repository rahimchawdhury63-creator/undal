/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { ADMIN_KEYS } from "./keys/admin.ts";
import { ANALYTICS_KEYS } from "./keys/analytics.ts";
import { BRAIN_KEYS } from "./keys/brain.ts";
import { CATALOGUE_KEYS } from "./keys/catalogue.ts";
import { CUSTOMER_KEYS } from "./keys/customer.ts";
import { DISPATCH_KEYS } from "./keys/dispatch.ts";
import { FINANCE_KEYS } from "./keys/finance.ts";
import { KYC_KEYS } from "./keys/kyc.ts";
import { ORDER_KEYS } from "./keys/order.ts";
import { PRICING_KEYS } from "./keys/pricing.ts";
import { PROMO_KEYS } from "./keys/promo.ts";
import { RIDER_KEYS } from "./keys/rider.ts";
import { SUPPORT_KEYS } from "./keys/support.ts";
import { VENDOR_KEYS } from "./keys/vendor.ts";
import { ZONE_KEYS } from "./keys/zone.ts";

/**
 * The permission register: 412 keys, the same number the specification names, and
 * the count is asserted at module load.
 *
 * The assertion is deliberate. A register that is silently 411 fails in the worst
 * possible way — the missing permission is one nobody can grant, so the feature it
 * guards is unreachable and the bug reads as a UI problem.
 */
export const ALL_PERMISSION_KEYS = [
  ...ORDER_KEYS,
  ...DISPATCH_KEYS,
  ...CATALOGUE_KEYS,
  ...FINANCE_KEYS,
  ...VENDOR_KEYS,
  ...RIDER_KEYS,
  ...CUSTOMER_KEYS,
  ...SUPPORT_KEYS,
  ...KYC_KEYS,
  ...ZONE_KEYS,
  ...PRICING_KEYS,
  ...PROMO_KEYS,
  ...ANALYTICS_KEYS,
  ...BRAIN_KEYS,
  ...ADMIN_KEYS,
] as const;

/** One of the 412 keys. */
export type PermissionKey = (typeof ALL_PERMISSION_KEYS)[number];

/** The documented size of the register. */
export const PERMISSION_COUNT = 412;

if (ALL_PERMISSION_KEYS.length !== PERMISSION_COUNT) {
  throw new Error(`permission register holds ${ALL_PERMISSION_KEYS.length} keys, expected ${PERMISSION_COUNT}`);
}

const KEY_SET: ReadonlySet<string> = new Set(ALL_PERMISSION_KEYS);

/** Whether a string is a key in the register — the check a route loader needs. */
export function isPermissionKey(value: string): value is PermissionKey {
  return KEY_SET.has(value);
}

/** How much damage the key can do, which decides who may hold it and what it costs. */
export type PermissionRisk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** Actions that move money or destroy records, whatever resource they hang off. */
const CRITICAL_ACTIONS: readonly string[] = [
  "write_off",
  "mark_paid",
  "void",
  "reverse",
  "force_assign",
  "force_cancel",
  "force_transition",
  "break_glass",
  "rotate_qr_secret",
  "impersonate",
  "delete",
  "suspend",
  "unsuspend",
  "edit",
  "approve",
  "adjust",
  "override",
  "export_personal_data",
  "personal_data",
  "view_nid_front",
  "view_nid_back",
  "change_bank_account",
];

/** Actions that write but do not move money. */
const HIGH_ACTIONS: readonly string[] = [
  "create",
  "update",
  "set_price",
  "set_commission",
  "settle",
  "issue",
  "refund",
  "send",
  "bulk_send",
  "assign",
  "reassign",
  "publish",
  "rollback",
  "resolve",
  "configure",
  "configure_trigger",
  "release",
  "claim",
  "verify",
  "close_period",
  "reconcile",
];

/**
 * Classify a key by its action, which is what the risk column of `permissions` stores.
 *
 * Derived rather than hand-tagged: 412 hand-written risk labels are 412 chances to
 * mark `finance.payout.mark_paid` as MEDIUM, and the classification is genuinely a
 * property of the verb.
 */
export function riskOf(key: PermissionKey): PermissionRisk {
  const action = key.slice(key.lastIndexOf(".") + 1);
  if (CRITICAL_ACTIONS.includes(action)) return "CRITICAL";
  if (HIGH_ACTIONS.includes(action)) return "HIGH";
  if (action.startsWith("read") || action.startsWith("list") || action.startsWith("view")) return "LOW";
  if (action.startsWith("export") || action.startsWith("download")) return "MEDIUM";
  return "MEDIUM";
}

/** The domain a key belongs to: its first segment. */
export function domainOf(key: PermissionKey): string {
  return key.slice(0, key.indexOf("."));
}

/** The keys whose domain is `domain`, for the role editor's grouped view. */
export function keysInDomain(domain: string): PermissionKey[] {
  return ALL_PERMISSION_KEYS.filter((key) => domainOf(key) === domain);
}
