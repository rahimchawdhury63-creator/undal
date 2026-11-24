/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { ALL_PERMISSION_KEYS, riskOf, type PermissionKey } from "./keys.ts";

/**
 * The seven system roles, expressed as predicates over the key register rather than
 * as 2 884 stored grants.
 *
 * `admin_roles` and `admin_role_permissions` still hold the grants — custom roles need
 * rows — but the seven system roles are defined here, because "FINANCE may read
 * everything but write only finance" is a rule, and a rule that lives as 300 rows is
 * a rule nobody can review. The migration writes these grants into the tables from
 * this module's output, so the two can never drift.
 */
export type RoleKey =
  | "SUPER_ADMIN"
  | "OPS_MANAGER"
  | "DISPATCHER"
  | "FINANCE"
  | "SUPPORT"
  | "ONBOARDING"
  | "ANALYST";

/** A role as the specification describes it: a name, a scope and a matcher. */
export interface RoleDefinition {
  readonly key: RoleKey;
  readonly nameEn: string;
  readonly nameBn: string;
  /** Whether the role is created by migration and cannot be deleted. */
  readonly isSystem: true;
  /** How the role's reach is described in the admin panel. */
  readonly summaryEn: string;
  /** Whether holders may be scoped to zones; a global-only role ignores zone scope. */
  readonly zoneScopable: boolean;
  /** The predicate that decides membership. */
  readonly allows: (key: PermissionKey) => boolean;
}

/** Which domains each role writes to; everything else it can reach is read-only. */
const WRITE_DOMAINS: Readonly<Record<RoleKey, readonly string[]>> = {
  SUPER_ADMIN: ["order", "dispatch", "catalogue", "finance", "vendor", "rider", "customer", "support", "kyc", "zone", "pricing", "promo", "analytics", "brain", "admin"],
  OPS_MANAGER: ["order", "dispatch", "catalogue", "vendor", "rider", "customer", "support", "kyc", "zone", "pricing", "promo", "analytics"],
  DISPATCHER: ["dispatch", "order"],
  FINANCE: ["finance", "analytics", "promo"],
  SUPPORT: ["support", "customer"],
  ONBOARDING: ["kyc", "vendor", "rider"],
  ANALYST: [],
};

function domain(key: PermissionKey): string {
  return key.slice(0, key.indexOf("."));
}

function action(key: PermissionKey): string {
  return key.slice(key.lastIndexOf(".") + 1);
}

/** A key whose verb only reads, exports or analyses. */
function isReadOnly(key: PermissionKey): boolean {
  return riskOf(key) === "LOW" || riskOf(key) === "MEDIUM";
}

function canWrite(role: RoleKey, key: PermissionKey): boolean {
  return WRITE_DOMAINS[role].includes(domain(key));
}

