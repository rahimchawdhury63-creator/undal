/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Administration: users, roles, configuration, break-glass — 12 keys.
 *
 * Every key is `resource.action` beneath a domain prefix, spelled out rather than
 * composed at runtime: a permission a client cannot grep for is a permission nobody
 * can review, and the RBAC matrix test reads these arrays as the source of truth.
 */
export const ADMIN_KEYS = [
  // admin.user
  "admin.user.read",
  "admin.user.create",
  "admin.user.delete",
  // admin.role
  "admin.role.read",
  "admin.role.edit",
  "admin.role.assign",
  // admin.permission
  "admin.permission.read",
  // admin.config
  "admin.config.edit",
  "admin.config.retention",
  // admin.security
  "admin.security.break_glass",
  "admin.security.rotate_qr_secret",
  // admin.audit
  "admin.audit.read",
] as const;
