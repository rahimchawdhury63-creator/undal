/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { ErrorCode } from "@undal/contracts";

import type { PermissionKey } from "./keys.ts";
import { roleAllows } from "./roles.ts";
import { requiresStepUp, stepUpFresh } from "./step-up.ts";

/**
 * The authorisation decision, as a value rather than an exception.
 *
 * A guard that throws has to be caught by every caller, and the one caller that
 * forgets turns a 403 into a 500 — which reads like an outage. Returning the denial
 * means the pipeline decides the status and the route cannot accidentally swallow it.
 */

/** Who is calling, once the token has been verified. */
export interface Principal {
  readonly userId: string;
  /** `CUSTOMER`, `VENDOR_OWNER`, `RIDER` or `ADMIN`, matching the `users` column. */
  readonly actorType: "CUSTOMER" | "VENDOR_OWNER" | "RIDER" | "ADMIN";
  /** The system role for an admin, `null` for everybody else. */
  readonly role: string | null;
  readonly sessionId: string;
  readonly deviceId: string;
  /** Zones this principal is limited to; `null` means no limit. */
  readonly zoneScope: readonly string[] | null;
  /** When TOTP was last entered for this session, or `null` if never. */
  readonly stepUpAtMs: number | null;
  /** Whether this session is an admin impersonating somebody, which is read-only. */
  readonly impersonating: boolean;
}

/** What a route demands of its caller. */
export interface Requirement {
  readonly permission: PermissionKey;
  /** Whether the request mutates state; impersonation sessions cannot. */
  readonly write?: boolean;
  /** The zone the request acts on, checked against the principal's scope. */
  readonly zoneId?: string;
  /** Whether a human-readable reason is mandatory, as it is for every step-up action. */
  readonly reasonRequired?: boolean;
}

/** Allowed, or refused with the code the client already knows how to render. */
export type Decision = { readonly allowed: true } | { readonly allowed: false; readonly code: ErrorCode };

const ALLOW: Decision = { allowed: true };

/** Refused, spelled once. */
function deny(code: ErrorCode): Decision {
  return { allowed: false, code };
}

/**
 * Decide whether a principal may perform a requirement.
 *
 * The order of the checks matters and is not the obvious one: authentication, then
 * impersonation, then the permission itself, then zone scope, then step-up. Impersonation
 * is checked before the permission so that an impersonating super admin, who holds every
 * key, is still refused a write — the specification calls write actions "structurally
 * impossible", and structure means the check runs first, not that the UI hides a button.
 */
export function authorise(
  principal: Principal | null,
  requirement: Requirement,
  options: { nowMs?: number; reason?: string | null } = {},
): Decision {
  if (principal === null) return deny("AUTH_TOKEN_MISSING");
  if (principal.impersonating && requirement.write === true) return deny("PERM_IMPERSONATION_READONLY");
  if (principal.actorType !== "ADMIN" && !isActorKey(principal, requirement.permission))
    return deny("PERM_DENIED");
  if (principal.actorType === "ADMIN" && !roleAllows(principal.role ?? "", requirement.permission))
    return deny("PERM_DENIED");
  if (!inScope(principal, requirement.zoneId)) return deny("PERM_ZONE_OUT_OF_SCOPE");
  if (requiresStepUp(requirement.permission) && !stepUpFresh(principal.stepUpAtMs, options.nowMs ?? Date.now()))
    return deny("PERM_STEP_UP_REQUIRED");
  if (requirement.reasonRequired === true && (options.reason ?? "").trim().length < 8)
    return deny("VALIDATION_REQUIRED");
  return ALLOW;
}

/**
 * Whether the principal's own zone scope permits the zone.
 *
 * A global principal has no scope to violate; a zone-scoped one may not act on a
 * request that names another zone, and may not act on a request that names *no* zone
 * for a resource that is zone-owned — "unspecified" is not a wildcard here.
 */
export function inScope(principal: Principal, zoneId: string | undefined): boolean {
  if (principal.zoneScope === null) return true;
  if (zoneId === undefined) return false;
  return principal.zoneScope.includes(zoneId);
}

/**
 * Customers, vendors and riders hold a small fixed set of keys of their own.
 *
 * They are not admin roles and never appear in the register's role matrix: the
 * customer app can read its own orders because the handler queries by `user_id`, not
 * because a role grants it. The exception is the self-service surface, where a key
 * keeps the audit log readable.
 */
const ACTOR_KEYS: Readonly<Record<string, readonly PermissionKey[]>> = {
  CUSTOMER: ["order.read", "order.list", "order.create", "order.cancel", "order.rating.read", "order.rating.create", "customer.address.read", "customer.address.create", "customer.address.update", "customer.address.delete", "customer.address.set_default"],
  VENDOR_OWNER: ["vendor.read", "vendor.update", "order.read", "order.list", "order.accept", "order.reject", "catalogue.item.read", "catalogue.item.update", "catalogue.item.set_availability", "catalogue.item.mark_sold_out", "catalogue.menu.read", "catalogue.menu.update"],
  RIDER: ["order.read", "order.list", "order.pickup", "order.deliver", "rider.shift.read", "rider.shift.start", "rider.shift.end", "rider.shift.break", "rider.view_finance"],
};

function isActorKey(principal: Principal, key: PermissionKey): boolean {
  return (ACTOR_KEYS[principal.actorType] ?? []).includes(key);
}

/** The keys a non-admin actor type holds, for the tests that enumerate the matrix. */
export function actorKeys(actorType: string): readonly PermissionKey[] {
  return ACTOR_KEYS[actorType] ?? [];
}
