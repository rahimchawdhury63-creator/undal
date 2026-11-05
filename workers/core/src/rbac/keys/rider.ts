/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Riders: shifts, documents, penalties, cash — 39 keys.
 *
 * Every key is `resource.action` beneath a domain prefix, spelled out rather than
 * composed at runtime: a permission a client cannot grep for is a permission nobody
 * can review, and the RBAC matrix test reads these arrays as the source of truth.
 */
export const RIDER_KEYS = [
  // rider
  "rider.read",
  "rider.list",
  "rider.create",
  "rider.update",
  "rider.approve",
  "rider.reject",
  "rider.suspend",
  "rider.unsuspend",
  "rider.delete",
  "rider.view_finance",
  "rider.view_location_history",
  "rider.view_selfie",
  "rider.view_stats",
  "rider.assign_zone",
  "rider.remove_zone",
  "rider.reset_password",
  "rider.set_vehicle",
  "rider.view_vehicle",
  "rider.impersonate",
  "rider.view_cash",
  // rider.shift
  "rider.shift.start",
  "rider.shift.end",
  "rider.shift.break",
  "rider.shift.read",
  "rider.shift.list",
  "rider.shift.force_end",
  "rider.shift.approve_selfie",
  "rider.shift.reject_selfie",
  "rider.shift.view_summary",
  // rider.document
  "rider.document.read",
  "rider.document.upload",
  "rider.document.approve",
  "rider.document.reject",
  "rider.document.delete",
  "rider.document.view_nid",
  // rider.penalty
  "rider.penalty.read",
  "rider.penalty.create",
  "rider.penalty.waive",
  "rider.penalty.list",
] as const;
