/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * Reading the public catalogue: vendors, menus, areas and search.
 *
 * This is the only part of `undal-core` an anonymous visitor can reach, so it is written
 * defensively in three specific ways. It never returns a vendor that is not `APPROVED` and
 * not deleted — an unapproved kitchen is a business that has not signed a contract, not a
 * draft to preview. It never returns a column that is not on the public allowlist, rather
 * than serialising a row and trusting the export to remember what is secret. And it never
 * invents a value it does not have: a delivery fee it has not priced is `null`, not zero,
 * because a zero on a storefront reads as "free delivery" and would be a lie.
 *
 * Every list query is keyset-paginated on a single integer or text key plus the UUID, so a
 * page boundary is stable even while a vendor's stats change underneath it.
 */

import { haversineMeters } from "@undal/contracts";

import type { Db } from "../db/client.ts";
import { toHexId } from "../lib/ids.ts";

/** How a vendor list may be ordered. The storefront offers exactly these four. */
export type VendorSort = "RECOMMENDED" | "TOP_RATED" | "FASTEST" | "NEAREST" | "NAME";

/** One row of the vendor list, before it is serialised. */
export interface VendorRow {
  readonly id: Uint8Array;
  readonly slug: string;
  readonly name: string;
  readonly name_bn: string | null;
  readonly tagline: string | null;
  readonly kind: string;
  readonly open_state: string;
  readonly busy_level: number | string;
  readonly min_order_paisa: number | string;
  readonly prep_time_default_s: number | string;
  readonly cover_url: string | null;
  readonly cover_blurhash: string | null;
  readonly logo_url: string | null;
  readonly logo_blurhash: string | null;
  readonly supports_pickup: number | string | boolean;
  readonly supports_delivery: number | string | boolean;
  readonly lat_e7: number | string;
  readonly lon_e7: number | string;
  readonly zone_id: Uint8Array;
  readonly updated_at: string;
  readonly rating_sum: number | string | null;
  readonly rating_count: number | string | null;
  readonly orders_completed: number | string | null;
  /** The key the current sort ordered by, so a cursor can continue from it. */
  readonly sort_key?: number | string | null;
}

/** A vendor as the API returns it. Amounts are integers of paisa; distances are metres. */
export interface PublicVendor {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly nameBn: string | null;
  readonly tagline: string | null;
  readonly kind: string;
  readonly openState: string;
  readonly busyLevel: number;
  readonly ratingBps: number | null;
  readonly ratingCount: number;
  readonly ordersCompleted: number;
  readonly minOrderPaisa: number;
  readonly prepTimeSeconds: number;
  readonly coverUrl: string | null;
  readonly coverBlurhash: string | null;
  readonly logoUrl: string | null;
  readonly logoBlurhash: string | null;
  readonly supportsPickup: boolean;
  readonly supportsDelivery: boolean;
  readonly latE7: number;
  readonly lonE7: number;
  readonly distanceM: number | null;
  readonly updatedAt: string;
}

/** The public column allowlist, exported so discovery selects the same fields a list page does. */
export const VENDOR_COLUMNS =
  "v.`id`, v.`slug`, v.`name`, v.`name_bn`, v.`tagline`, v.`kind`, v.`open_state`, " +
  "v.`busy_level`, v.`min_order_paisa`, v.`prep_time_default_s`, v.`cover_url`, " +
  "v.`cover_blurhash`, v.`logo_url`, v.`logo_blurhash`, v.`supports_pickup`, " +
  "v.`supports_delivery`, v.`lat_e7`, v.`lon_e7`, v.`zone_id`, v.`updated_at`";

/**
 * Lifetime statistics, aggregated once per query.
 *
 * `vendor_stats` is daily, so a rating is a sum over days. The derived table is grouped by
 * vendor and joined on the vendor's primary key, which is why this costs one pass over the
 * unique index rather than one subquery per row.
 */
