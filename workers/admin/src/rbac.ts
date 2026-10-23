/**
 * @file workers/admin/src/rbac.ts
 * @description Granular Super-Admin RBAC Evaluator (`File 09 §9.3`, `Appendix C` `C1–C132`,
 * and exact SQL `public.has_admin_permission` parity across all `7` canonical system roles
 * plus founder-authored custom roles).
 */

/** Canonical `Appendix C` permissions across Domains `1–9`. */
export const ALL_CANONICAL_ADMIN_PERMISSIONS: readonly string[] = [
  // Domain 1: Governance & Security (C1–C21)
  '1.admin_users',
  '1.roles_matrix',
  '1.sessions',
  '1.audit_logs',
  '1.platform_settings',
  '1.kill_switches',
  '1.health',
  // Domain 2: Dispatch & Logistics (C22–C40)
  '2.live_map',
  '2.order_tower',
  '2.interventions',
  '2.fleet',
  '2.batching',
  '2.sla',
  // Domain 3: Geofencing & Dynamic Pricing (C41–C54)
  '3.zones',
  '3.delivery_fees',
  '3.fare_engine',
  '3.radii',
  // Domain 4: Vendor & Menu Hub (C55–C70)
  '4.pipeline',
  '4.vendor_360',
  '4.menu_moderation',
  '4.catalog',
  // Domain 5: Finance & Settlement (C71–C89)
  '5.invoices',
  '5.remittances',
  '5.adjustments',
  '5.ledger',
  '5.reports',
  // Domain 6: Orders 360 (C90–C101)
  '6.order_360',
  '6.exceptions',
  '6.modify',
  '6.search',
  // Domain 7: Growth (C102–C113)
  '7.flash_box',
  '7.campaigns',
  '7.vouchers',
  '7.banners',
  '7.referrals',
  '7.nudges',
  // Domain 8: Support (C114–C124)
  '8.inbox',
  '8.live_chats',
  '8.disputes',
  '8.reviews',
  '8.customer_360',
  // Domain 9: BI (C125–C132)
  '9.executive',
  '9.funnels',
  '9.cohorts',
  '9.demand',
  '9.reports',
  '9.quality',
];

/** Read-only shorthand aliases seeded in `0004_core_rls_and_seeds.sql` for `ops_manager` & `compliance_auditor`. */
const READ_ALIAS_MAP: Readonly<Record<string, readonly string[]>> = {
  '1.platform_settings': ['1.settings.view'],
  '1.admin_users': ['1.rbac.view'],
  '1.roles_matrix': ['1.rbac.view'],
  '5.ledger': ['5.ledger.view'],
};

/**
 * Evaluates whether an authenticated admin possessing `roleKeys` + `grants` satisfies
 * `requiredPermission` for `(mode: 'read' | 'write')`, matching SQL `public.has_admin_permission`.
 */
export function hasAdminPermission(params: {
  readonly roleKeys: readonly string[];
  readonly grants: readonly string[];
  readonly requiredPermission: string;
  readonly mode: 'read' | 'write';
}): boolean {
  if (params.roleKeys.includes('super_admin')) return true;

  for (const grant of params.grants) {
    if (grant === '*') return true;
    if (grant === params.requiredPermission) return true;
    if (grant.endsWith('.*')) {
      const prefix = grant.slice(0, -1); // e.g. `'2.'`
      if (params.requiredPermission.startsWith(prefix)) return true;
    }
    if (params.mode === 'read') {
      const readAliases = READ_ALIAS_MAP[params.requiredPermission] ?? [];
      if (readAliases.includes(grant)) return true;
    }
  }
  return false;
}

/**
 * Computes the exact before/after permission diff and affected active admin headcount (`C6`)
 * before saving changes to a role's permission set.
 */
export function computeRolePermissionDiff(params: {
  readonly currentPermissions: readonly string[];
  readonly nextPermissions: readonly string[];
  readonly assignedUserCount: number;
}): {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly unchangedCount: number;
  readonly affectedAdminUsers: number;
} {
  const cur = new Set(params.currentPermissions);
  const nxt = new Set(params.nextPermissions);
  const added = [...nxt].filter((p) => !cur.has(p)).sort();
  const removed = [...cur].filter((p) => !nxt.has(p)).sort();
  const unchangedCount = [...nxt].filter((p) => cur.has(p)).length;
  return {
    added,
    removed,
    unchangedCount,
    affectedAdminUsers: added.length === 0 && removed.length === 0 ? 0 : params.assignedUserCount,
  };
}
