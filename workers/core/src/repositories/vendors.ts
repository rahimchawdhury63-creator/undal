/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * Vendor rows, for the people who run the platform rather than the people who eat from it.
 *
 * This is a different reader from `catalogue.ts`, and deliberately a different query: the public
 * catalogue may only ever see an `APPROVED`, undeleted kitchen, while an operator has to see the
 * drafts waiting for review and the ones suspended last month. Mixing the two readers into one
 * function is how a suspended kitchen leaks into a search result, so they stay apart even though
 * both end up selecting from the same table.
 */

import type { Db } from "../db/client.ts";

/** The columns an operator's list and detail both show. */
export const ADMIN_VENDOR_COLUMNS =
  "v.`id`, v.`kind`, v.`slug`, v.`name`, v.`name_bn`, v.`tagline`, v.`phone`, v.`zone_id`, " +
  "v.`status`, v.`open_state`, v.`busy_level`, v.`paused_until`, v.`pause_reason`, " +
  "v.`commission_bps`, v.`created_at`, v.`updated_at`, v.`deleted_at`";

/** One vendor row as the database holds it. */
export interface AdminVendorRow {
  readonly id: Uint8Array;
  readonly kind: string;
  readonly slug: string;
  readonly name: string;
  readonly name_bn: string | null;
  readonly tagline: string | null;
  readonly phone: string;
  readonly zone_id: Uint8Array;
  readonly status: string;
  readonly open_state: string;
  readonly busy_level: number | string;
  readonly paused_until: string | null;
  readonly pause_reason: string | null;
  readonly commission_bps: number | string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

/** The statuses a vendor can be in, in the order the onboarding flow moves them. */
export const VENDOR_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "NEEDS_INFO",
  "APPROVED",
  "SUSPENDED",
  "REJECTED",
  "RETIRED",
] as const;

/** One of the eight. */
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

/** Whether a string is one of the eight, for a query that arrives as `string`. */
export function isVendorStatus(value: unknown): value is VendorStatus {
  return typeof value === "string" && (VENDOR_STATUSES as readonly string[]).includes(value);
}

/** What an operator may narrow the list by. */
export interface AdminVendorFilter {
  readonly status: VendorStatus | null;
  readonly q: string | null;
  readonly zoneId: Uint8Array | null;
  readonly cursor: { readonly createdAt: string; readonly id: Uint8Array } | null;
  readonly limit: number;
}

/** Escape the wildcards a caller could type into a search box. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}

/**
 * One page of vendors, newest first.
 *
 * Keyset rather than `OFFSET`: a vendor approved while somebody is paging must not shift the list
 * under them, and ties on `created_at` are broken by id so the order is total.
 */
export async function listAdminVendors(db: Db, filter: AdminVendorFilter): Promise<AdminVendorRow[]> {
  const where: string[] = ["v.`deleted_at` IS NULL"];
  const params: unknown[] = [];

  if (filter.status !== null) {
    where.push("v.`status` = ?");
    params.push(filter.status);
  }
  if (filter.q !== null && filter.q.trim() !== "") {
    where.push("(v.`name` LIKE ? OR v.`name_bn` LIKE ? OR v.`slug` LIKE ? OR v.`phone` LIKE ?)");
    const pattern = `%${escapeLike(filter.q.trim())}%`;
    params.push(pattern, pattern, pattern, pattern);
  }
  if (filter.zoneId !== null) {
    where.push("v.`zone_id` = ?");
    params.push(filter.zoneId);
  }
  if (filter.cursor !== null) {
    where.push("(v.`created_at` < ? OR (v.`created_at` = ? AND v.`id` < ?))");
    params.push(filter.cursor.createdAt, filter.cursor.createdAt, filter.cursor.id);
  }

  params.push(filter.limit);
  return db.query<AdminVendorRow>(
    `SELECT ${ADMIN_VENDOR_COLUMNS} FROM \`vendors\` v WHERE ${where.join(" AND ")} ` +
      "ORDER BY v.`created_at` DESC, v.`id` DESC LIMIT ?",
    params,
  );
}

/** One vendor by id, including the ones a customer may never see. */
export async function findAdminVendor(db: Db, id: Uint8Array): Promise<AdminVendorRow | null> {
  return db.first<AdminVendorRow>(
    `SELECT ${ADMIN_VENDOR_COLUMNS} FROM \`vendors\` v WHERE v.\`id\` = ? AND v.\`deleted_at\` IS NULL`,
    [id],
  );
}

/**
 * Pause a vendor until a known moment.
 *
 * A pause carries its own end, because an indefinite pause is indistinguishable from a suspension
 * to everybody downstream: the catalogue hides the kitchen either way, and only one of the two is
 * something the owner can clear by waiting. The reason travels with it so the partner app can say
 * why the switch is off.
 */
export async function pauseVendor(db: Db, id: Uint8Array, pausedUntil: string, reason: string): Promise<number> {
  const result = await db.execute(
    "UPDATE `vendors` SET `open_state` = 'PAUSED', `paused_until` = ?, `pause_reason` = ?, `updated_at` = ? " +
      "WHERE `id` = ? AND `status` = 'APPROVED' AND `deleted_at` IS NULL",
    [pausedUntil, reason, new Date().toISOString().slice(0, 19).replace("T", " "), id],
  );
  return result.affectedRows;
}

/** Clear a pause: the kitchen becomes open again and the reason is forgotten. */
export async function resumeVendor(db: Db, id: Uint8Array): Promise<number> {
  const result = await db.execute(
    "UPDATE `vendors` SET `open_state` = 'OPEN', `paused_until` = NULL, `pause_reason` = NULL, `updated_at` = ? " +
      "WHERE `id` = ? AND `deleted_at` IS NULL",
    [new Date().toISOString().slice(0, 19).replace("T", " "), id],
  );
  return result.affectedRows;
}
