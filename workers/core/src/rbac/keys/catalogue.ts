/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Catalogue: vendors' menus, items, modifiers and media — 40 keys.
 *
 * Every key is `resource.action` beneath a domain prefix, spelled out rather than
 * composed at runtime: a permission a client cannot grep for is a permission nobody
 * can review, and the RBAC matrix test reads these arrays as the source of truth.
 */
export const CATALOGUE_KEYS = [
  // catalogue.category
  "catalogue.category.read",
  "catalogue.category.list",
  "catalogue.category.create",
  "catalogue.category.update",
  "catalogue.category.delete",
  "catalogue.category.reorder",
  // catalogue.menu
  "catalogue.menu.read",
  "catalogue.menu.create",
  "catalogue.menu.update",
  "catalogue.menu.publish",
  "catalogue.menu.unpublish",
  "catalogue.menu.schedule",
  "catalogue.menu.clone",
  "catalogue.menu.delete",
  // catalogue.item
  "catalogue.item.read",
  "catalogue.item.list",
  "catalogue.item.create",
  "catalogue.item.update",
  "catalogue.item.delete",
  "catalogue.item.set_price",
  "catalogue.item.set_availability",
  "catalogue.item.mark_sold_out",
  "catalogue.item.restore_availability",
  "catalogue.item.set_prep_time",
  "catalogue.item.reorder_sections",
  "catalogue.item.view_stats",
  "catalogue.item.set_tags",
  "catalogue.item.bulk_update",
  // catalogue.modifier
  "catalogue.modifier.read",
  "catalogue.modifier.create",
  "catalogue.modifier.update",
  "catalogue.modifier.delete",
  "catalogue.modifier.attach",
  "catalogue.modifier.detach",
  // catalogue.media
  "catalogue.media.read",
  "catalogue.media.upload",
  "catalogue.media.delete",
  "catalogue.media.reorder",
  "catalogue.media.set_primary",
  "catalogue.media.regenerate_derivative",
] as const;
