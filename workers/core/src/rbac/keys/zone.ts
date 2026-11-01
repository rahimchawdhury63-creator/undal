/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Zones: geometry, activation, managers — 14 keys.
 *
 * Every key is `resource.action` beneath a domain prefix, spelled out rather than
 * composed at runtime: a permission a client cannot grep for is a permission nobody
 * can review, and the RBAC matrix test reads these arrays as the source of truth.
 */
export const ZONE_KEYS = [
  // zone
  "zone.read",
  "zone.list",
  "zone.create",
  "zone.update",
  "zone.delete",
  "zone.activate",
  "zone.deactivate",
  "zone.view_metrics",
  "zone.view_pricing",
  "zone.assign_manager",
  // zone.polygon
  "zone.polygon.read",
  "zone.polygon.update",
  "zone.polygon.validate",
  "zone.polygon.view_history",
] as const;
