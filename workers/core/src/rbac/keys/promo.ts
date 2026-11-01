/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Promo codes, campaigns and referrals — 22 keys.
 *
 * Every key is `resource.action` beneath a domain prefix, spelled out rather than
 * composed at runtime: a permission a client cannot grep for is a permission nobody
 * can review, and the RBAC matrix test reads these arrays as the source of truth.
 */
export const PROMO_KEYS = [
  // promo.code
  "promo.code.read",
  "promo.code.list",
  "promo.code.create",
  "promo.code.update",
  "promo.code.disable",
  "promo.code.delete",
  "promo.code.view_redemptions",
  "promo.code.export_redemptions",
  "promo.code.set_budget",
  "promo.code.view_performance",
  // promo.campaign
  "promo.campaign.read",
  "promo.campaign.list",
  "promo.campaign.create",
  "promo.campaign.update",
  "promo.campaign.pause",
  "promo.campaign.resume",
  "promo.campaign.view_budget",
  "promo.campaign.view_redemptions",
  // promo.referral
  "promo.referral.read",
  "promo.referral.list",
  "promo.referral.configure",
  "promo.referral.view_payouts",
] as const;
