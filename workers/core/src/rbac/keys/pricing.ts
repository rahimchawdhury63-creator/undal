/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Pricing matrix, fare rules and surge — 16 keys.
 *
 * Every key is `resource.action` beneath a domain prefix, spelled out rather than
 * composed at runtime: a permission a client cannot grep for is a permission nobody
 * can review, and the RBAC matrix test reads these arrays as the source of truth.
 */
export const PRICING_KEYS = [
  // pricing.matrix
  "pricing.matrix.read",
  "pricing.matrix.update",
  "pricing.matrix.view_history",
  "pricing.matrix.rollback",
  "pricing.matrix.preview",
  "pricing.matrix.publish",
  "pricing.matrix.view_versions",
  "pricing.matrix.compare",
  // pricing.rule
  "pricing.rule.read",
  "pricing.rule.update",
  "pricing.rule.view_vectors",
  "pricing.rule.simulate",
  // pricing.surge
  "pricing.surge.read",
  "pricing.surge.update",
  "pricing.surge.clear_override",
  "pricing.surge.view_curve",
] as const;
