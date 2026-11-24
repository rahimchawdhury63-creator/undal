/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * Zones, as an operator reads them.
 *
 * A zone is the unit the platform delivers in: it decides which kitchens a customer sees, which
 * riders may be offered an order, and — once paused — whether the area can be ordered from at all.
 * So the list carries the two counts a reviewer reasons with before touching the switch. A zone
 * with 180 kitchens and no rider is a staffing problem; a zone with no kitchens is not a zone yet.
 *
 * No cursor, deliberately. A country has tens of zones, not tens of thousands, and the whole list
 * fits one screen; keyset paging here would be ceremony that a caller can get wrong. The limit is
 * bounded so a runaway client cannot ask for the table twice over.
 */

import type { Db } from "../db/client.ts";

/** The statuses a zone can hold. */
export const ZONE_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "RETIRED"] as const;

/** One of the four. */
export type ZoneStatus = (typeof ZONE_STATUSES)[number];

/** Whether a string is a zone status. */
export function isZoneStatus(value: unknown): value is ZoneStatus {
  return typeof value === "string" && (ZONE_STATUSES as readonly string[]).includes(value);
}

/**
 * The columns the operator list shows.
 *
 * The two counts are correlated subqueries rather than joins so that a zone with no vendors still
 * appears with a zero instead of vanishing — a `LEFT JOIN` plus `GROUP BY` would work too, but this
 * keeps the statement one line per zone and readable in a log.
 */
export const ADMIN_ZONE_COLUMNS =
  "`z`.`id`, `z`.`code`, `z`.`name`, `z`.`name_bn`, `z`.`city`, `z`.`country`, `z`.`currency`, " +
  "`z`.`timezone`, `z`.`status`, `z`.`area_sq_km`, `z`.`polygon_version`, `z`.`centroid_lat_e7`, " +
  "`z`.`centroid_lon_e7`, `z`.`created_at`, `z`.`updated_at`, " +
  "(SELECT COUNT(*) FROM `vendors` `v` WHERE `v`.`zone_id` = `z`.`id` AND `v`.`status` = 'APPROVED') AS `vendor_count`, " +
  "(SELECT COUNT(*) FROM `riders` `r` WHERE `r`.`home_zone_id` = `z`.`id` AND `r`.`status` = 'APPROVED') AS `rider_count`";

/** One zone row, with the counts the operator needs. */
export interface AdminZoneRow {
  readonly id: Uint8Array;
  readonly code: string;
  readonly name: string;
  readonly name_bn: string;
  readonly city: string;
  readonly country: string;
  readonly currency: string;
  readonly timezone: string;
  readonly status: string;
  readonly area_sq_km: number | string;
  readonly polygon_version: number | string;
  readonly centroid_lat_e7: number | string;
  readonly centroid_lon_e7: number | string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly vendor_count: number | string;
  readonly rider_count: number | string;
}

/** The polygon, on its own, because it is far too big to travel with a list row. */
export interface ZonePolygonRow {
  readonly polygon: unknown;
  readonly polygon_version: number | string;
}

/** What an operator may narrow the list by. */
export interface AdminZoneFilter {
  readonly status: ZoneStatus | null;
  readonly q: string | null;
  readonly limit: number;
}

/** Escape the wildcards a caller could type into a search box. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}

/** The zones, alphabetically by code, filtered. */
export async function listAdminZones(db: Db, filter: AdminZoneFilter): Promise<AdminZoneRow[]> {
  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];
  if (filter.status !== null) {
    where.push("`z`.`status` = ?");
    params.push(filter.status);
  }
  if (filter.q !== null && filter.q.trim() !== "") {
    where.push("(`z`.`code` LIKE ? OR `z`.`name` LIKE ? OR `z`.`name_bn` LIKE ? OR `z`.`city` LIKE ?)");
    const pattern = `%${escapeLike(filter.q.trim())}%`;
    params.push(pattern, pattern, pattern, pattern);
  }
  params.push(filter.limit);
  return db.query<AdminZoneRow>(
    `SELECT ${ADMIN_ZONE_COLUMNS} FROM \`zones\` \`z\` WHERE ${where.join(" AND ")} ORDER BY \`z\`.\`code\` ASC LIMIT ?`,
    params,
  );
}

/** One zone, by id. `null` when it does not exist. */
export async function findAdminZone(db: Db, id: Uint8Array): Promise<AdminZoneRow | null> {
  return db.first<AdminZoneRow>(`SELECT ${ADMIN_ZONE_COLUMNS} FROM \`zones\` \`z\` WHERE \`z\`.\`id\` = ? LIMIT 1`, [id]);
}

/**
 * The shape of a zone, for the screen that draws it.
 *
 * Read separately from the row: a polygon is a few hundred coordinates, and a list of forty zones
 * that each carried one would be a megabyte of JSON nobody looks at.
 */
export async function findZonePolygon(db: Db, id: Uint8Array): Promise<ZonePolygonRow | null> {
  return db.first<ZonePolygonRow>("SELECT `polygon`, `polygon_version` FROM `zones` WHERE `id` = ? LIMIT 1", [id]);
}

/**
 * How many orders in this zone are still moving.
 *
 * Pausing is refused while any of them are alive: a customer who has already paid would watch a
 * kitchen stop cooking an order the platform accepted, and the zone switch is not a reason the
 * support tower can explain to them.
 */
export async function countLiveOrdersInZone(db: Db, id: Uint8Array): Promise<number> {
  const row = await db.first<{ live: number | string }>(
    "SELECT COUNT(*) AS `live` FROM `orders` WHERE `zone_id` = ? " +
      "AND `status` NOT IN ('DELIVERED','SETTLED','CANCELLED')",
    [id],
  );
  return row === null ? 0 : Number(row.live);
}

/**
 * Move a zone from one status to another, but only if it is still in the status that was read.
 *
 * The guard is the point: two operators closing and reopening an area at the same time must not
 * both win, and the loser is told to look again rather than overwriting a decision it never saw.
 */
export async function setZoneStatus(
  db: Db,
  id: Uint8Array,
  from: ZoneStatus,
  to: ZoneStatus,
  updatedAtSql: string,
): Promise<number> {
  const result = await db.execute("UPDATE `zones` SET `status` = ?, `updated_at` = ? WHERE `id` = ? AND `status` = ?", [
    to,
    updatedAtSql,
    id,
    from,
  ]);
  return result.affectedRows;
}
