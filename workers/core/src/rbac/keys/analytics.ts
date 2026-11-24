/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Reports and exports — 16 keys.
 *
 * Every key is `resource.action` beneath a domain prefix, spelled out rather than
 * composed at runtime: a permission a client cannot grep for is a permission nobody
 * can review, and the RBAC matrix test reads these arrays as the source of truth.
 */
export const ANALYTICS_KEYS = [
  // analytics.report
  "analytics.report.read",
  "analytics.report.orders",
  "analytics.report.revenue",
  "analytics.report.vendors",
  "analytics.report.riders",
  "analytics.report.dispatch",
  "analytics.report.cash",
  "analytics.report.tax",
  "analytics.report.exceptions",
  "analytics.report.custom",
  // analytics.export
  "analytics.export.create",
  "analytics.export.download",
  "analytics.export.list",
  "analytics.export.delete",
  "analytics.export.personal_data",
  "analytics.export.schedule",
] as const;
