/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The configuration register, read.
 *
 * `platform_config` is append-only in practice: a row is a key, a zone and the moment it took
 * effect, and the current value is the newest row for that pair. That shape is what makes a
 * dispatch weight reconstructable six weeks later — "what model was running when this order was
 * scored" is a question with an answer only because the old rows were never overwritten.
 *
 * So this reader answers "what is running now", and it answers it with a grouping rather than a
 * limit-per-key loop: one statement, one row per key and zone, newest `effective_at` wins.
 */

import type { Db } from "../db/client.ts";

/** One current configuration row. */
export interface ConfigRow {
  readonly key: string;
  readonly zone_id: Uint8Array;
  readonly value: unknown;
  readonly version: string;
  readonly effective_at: string;
  readonly reason: string;
}

/** What a reader may narrow the register by. */
export interface ConfigFilter {
  readonly prefix: string | null;
  readonly zoneId: Uint8Array | null;
  readonly limit: number;
}

/** Escape the wildcards a caller could type into a search box. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}

/**
 * The newest row for every key and zone, alphabetically.
 *
 * The self-join is deliberate rather than a correlated subquery: TiDB plans this as one index
 * range scan per group over the primary key `(key, zone_id, effective_at)`, where a coroutine per
 * row would scan the same index once for every key at the table's scale.
 */
export async function listCurrentConfig(db: Db, filter: ConfigFilter): Promise<ConfigRow[]> {
  const where: string[] = ["1 = 1"];
  const params: unknown[] = [];
  if (filter.prefix !== null && filter.prefix !== "") {
    where.push("`c`.`key` LIKE ?");
    params.push(`${escapeLike(filter.prefix)}%`);
  }
  if (filter.zoneId !== null) {
    where.push("`c`.`zone_id` = ?");
    params.push(filter.zoneId);
  }
  params.push(filter.limit);

  return db.query<ConfigRow>(
    "SELECT `c`.`key`, `c`.`zone_id`, `c`.`value`, `c`.`version`, `c`.`effective_at`, `c`.`reason` " +
      "FROM `platform_config` `c` JOIN (" +
      "SELECT `key` AS `k`, `zone_id` AS `z`, MAX(`effective_at`) AS `latest` FROM `platform_config` " +
      "GROUP BY `key`, `zone_id`) `m` " +
      "ON `m`.`k` = `c`.`key` AND `m`.`z` = `c`.`zone_id` AND `m`.`latest` = `c`.`effective_at` " +
      `WHERE ${where.join(" AND ")} ORDER BY \`c\`.\`key\` ASC, \`c\`.\`zone_id\` ASC LIMIT ?`,
    params,
  );
}

/** How many distinct keys the register holds, so a screen can say "showing 100 of 240". */
export async function countConfigKeys(db: Db): Promise<number> {
  const row = await db.first<{ total: number | string }>(
    "SELECT COUNT(DISTINCT `key`) AS `total` FROM `platform_config`",
  );
  return row === null ? 0 : Number(row.total);
}