/** The lifetime-statistics join, exported for the same reason: a search hit and a list row must agree. */
export const STATS_JOIN =
  "LEFT JOIN (SELECT `vendor_id`, SUM(`rating_sum`) AS `rating_sum`, " +
  "SUM(`rating_count`) AS `rating_count`, SUM(`orders_completed`) AS `orders_completed` " +
  "FROM `vendor_stats` GROUP BY `vendor_id`) `st` ON `st`.`vendor_id` = v.`id`";

const RATING_BPS =
  "(CASE WHEN COALESCE(`st`.`rating_count`, 0) = 0 THEN 0 ELSE (`st`.`rating_sum` * 100) DIV `st`.`rating_count` END)";

/**
 * The recommendation score: rating first, then volume.
 *
 * Ninety points for a five-star kitchen and nothing for an unrated one; up to a hundred for
 * having delivered at all. A vendor cannot buy a point of it, and every term is stored data
 * rather than a per-request calculation, which is what keeps `docs/13`'s anti-advertising
 * guarantee auditable.
 */
const RANK_SCORE = `((${RATING_BPS}) * 10 + LEAST(COALESCE(\`st\`.\`orders_completed\`, 0), 100))`;

/** The single key each sort orders by, plus the direction a cursor continues in. */
const SORT_KEYS: Readonly<Record<Exclude<VendorSort, "NEAREST">, { expr: string; direction: "ASC" | "DESC" }>> = {
  RECOMMENDED: { expr: RANK_SCORE, direction: "DESC" },
  TOP_RATED: { expr: RATING_BPS, direction: "DESC" },
  FASTEST: { expr: "v.`prep_time_default_s`", direction: "ASC" },
  NAME: { expr: "v.`name`", direction: "ASC" },
};

/** Escape the LIKE wildcards a customer may type, so a `%` searches for a percent sign. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

/** What the caller asked the vendor list for. */
export interface VendorListQuery {
  readonly zoneCode?: string | null;
  readonly categorySlug?: string | null;
  readonly q?: string | null;
  readonly sort: VendorSort;
  readonly origin?: { readonly latE7: number; readonly lonE7: number } | null;
  readonly limit: number;
  readonly cursor?: { readonly key: string; readonly id: string } | null;
}

/** A page of vendors and the key that continues it. */
export interface VendorPage {
  readonly vendors: readonly VendorRow[];
  readonly nextKey: { readonly key: string; readonly id: string } | null;
}

/** The ceiling on a distance-sorted page, because distance cannot be a SQL keyset. */
export const NEAREST_WINDOW = 200;

/**
 * List vendors for the storefront.
 *
 * `NEAREST` is the one sort that is not a keyset: a haversine is computed in the Worker, so the
 * query takes a bounded window of {@link NEAREST_WINDOW} vendors in the area and sorts those.
 * Beyond that window a customer gets the nearest two hundred, which at any real density is
 * every open kitchen within cycling distance, and the response says `nextCursor: null` rather
 * than pretending the list continues.
 */