const ROLES: readonly RoleDefinition[] = [
  {
    key: "SUPER_ADMIN",
    nameEn: "Super admin",
    nameBn: "সুপার অ্যাডমিন",
    isSystem: true,
    summaryEn: "Everything, including role editing. The last one cannot be deleted.",
    zoneScopable: false,
    allows: () => true,
  },
  {
    key: "OPS_MANAGER",
    nameEn: "Operations manager",
    nameBn: "অপারেশনস ম্যানেজার",
    isSystem: true,
    summaryEn: "Orders, dispatch, vendors, riders and exceptions. No finance writes, no RBAC.",
    zoneScopable: true,
    allows: (key) => {
      if (domain(key) === "admin" && action(key) !== "read") return false;
      if (domain(key) === "finance" && !isReadOnly(key)) return false;
      return isReadOnly(key) || canWrite("OPS_MANAGER", key) || domain(key) === "finance";
    },
  },
  {
    key: "DISPATCHER",
    nameEn: "Dispatcher",
    nameBn: "ডিসপ্যাচার",
    isSystem: true,
    summaryEn: "Live orders and the fleet inside their zones. Can reassign, cannot refund.",
    zoneScopable: true,
    allows: (key) =>
      domain(key) === "dispatch" ||
      (domain(key) === "order" && !isSensitiveOrderAction(key)) ||
      (domain(key) === "rider" && isReadOnly(key)) ||
      (domain(key) === "zone" && isReadOnly(key)),
  },
  {
    key: "FINANCE",
    nameEn: "Finance",
    nameBn: "ফিন্যান্স",
    isSystem: true,
    summaryEn: "Invoices, payouts, the ledger and the COD wallet. Read-only everywhere else.",
    zoneScopable: false,
    allows: (key) =>
      domain(key) === "finance" ||
      (domain(key) === "admin" && action(key) === "read") ||
      isReadOnly(key) ||
      (domain(key) === "promo" && isReadOnly(key)),
  },
  {
    key: "SUPPORT",
    nameEn: "Support",
    nameBn: "সাপোর্ট",
    isSystem: true,
    summaryEn: "Tickets, disputes, customer read and credits up to the configured cap.",
    zoneScopable: false,
    allows: (key) =>
      domain(key) === "support" ||
      (domain(key) === "customer" && !["delete", "suspend", "export_personal_data"].includes(action(key))) ||
      (domain(key) === "order" && isReadOnly(key)) ||
      (domain(key) === "catalogue" && isReadOnly(key)) ||
      key === "vendor.read" ||
      key === "rider.read",
  },
  {
    key: "ONBOARDING",
    nameEn: "Onboarding",
    nameBn: "অনবোর্ডিং",
    isSystem: true,
    summaryEn: "KYC queues and the approval of vendors and riders. Nothing after approval.",
    zoneScopable: true,
    allows: (key) => {
      if (domain(key) === "kyc") return true;
      if (domain(key) === "vendor")
        return ["read", "list", "create", "update", "approve", "reject", "view_documents", "view_contacts"].includes(action(key)) ||
          key.startsWith("vendor.document.") || key.startsWith("vendor.hours.") || key.startsWith("vendor.bank.");
      if (domain(key) === "rider")
        return ["read", "list", "create", "update", "approve", "reject", "view_vehicle", "set_vehicle"].includes(action(key)) ||
          key.startsWith("rider.document.");
      return domain(key) === "zone" && isReadOnly(key);
    },
  },
  {
    key: "ANALYST",
    nameEn: "Analyst",
    nameBn: "অ্যানালিস্ট",
    isSystem: true,
    summaryEn: "Read-only across every domain, plus exports.",
    zoneScopable: false,
    allows: (key) => isReadOnly(key) && !key.includes("personal_data"),
  },
];

/** Every system role, in the order the admin panel lists them. */
export const SYSTEM_ROLES = ROLES;

/** How many roles exist, which the RBAC matrix test multiplies by 412. */
export const ROLE_COUNT = SYSTEM_ROLES.length;

/** Order actions a dispatcher may not take because they move money or the record. */
function isSensitiveOrderAction(key: PermissionKey): boolean {
  return ["refund", "force_cancel", "view_customer_contact", "view_cost_breakdown"].includes(action(key));
}

/** One role by key, or `undefined` for a custom role stored in the database. */
export function roleDefinition(role: string): RoleDefinition | undefined {
  return SYSTEM_ROLES.find((candidate) => candidate.key === role);
}

/**
 * Whether a role holds a key.
 *
 * Unknown roles hold nothing: a custom role's grants come from
 * `admin_role_permissions`, and a caller that reaches this function with an unknown
 * key is asking about a system role that does not exist — the safe answer is no.
 */
export function roleAllows(role: string, key: PermissionKey): boolean {
  const definition = roleDefinition(role);
  return definition !== undefined && definition.allows(key);
}

/** The keys a role holds, which the migration writes and the panel displays. */
export function grantsFor(role: RoleKey): PermissionKey[] {
  return ALL_PERMISSION_KEYS.filter((key) => roleAllows(role, key));
}
