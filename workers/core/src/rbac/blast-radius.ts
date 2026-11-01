/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { ALL_PERMISSION_KEYS, domainOf, riskOf, type PermissionKey, type PermissionRisk } from "./keys.ts";
import { SYSTEM_ROLES, grantsFor, roleAllows, type RoleKey } from "./roles.ts";

/**
 * What a role can do, counted — the number the role editor shows before a change is
 * saved, and the number a reviewer asks for when a new custom role appears.
 *
 * "Blast radius" is not decoration. A role editor that lists 412 checkboxes invites
 * somebody to tick `finance.payout.mark_paid` while meaning to allow reading a payout,
 * and the only defence that scales is showing the consequence as a count.
 */

/** A role's reach, by count and by domain. */
export interface BlastRadius {
  readonly role: string;
  readonly keys: number;
  readonly byRisk: Readonly<Record<PermissionRisk, number>>;
  readonly byDomain: Readonly<Record<string, number>>;
  /** The domains in which the role can change something, not merely look. */
  readonly writeDomains: readonly string[];
}

/** Compute a role's reach from the register, never from a stored count. */
export function blastRadius(role: string): BlastRadius {
  const definition = SYSTEM_ROLES.find((candidate) => candidate.key === role);
  const held = ALL_PERMISSION_KEYS.filter((key) => roleAllows(role, key));
  const byRisk: Record<PermissionRisk, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  const byDomain: Record<string, number> = {};
  const writeDomains = new Set<string>();

  for (const key of held) {
    byRisk[riskOf(key)] += 1;
    const domain = domainOf(key);
    byDomain[domain] = (byDomain[domain] ?? 0) + 1;
    if (riskOf(key) !== "LOW") writeDomains.add(domain);
  }

  return {
    role: definition?.key ?? role,
    keys: held.length,
    byRisk,
    byDomain,
    writeDomains: [...writeDomains].sort(),
  };
}

/** Which roles can perform an action — the question asked before granting a custom role. */
export function rolesAbleTo(key: PermissionKey): RoleKey[] {
  return SYSTEM_ROLES.filter((role) => role.allows(key)).map((role) => role.key);
}

/**
 * Whether the seven system roles between them hold every key.
 *
 * They do not have to — a key can be reserved for custom roles — but the invariant
 * is worth asserting because an unreachable key means an unreachable feature, and
 * the failure reads as a broken button rather than a missing grant.
 */
export function unheldKeys(): PermissionKey[] {
  return ALL_PERMISSION_KEYS.filter((key) => SYSTEM_ROLES.every((role) => !role.allows(key)));
}

/** How many grants the seven system roles hold in total, the RBAC matrix's size. */
export function totalGrants(): number {
  return SYSTEM_ROLES.reduce((sum, role) => sum + grantsFor(role.key).length, 0);
}