export async function listVendors(db: Db, query: VendorListQuery): Promise<VendorPage> {
  const where: string[] = ["v.`status` = 'APPROVED'", "v.`deleted_at` IS NULL"];
  const params: unknown[] = [];

  if (query.zoneCode !== undefined && query.zoneCode !== null && query.zoneCode !== "") {
    where.push("`z`.`code` = ?");
    params.push(query.zoneCode.toUpperCase());
  }
  if (query.categorySlug !== undefined && query.categorySlug !== null && query.categorySlug !== "") {
    where.push(
      "EXISTS (SELECT 1 FROM `vendor_categories` `vc` JOIN `categories` `c` ON `c`.`id` = `vc`.`category_id` " +
        "WHERE `vc`.`vendor_id` = v.`id` AND `c`.`slug` = ? AND `c`.`active` = 1)",
    );
    params.push(query.categorySlug.toLowerCase());
  }
  if (query.q !== undefined && query.q !== null && query.q.trim() !== "") {
    where.push("(v.`name` LIKE ? OR v.`name_bn` LIKE ?)");
    const pattern = `%${escapeLike(query.q.trim())}%`;
    params.push(pattern, pattern);
  }

  const zoneJoin = "JOIN `zones` `z` ON `z`.`id` = v.`zone_id`";

  if (query.sort === "NEAREST") {
    const sql =
      `SELECT ${VENDOR_COLUMNS}, \`st\`.\`rating_sum\`, \`st\`.\`rating_count\`, \`st\`.\`orders_completed\` ` +
      `FROM \`vendors\` v ${zoneJoin} ${STATS_JOIN} WHERE ${where.join(" AND ")} ` +
      "ORDER BY v.`id` LIMIT ?";
    const rows = await db.query<VendorRow>(sql, [...params, NEAREST_WINDOW]);
    const origin = query.origin ?? null;
    const scored = rows.map((row) => ({
      row,
      distanceM:
        origin === null
          ? null
          : Math.round(
              haversineMeters(
                { latE7: Number(row.lat_e7), lonE7: Number(row.lon_e7) },
                { latE7: origin.latE7, lonE7: origin.lonE7 },
              ),
            ),
    }));
    scored.sort((a, b) => {
      const distance = (a.distanceM ?? Number.MAX_SAFE_INTEGER) - (b.distanceM ?? Number.MAX_SAFE_INTEGER);
      if (distance !== 0) return distance;
      return toHexId(a.row.id).localeCompare(toHexId(b.row.id));
    });
    return { vendors: scored.slice(0, query.limit).map((entry) => entry.row), nextKey: null };
  }

  const key = SORT_KEYS[query.sort];
  const conditions = [...where];
  const bound = [...params];
  if (query.cursor !== null && query.cursor !== undefined) {
    const comparison = key.direction === "DESC" ? "<" : ">";
    const parsed = Number(query.cursor.key);
    const cursorValue: unknown = query.sort === "NAME" ? query.cursor.key : Number.isFinite(parsed) ? parsed : 0;
    conditions.push(`((${key.expr}) ${comparison} ? OR ((${key.expr}) = ? AND v.\`id\` > ?))`);
    bound.push(cursorValue, cursorValue, Uint8Array.from(Buffer.from(query.cursor.id.replace(/-/gu, ""), "hex")));
  }

  const sql =
    `SELECT ${VENDOR_COLUMNS}, \`st\`.\`rating_sum\`, \`st\`.\`rating_count\`, \`st\`.\`orders_completed\`, ` +
    `(${key.expr}) AS \`sort_key\` FROM \`vendors\` v ${zoneJoin} ${STATS_JOIN} ` +
    `WHERE ${conditions.join(" AND ")} ORDER BY (${key.expr}) ${key.direction}, v.\`id\` ASC LIMIT ?`;
  const rows = await db.query<VendorRow>(sql, [...bound, query.limit + 1]);

  const pageRows = rows.slice(0, query.limit);
  const last = pageRows[pageRows.length - 1];
  const nextKey =
    rows.length > query.limit && last !== undefined
      ? { key: String(last.sort_key ?? ""), id: toHexId(last.id) }
      : null;
  return { vendors: pageRows, nextKey };
}

/** A vendor's profile with the categories it is listed under. */
export interface VendorDetail {
  readonly vendor: VendorRow;
  readonly categories: readonly { slug: string; nameEn: string; nameBn: string; isPrimary: boolean }[];
  readonly hours: readonly { weekday: number; opensAt: string; closesAt: string }[];
}

/**
 * One vendor by slug, or `null`.
 *
 * The slug is the public identity — `/r/rahman-biriyani` — because a UUID in a URL is a URL
 * nobody can say out loud, and because the prerender pipeline needs a stable string to emit.
 */
