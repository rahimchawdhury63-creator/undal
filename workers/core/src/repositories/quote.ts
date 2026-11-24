/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../db/client.ts";
import type { MenuEntry, ModifierEntry, PromoRule } from "../domain/order/cart.ts";

/**
 * The four reads a quote needs, and nothing else.
 *
 * A quote touches the vendor (is it open, where is it, how far will it deliver), the menu (what do
 * these items cost *now*), the modifiers (what do these choices add) and the zone (what multiplier is
 * published). Each is one statement against one index; the pricing itself is pure and lives in
 * `domain/order/cart.ts` and `pricing/`, which is why this file has no arithmetic in it at all.
 */

/** The vendor columns a quote is allowed to depend on. */
export interface QuoteVendorRow {
  readonly id: Uint8Array;
  readonly zone_id: Uint8Array;
  readonly name: string;
  readonly status: string;
  readonly open_state: string;
  readonly lat_e7: number | string;
  readonly lon_e7: number | string;
  readonly min_order_paisa: number | string;
  readonly max_delivery_m: number | string;
  readonly deleted_at: string | null;
}

const VENDOR_COLUMNS = "`id`, `zone_id`, `name`, `status`, `open_state`, `lat_e7`, `lon_e7`, `min_order_paisa`, `max_delivery_m`, `deleted_at`";

/** The vendor behind a cart, or null when there is no such vendor. */
export async function findVendorForQuote(db: Db, vendorId: Uint8Array): Promise<QuoteVendorRow | null> {
  return db.first<QuoteVendorRow>(`SELECT ${VENDOR_COLUMNS} FROM \`vendors\` WHERE \`id\` = ? LIMIT 1`, [vendorId]);
}

/** A menu row as the quote reads it. Availability is a column, never an assumption. */
interface MenuRow {
  readonly id: Uint8Array;
  readonly name: string;
  readonly name_bn: string | null;
  readonly price_paisa: number | string;
  readonly availability: string;
  readonly prep_time_s: number | string;
  readonly deleted_at: string | null;
  readonly vendor_id: Uint8Array;
}

/**
 * The menu entries for a set of item ids, keyed by hex id.
 *
 * One statement with an `IN` list rather than a query per line: a twenty-line cart would otherwise
 * be twenty round trips inside a 400 ms budget. Items belonging to another vendor are filtered by
 * the caller, not here — this module reports what exists, and the route decides what a cart may
 * contain.
 */
export async function findMenuEntries(db: Db, itemIds: readonly Uint8Array[]): Promise<Map<string, MenuEntry & { vendorId: string }>> {
  const keyed = new Map<string, MenuEntry & { vendorId: string }>();
  if (itemIds.length === 0) return keyed;

  const placeholders = itemIds.map(() => "?").join(", ");
  const rows = await db.query<MenuRow>(
    "SELECT `id`, `name`, `name_bn`, `price_paisa`, `availability`, `prep_time_s`, `deleted_at`, `vendor_id` " +
      `FROM \`menu_items\` WHERE \`id\` IN (${placeholders})`,
    itemIds,
  );

  for (const row of rows) {
    const hex = hexOf(row.id);
    keyed.set(hex, {
      itemId: hex,
      nameEn: row.name,
      nameBn: row.name_bn ?? row.name,
      pricePaisa: Number(row.price_paisa),
      // Only `AVAILABLE` is orderable; `PAUSED` and `SOLD_OUT` both refuse, with different codes.
      available: row.availability === "AVAILABLE" && row.deleted_at === null,
      prepTimeS: Number(row.prep_time_s),
      vendorId: hexOf(row.vendor_id),
    });
  }
  return keyed;
}

/** A modifier row as the quote reads it. */
interface ModifierRow {
  readonly id: Uint8Array;
  readonly group_id: Uint8Array;
  readonly price_delta_paisa: number | string;
  readonly available: number | string;
}

/** The modifier choices for a cart, keyed by hex id. */
export async function findModifiers(db: Db, modifierIds: readonly Uint8Array[]): Promise<Map<string, ModifierEntry>> {
  const keyed = new Map<string, ModifierEntry>();
  if (modifierIds.length === 0) return keyed;

  const placeholders = modifierIds.map(() => "?").join(", ");
  const rows = await db.query<ModifierRow>(
    `SELECT \`id\`, \`group_id\`, \`price_delta_paisa\`, \`available\` FROM \`modifiers\` WHERE \`id\` IN (${placeholders})`,
    modifierIds,
  );
  for (const row of rows) {
    const hex = hexOf(row.id);
    keyed.set(hex, {
      modifierId: hex,
      groupId: hexOf(row.group_id),
      priceDeltaPaisa: Number(row.price_delta_paisa),
      available: Number(row.available) === 1,
    });
  }
  return keyed;
}

/** A promotion row, before the date and scope checks the route applies. */
interface PromoRow {
  readonly code: string;
  readonly kind: "PERCENT" | "FLAT" | "FREE_DELIVERY";
  readonly value_bps: number | string | null;
  readonly value_paisa: number | string | null;
  readonly min_subtotal_paisa: number | string;
  readonly max_discount_paisa: number | string | null;
  readonly active: number | string;
  readonly starts_at: string;
  readonly ends_at: string | null;
}

/** A promotion that is live right now, or null. */
export async function findLivePromo(db: Db, code: string, nowSql: string): Promise<PromoRule | null> {
  const row = await db.first<PromoRow>(
    "SELECT `code`, `kind`, `value_bps`, `value_paisa`, `min_subtotal_paisa`, `max_discount_paisa`, `active`, `starts_at`, `ends_at` " +
      "FROM `promo_codes` WHERE `code` = ? LIMIT 1",
    [code],
  );
  if (row === null || Number(row.active) !== 1) return null;
  // The window is compared in SQL's own format rather than as parsed dates: both sides come from
  // the same column type, so a timezone bug cannot make a promotion live for one worker.
  if (row.starts_at > nowSql) return null;
  if (row.ends_at !== null && row.ends_at <= nowSql) return null;

  return {
    code: row.code,
    kind: row.kind,
    valueBps: row.value_bps === null ? null : Number(row.value_bps),
    valuePaisa: row.value_paisa === null ? null : Number(row.value_paisa),
    minSubtotalPaisa: Number(row.min_subtotal_paisa),
    maxDiscountPaisa: row.max_discount_paisa === null ? null : Number(row.max_discount_paisa),
  };
}

/** The published multiplier for a zone and vehicle, and the card it was published with. */
export interface ZonePricingRow {
  readonly base_fare_paisa: number | string;
  readonly base_distance_m: number | string;
  readonly per_km_paisa: number | string;
  readonly max_radius_m: number | string;
  readonly min_payout_paisa: number | string;
  readonly surge_cap_bps: number | string;
}

/** The rate card in force for a zone and vehicle, or null when the zone has none yet. */
export async function findZonePricing(db: Db, zoneId: Uint8Array, vehicle: "MOTORBIKE" | "BICYCLE"): Promise<ZonePricingRow | null> {
  return db.first<ZonePricingRow>(
    "SELECT `base_fare_paisa`, `base_distance_m`, `per_km_paisa`, `max_radius_m`, `min_payout_paisa`, `surge_cap_bps` " +
      "FROM `zone_pricing` WHERE `zone_id` = ? AND `vehicle` = ? AND `effective_to` IS NULL " +
      "ORDER BY `effective_from` DESC LIMIT 1",
    [zoneId, vehicle],
  );
}

/** Bytes to lowercase hex, the shape the domain speaks. */
function hexOf(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}
