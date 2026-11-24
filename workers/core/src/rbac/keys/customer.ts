/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Customers: accounts, addresses, devices — 28 keys.
 *
 * Every key is `resource.action` beneath a domain prefix, spelled out rather than
 * composed at runtime: a permission a client cannot grep for is a permission nobody
 * can review, and the RBAC matrix test reads these arrays as the source of truth.
 */
export const CUSTOMER_KEYS = [
  // customer
  "customer.read",
  "customer.list",
  "customer.create",
  "customer.update",
  "customer.suspend",
  "customer.unsuspend",
  "customer.delete",
  "customer.view_orders",
  "customer.view_payments",
  "customer.view_loyalty",
  "customer.adjust_loyalty",
  "customer.view_sessions",
  "customer.revoke_sessions",
  "customer.export_personal_data",
  // customer.address
  "customer.address.read",
  "customer.address.list",
  "customer.address.create",
  "customer.address.update",
  "customer.address.delete",
  "customer.address.set_default",
  "customer.address.verify_zone",
  "customer.address.view_geocode",
  // customer.device
  "customer.device.read",
  "customer.device.list",
  "customer.device.register",
  "customer.device.revoke",
  "customer.device.view_tokens",
  "customer.device.send_test_push",
] as const;