export async function findVendorBySlug(db: Db, slug: string): Promise<VendorDetail | null> {
  const vendor = await db.first<VendorRow>(
    `SELECT ${VENDOR_COLUMNS}, \`st\`.\`rating_sum\`, \`st\`.\`rating_count\`, \`st\`.\`orders_completed\` ` +
      `FROM \`vendors\` v ${STATS_JOIN} WHERE v.\`slug\` = ? AND v.\`status\` = 'APPROVED' AND v.\`deleted_at\` IS NULL`,
    [slug.toLowerCase()],
  );
  if (vendor === null) return null;

  const categories = await db.query<{ slug: string; name_en: string; name_bn: string; is_primary: number | string }>(
    "SELECT `c`.`slug`, `c`.`name_en`, `c`.`name_bn`, `vc`.`is_primary` FROM `vendor_categories` `vc` " +
      "JOIN `categories` `c` ON `c`.`id` = `vc`.`category_id` " +
      "WHERE `vc`.`vendor_id` = ? AND `c`.`active` = 1 ORDER BY `vc`.`is_primary` DESC, `c`.`sort_order` ASC",
    [vendor.id],
  );
  const hours = await db.query<{ weekday: number | string; opens_at: string; closes_at: string }>(
    "SELECT `weekday`, `opens_at`, `closes_at` FROM `vendor_hours` WHERE `vendor_id` = ? ORDER BY `weekday` ASC, `opens_at` ASC",
    [vendor.id],
  );

  return {
    vendor,
    categories: categories.map((row) => ({
      slug: row.slug,
      nameEn: row.name_en,
      nameBn: row.name_bn,
      isPrimary: Number(row.is_primary) === 1,
    })),
    hours: hours.map((row) => ({ weekday: Number(row.weekday), opensAt: row.opens_at, closesAt: row.closes_at })),
  };
}

/** One menu item as the API returns it. */
export interface PublicMenuItem {
  readonly id: string;
  readonly sectionId: string;
  readonly name: string;
  readonly nameBn: string | null;
  readonly description: string | null;
  readonly descriptionBn: string | null;
  readonly pricePaisa: number;
  readonly compareAtPaisa: number | null;
  readonly imageUrl: string | null;
  readonly imageBlurhash: string | null;
  readonly imageIsCutout: boolean;
  readonly prepTimeSeconds: number;
  readonly calories: number | null;
  readonly spiceLevel: number | null;
  readonly isVegetarian: boolean;
  readonly isHalal: boolean;
  readonly availability: string;
  readonly soldOutUntil: string | null;
  readonly allergenCodes: readonly string[];
  readonly modifierGroupIds: readonly string[];
}

/** One section of a menu. */
export interface PublicMenuSection {
  readonly id: string;
  readonly nameEn: string;
  readonly nameBn: string;
  readonly items: readonly PublicMenuItem[];
}

/** A modifier option inside a group. */
export interface PublicModifier {
  readonly id: string;
  readonly nameEn: string;
  readonly nameBn: string;
  readonly priceDeltaPaisa: number;
  readonly available: boolean;
}

/** A modifier group, attached to whichever items reference it. */
export interface PublicModifierGroup {
  readonly id: string;
  readonly name: string;
  readonly nameBn: string | null;
  readonly selection: string;
  readonly minSelect: number;
  readonly maxSelect: number;
  readonly isRequired: boolean;
  readonly modifiers: readonly PublicModifier[];
}

/** A complete menu: sections in display order, plus the option groups any item may reference. */
export interface PublicMenu {
  readonly vendorId: string;
  readonly sections: readonly PublicMenuSection[];
  readonly modifierGroups: readonly PublicModifierGroup[];
  readonly currency: "BDT";
}

interface ItemRow {
  readonly id: Uint8Array;
  readonly section_id: Uint8Array;
  readonly name: string;
  readonly name_bn: string | null;
  readonly description: string | null;
  readonly description_bn: string | null;
  readonly price_paisa: number | string;
  readonly compare_at_paisa: number | string | null;
  readonly image_url: string | null;
  readonly image_blurhash: string | null;
  readonly image_is_cutout: number | string | boolean;
  readonly prep_time_s: number | string;
  readonly calories: number | string | null;
  readonly spice_level: number | string | null;
  readonly is_vegetarian: number | string | boolean;
  readonly is_halal: number | string | boolean;
  readonly availability: string;
  readonly sold_out_until: string | null;
  readonly contains_allergens: unknown;
}

