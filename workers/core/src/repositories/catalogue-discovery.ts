/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * Discovery: the areas, cuisines and search answers the storefront navigates by.
 *
 * Kept apart from the vendor and menu readers because these are the queries a visitor uses to
 * find their way *to* a kitchen rather than to read it, and because each of them is a counting
 * query: how many kitchens deliver here, how many are listed under this cuisine. When the
 * platform is empty every one of them returns an empty list, which is what the storefront's
 * empty states are built on.
 */

import type { Db } from "../db/client.ts";
import { toHexId } from "../lib/ids.ts";
import {
  STATS_JOIN,
  VENDOR_COLUMNS,
  escapeLike,
  type VendorRow,
} from "./catalogue.ts";

/** An area (a zone, as a customer sees it) with how many kitchens are live inside it. */
export interface PublicArea {
  readonly slug: string;
  readonly code: string;
  readonly name: string;
  readonly nameBn: string;
  readonly city: string;
  readonly vendorCount: number;
}

/** The zones the platform currently delivers in, with a live vendor count each. */
export async function listAreas(db: Db): Promise<PublicArea[]> {
  const rows = await db.query<{
    code: string;
    name: string;
    name_bn: string;
    city: string;
    vendor_count: number | string;
  }>(
    "SELECT `z`.`code`, `z`.`name`, `z`.`name_bn`, `z`.`city`, " +
      "(SELECT COUNT(*) FROM `vendors` `v` WHERE `v`.`zone_id` = `z`.`id` " +
      "AND `v`.`status` = 'APPROVED' AND `v`.`deleted_at` IS NULL) AS `vendor_count` " +
      "FROM `zones` `z` WHERE `z`.`status` = 'ACTIVE' ORDER BY `z`.`name` ASC",
  );
  return rows.map((row) => ({
    slug: row.code.toLowerCase(),
    code: row.code,
    name: row.name,
    nameBn: row.name_bn,
    city: row.city,
    vendorCount: Number(row.vendor_count),
  }));
}

/** A cuisine category, as the area-by-cuisine landing pages use it. */
export interface PublicCategory {
  readonly slug: string;
  readonly nameEn: string;
  readonly nameBn: string;
  readonly vendorCount: number;
}

/** The active cuisine categories, hardest-working first. */
export async function listCategories(db: Db): Promise<PublicCategory[]> {
  const rows = await db.query<{ slug: string; name_en: string; name_bn: string; vendor_count: number | string }>(
    "SELECT `c`.`slug`, `c`.`name_en`, `c`.`name_bn`, COUNT(`v`.`id`) AS `vendor_count` " +
      "FROM `categories` `c` LEFT JOIN `vendor_categories` `vc` ON `vc`.`category_id` = `c`.`id` " +
      "LEFT JOIN `vendors` `v` ON `v`.`id` = `vc`.`vendor_id` AND `v`.`status` = 'APPROVED' AND `v`.`deleted_at` IS NULL " +
      "WHERE `c`.`active` = 1 GROUP BY `c`.`id`, `c`.`slug`, `c`.`name_en`, `c`.`name_bn`, `c`.`sort_order` " +
      "ORDER BY `c`.`sort_order` ASC, `vendor_count` DESC",
  );
  return rows.map((row) => ({
    slug: row.slug,
    nameEn: row.name_en,
    nameBn: row.name_bn,
    vendorCount: Number(row.vendor_count),
  }));
}

/** A dish that matched a search term, with the kitchen that sells it. */
export interface PublicItemHit {
  readonly id: string;
  readonly name: string;
  readonly nameBn: string | null;
  readonly pricePaisa: number;
  readonly imageUrl: string | null;
  readonly availability: string;
  readonly vendorSlug: string;
  readonly vendorName: string;
  readonly vendorPanelName: string | null;
  readonly vendorOpenState: string;
}

/** What a search found. Both lists are capped, and neither is paginated: search is a jump, not a browse. */
export interface SearchResults {
  readonly vendors: readonly VendorRow[];
  readonly items: readonly PublicItemHit[];
}

