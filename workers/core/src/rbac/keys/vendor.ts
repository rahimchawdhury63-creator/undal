/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Vendors: onboarding, documents, hours, commission — 40 keys.
 *
 * Every key is `resource.action` beneath a domain prefix, spelled out rather than
 * composed at runtime: a permission a client cannot grep for is a permission nobody
 * can review, and the RBAC matrix test reads these arrays as the source of truth.
 */
export const VENDOR_KEYS = [
  // vendor
  "vendor.read",
  "vendor.list",
  "vendor.create",
  "vendor.update",
  "vendor.approve",
  "vendor.reject",
  "vendor.suspend",
  "vendor.unsuspend",
  "vendor.delete",
  "vendor.view_finance",
  "vendor.view_contacts",
  "vendor.view_stats",
  "vendor.pause",
  "vendor.resume",
  "vendor.set_commission",
  "vendor.view_commission",
  "vendor.change_zone",
  "vendor.set_categories",
  "vendor.view_documents",
  "vendor.view_bank",
  "vendor.reset_password",
  "vendor.impersonate",
  // vendor.document
  "vendor.document.read",
  "vendor.document.upload",
  "vendor.document.approve",
  "vendor.document.reject",
  "vendor.document.delete",
  "vendor.document.view_nid",
  // vendor.bank
  "vendor.bank.read",
  "vendor.bank.update",
  "vendor.bank.verify",
  "vendor.bank.view_masked",
  // vendor.hours
  "vendor.hours.read",
  "vendor.hours.update",
  "vendor.hours.set_holiday",
  "vendor.hours.delete_holiday",
  // vendor.commission
  "vendor.commission.read",
  "vendor.commission.create",
  "vendor.commission.update",
  "vendor.commission.delete",
] as const;
