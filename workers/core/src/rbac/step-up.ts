/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { PermissionKey } from "./keys.ts";

/**
 * The 23 actions that require a TOTP code entered within the last five minutes.
 *
 * Step-up is the difference between "this admin is logged in" and "this admin is at
 * the keyboard right now", and it is the only control that survives a stolen admin
 * session. The list is a set of permission keys rather than a set of routes so that
 * a route added later with one of these keys inherits the requirement automatically —
 * a route-level list would have to be remembered.
 */

/** How long a step-up approval remains valid, in milliseconds. */
export const STEP_UP_WINDOW_MS = 5 * 60_000;

/** The actions the specification names, in its order, mapped to their keys. */
export const STEP_UP_KEYS: readonly PermissionKey[] = [
  "finance.payout.mark_paid",
  "finance.invoice.void",
  "finance.ledger.adjust",
  "support.credit.issue",
  "admin.role.edit",
  "admin.user.create",
  "admin.user.delete",
  "analytics.export.personal_data",
  "kyc.document.view_nid_front",
  "order.force_cancel",
  "brain.weights.edit",
  "pricing.matrix.update",
  "zone.polygon.update",
  "vendor.unsuspend",
  "rider.unsuspend",
  "finance.cash.write_off",
  "finance.payout.change_bank_account",
  "support.notification.bulk_send",
  "vendor.delete",
  "finance.cash.approve_settlement",
  "admin.security.break_glass",
  "vendor.impersonate",
  "support.exception.configure_trigger",
];

/** How many actions the list holds; the specification says twenty-three. */
export const STEP_UP_COUNT = 23;

if (STEP_UP_KEYS.length !== STEP_UP_COUNT) {
  throw new Error(`step-up list holds ${STEP_UP_KEYS.length} keys, expected ${STEP_UP_COUNT}`);
}

const STEP_UP_SET: ReadonlySet<string> = new Set(STEP_UP_KEYS);

/** Whether an action needs a fresh TOTP code. */
export function requiresStepUp(key: PermissionKey): boolean {
  return STEP_UP_SET.has(key);
}

/**
 * Whether the principal proved themselves recently enough.
 *
 * An absent timestamp is not "recent": a session created before this deployment has
 * no step-up record, and treating that as valid would let every existing admin skip
 * the control once.
 */
export function stepUpFresh(verifiedAtMs: number | null, nowMs: number = Date.now()): boolean {
  if (verifiedAtMs === null) return false;
  const age = nowMs - verifiedAtMs;
  return age >= 0 && age <= STEP_UP_WINDOW_MS;
}