/** Search vendors and dishes. Empty query returns nothing rather than everything. */
export async function search(db: Db, term: string, limit: number): Promise<SearchResults> {
  const trimmed = term.trim();
  if (trimmed === "") return { vendors: [], items: [] };
  const pattern = `%${escapeLike(trimmed)}%`;

  const vendors = await db.query<VendorRow>(
    `SELECT ${VENDOR_COLUMNS}, \`st\`.\`rating_sum\`, \`st\`.\`rating_count\`, \`st\`.\`orders_completed\` ` +
      `FROM \`vendors\` v ${STATS_JOIN} WHERE v.\`status\` = 'APPROVED' AND v.\`deleted_at\` IS NULL ` +
      "AND (v.`name` LIKE ? OR v.`name_bn` LIKE ? OR v.`tagline` LIKE ?) ORDER BY v.`name` ASC LIMIT ?",
    [pattern, pattern, pattern, limit],
  );

  const items = await db.query<{
    id: Uint8Array;
    name: string;
    name_bn: string | null;
    price_paisa: number | string;
    image_url: string | null;
    availability: string;
    slug: string;
    vendor_name: string;
    vendor_name_bn: string | null;
    open_state: string;
  }>(
    "SELECT `mi`.`id`, `mi`.`name`, `mi`.`name_bn`, `mi`.`price_paisa`, `mi`.`image_url`, `mi`.`availability`, " +
      "`v`.`slug`, `v`.`name` AS `vendor_name`, `v`.`name_bn` AS `vendor_name_bn`, `v`.`open_state` " +
      "FROM `menu_items` `mi` JOIN `vendors` `v` ON `v`.`id` = `mi`.`vendor_id` " +
      "WHERE `v`.`status` = 'APPROVED' AND `v`.`deleted_at` IS NULL AND `mi`.`deleted_at` IS NULL " +
      "AND `mi`.`availability` <> 'HIDDEN' AND (`mi`.`name` LIKE ? OR `mi`.`name_bn` LIKE ?) " +
      "ORDER BY `mi`.`sort_order` ASC, `mi`.`id` ASC LIMIT ?",
    [pattern, pattern, limit],
  );

  return {
    vendors,
    items: items.map((row) => ({
      id: toHexId(row.id),
      name: row.name,
      nameBn: row.name_bn,
      pricePaisa: Number(row.price_paisa),
      imageUrl: row.image_url,
      availability: row.availability,
      vendorSlug: row.slug,
      vendorName: row.vendor_name,
      vendorPanelName: row.vendor_name_bn,
      vendorOpenState: row.open_state,
    })),
  };
}

/** Everything the prerender pipeline needs to emit a route manifest. */
export interface SitemapData {
  readonly areas: readonly { slug: string; vendorCount: number }[];
  readonly categories: readonly { slug: string; vendorCount: number }[];
  readonly vendors: readonly { slug: string; updatedAt: string }[];
}

/**
 * The route manifest for the storefront's prerender pass.
 *
 * Generated from live data on purpose: a prerendered page about a restaurant that has left the
 * platform is worse than no page, because it ranks and then disappoints. When this returns an
 * empty manifest the build emits the empty state — which is the honest storefront for a
 * platform that has not launched in any neighbourhood yet.
 */
export async function sitemapData(db: Db): Promise<SitemapData> {
  const areas = await listAreas(db);
  const categories = await listCategories(db);
  const vendors = await db.query<{ slug: string; updated_at: string }>(
    "SELECT `slug`, `updated_at` FROM `vendors` WHERE `status` = 'APPROVED' AND `deleted_at` IS NULL " +
      "ORDER BY `updated_at` DESC LIMIT 5000",
  );
  return {
    areas: areas.map((area) => ({ slug: area.slug, vendorCount: area.vendorCount })),
    categories: categories.map((category) => ({ slug: category.slug, vendorCount: category.vendorCount })),
    vendors: vendors.map((row) => ({ slug: row.slug, updatedAt: row.updated_at })),
  };
}