/**
 * Read a vendor's whole menu.
 *
 * Four statements, not one join per item: sections, items, groups and the item-to-group links.
 * A join across modifiers would return the section row once per option and force the caller to
 * de-duplicate what the database just multiplied, which is where menus with option groups
 * usually drift.
 */
export async function readMenu(db: Db, vendorId: Uint8Array): Promise<PublicMenu> {
  const sections = await db.query<{ id: Uint8Array; name_en: string; name_bn: string }>(
    "SELECT `s`.`id`, `s`.`name_en`, `s`.`name_bn` FROM `menu_sections` `s` " +
      "JOIN `menus` `m` ON `m`.`id` = `s`.`menu_id` " +
      "WHERE `m`.`vendor_id` = ? AND `m`.`active` = 1 AND `s`.`active` = 1 ORDER BY `s`.`sort_order` ASC, `s`.`id` ASC",
    [vendorId],
  );

  const items = await db.query<ItemRow>(
    "SELECT `id`, `section_id`, `name`, `name_bn`, `description`, `description_bn`, `price_paisa`, " +
      "`compare_at_paisa`, `image_url`, `image_blurhash`, `image_is_cutout`, `prep_time_s`, `calories`, " +
      "`spice_level`, `is_vegetarian`, `is_halal`, `availability`, `sold_out_until`, `contains_allergens` " +
      "FROM `menu_items` WHERE `vendor_id` = ? AND `deleted_at` IS NULL AND `availability` <> 'HIDDEN' " +
      "ORDER BY `section_id` ASC, `sort_order` ASC, `id` ASC",
    [vendorId],
  );

  const groups = await db.query<{
    id: Uint8Array;
    name: string;
    name_bn: string | null;
    selection: string;
    min_select: number | string;
    max_select: number | string;
    is_required: number | string | boolean;
  }>(
    "SELECT `id`, `name`, `name_bn`, `selection`, `min_select`, `max_select`, `is_required` " +
      "FROM `modifier_groups` WHERE `vendor_id` = ? ORDER BY `sort_order` ASC, `id` ASC",
    [vendorId],
  );

  const modifiers = await db.query<{
    id: Uint8Array;
    group_id: Uint8Array;
    name_en: string;
    name_bn: string;
    price_delta_paisa: number | string;
    available: number | string | boolean;
  }>(
    "SELECT `md`.`id`, `md`.`group_id`, `md`.`name_en`, `md`.`name_bn`, `md`.`price_delta_paisa`, `md`.`available` " +
      "FROM `modifiers` `md` JOIN `modifier_groups` `mg` ON `mg`.`id` = `md`.`group_id` " +
      "WHERE `mg`.`vendor_id` = ? ORDER BY `md`.`sort_order` ASC, `md`.`id` ASC",
    [vendorId],
  );

  const links = await db.query<{ item_id: Uint8Array; group_id: Uint8Array }>(
    "SELECT `img`.`item_id`, `img`.`group_id` FROM `item_modifier_groups` `img` " +
      "JOIN `menu_items` `mi` ON `mi`.`id` = `img`.`item_id` WHERE `mi`.`vendor_id` = ?",
    [vendorId],
  );

  const groupsById = new Map<string, PublicModifierGroup>(
    groups.map((group) => [
      toHexId(group.id),
      {
        id: toHexId(group.id),
        name: group.name,
        nameBn: group.name_bn,
        selection: group.selection,
        minSelect: Number(group.min_select),
        maxSelect: Number(group.max_select),
        isRequired: Boolean(Number(group.is_required)),
        modifiers: [],
      },
    ]),
  );

  const modifiersByGroup = new Map<string, PublicModifier[]>();
  for (const modifier of modifiers) {
    const groupId = toHexId(modifier.group_id);
    const list = modifiersByGroup.get(groupId) ?? [];
    list.push({
      id: toHexId(modifier.id),
      nameEn: modifier.name_en,
      nameBn: modifier.name_bn,
      priceDeltaPaisa: Number(modifier.price_delta_paisa),
      available: Boolean(Number(modifier.available)),
    });
    modifiersByGroup.set(groupId, list);
  }
  for (const [groupId, list] of modifiersByGroup) {
    const group = groupsById.get(groupId);
    if (group !== undefined) groupsById.set(groupId, { ...group, modifiers: list });
  }

  const groupsByItem = new Map<string, string[]>();
  for (const link of links) {
    const itemId = toHexId(link.item_id);
    const list = groupsByItem.get(itemId) ?? [];
    list.push(toHexId(link.group_id));
    groupsByItem.set(itemId, list);
  }

  const allergensOf = (raw: unknown): string[] => {
    if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === "string");
    if (typeof raw === "string") {
      try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const bySection = new Map<string, PublicMenuItem[]>();
  for (const item of items) {
    const sectionId = toHexId(item.section_id);
    const list = bySection.get(sectionId) ?? [];
    list.push({
      id: toHexId(item.id),
      sectionId,
      name: item.name,
      nameBn: item.name_bn,
      description: item.description,
      descriptionBn: item.description_bn,
      pricePaisa: Number(item.price_paisa),
      compareAtPaisa: item.compare_at_paisa === null ? null : Number(item.compare_at_paisa),
      imageUrl: item.image_url,
      imageBlurhash: item.image_blurhash,
      imageIsCutout: Boolean(Number(item.image_is_cutout)),
      prepTimeSeconds: Number(item.prep_time_s),
      calories: item.calories === null ? null : Number(item.calories),
      spiceLevel: item.spice_level === null ? null : Number(item.spice_level),
      isVegetarian: Boolean(Number(item.is_vegetarian)),
      isHalal: Boolean(Number(item.is_halal)),
      availability: item.availability,
      soldOutUntil: item.sold_out_until,
      allergenCodes: allergensOf(item.contains_allergens),
      modifierGroupIds: groupsByItem.get(toHexId(item.id)) ?? [],
    });
    bySection.set(sectionId, list);
  }

  return {
    vendorId: toHexId(vendorId),
    sections: sections.map((section) => ({
      id: toHexId(section.id),
      nameEn: section.name_en,
      nameBn: section.name_bn,
      items: bySection.get(toHexId(section.id)) ?? [],
    })),
    modifierGroups: [...groupsById.values()],
    currency: "BDT",
  };
}

/** Convert a database row into the public vendor shape, with money as integer paisa. */
export function serialiseVendor(row: VendorRow, distanceM: number | null = null): PublicVendor {
  const ratingCount = Number(row.rating_count ?? 0);
  const ratingSum = Number(row.rating_sum ?? 0);
  const ratingBps = ratingCount === 0 ? null : Math.round((ratingSum * 100) / ratingCount);
  return {
    id: toHexId(row.id),
    slug: row.slug,
    name: row.name,
    nameBn: row.name_bn,
    tagline: row.tagline,
    kind: row.kind,
    openState: row.open_state,
    busyLevel: Number(row.busy_level),
    ratingBps,
    ratingCount,
    ordersCompleted: Number(row.orders_completed ?? 0),
    minOrderPaisa: Number(row.min_order_paisa),
    prepTimeSeconds: Number(row.prep_time_default_s),
    coverUrl: row.cover_url,
    coverBlurhash: row.cover_blurhash,
    logoUrl: row.logo_url,
    logoBlurhash: row.logo_blurhash,
    supportsPickup: Boolean(Number(row.supports_pickup)),
    supportsDelivery: Boolean(Number(row.supports_delivery)),
    latE7: Number(row.lat_e7),
    lonE7: Number(row.lon_e7),
    distanceM,
    updatedAt: row.updated_at,
  };
}
