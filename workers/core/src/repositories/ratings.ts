/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The rating rows a customer writes and factor 6 reads (`17 §8.1`, D137).
 *
 * The table has been in the schema since the first migration and had no writer, which is why `11 §5` factor 6 has been
 * answered with `rating: null` and D133's scoring module returns a plausible-looking zero. This module is the writer:
 * one row per `(order, target)`, which the table's own unique key enforces.
 *
 * The rider a `RIDER` rating is *about* is deliberately not stored. `order_ratings` has an `order_id` and a `target`
 * and no rider column — the schema settled that — so the join is `order_assignments` where `end_reason = 'DELIVERED'`.
 * That is the only record that says who actually handed the food over: `orders.rider_id` changes when an order is
 * reassigned, and a rating written three days ago must not follow the order to the rider who never carried it.
 */

import type { Db } from "../db/client.ts";
import { sqlDatetime } from "../db/time.ts";
import { newId, toHexId } from "../lib/ids.ts";
import { MAX_RATING_TAGS, type RatingDraft, type RatingTarget } from "../domain/order/rating.ts";

/** A rating as stored. `tags` is JSON in the column and an array here, because nothing else parses it. */
export interface StoredRating {
  readonly id: Uint8Array;
  readonly stars: number;
  readonly comment: string | null;
  readonly tags: readonly string[];
  readonly createdAt: string;
}

/** The columns every rating read returns, in one place so a reader and its test cannot disagree. */
const RATING_COLUMNS = "`id`, `stars`, `comment`, `tags`, `created_at`";

/** `tags` is JSON: a driver may hand back a string, an array, or null. */
function tagsOf(raw: unknown): readonly string[] {
  if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === "string").slice(0, MAX_RATING_TAGS);
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string").slice(0, MAX_RATING_TAGS)
      : [];
  } catch {
    return [];
  }
}

/** The rating this customer already left for this order and target, or `null`. */
export async function findRating(
  db: Db,
  orderId: Uint8Array,
  target: RatingTarget,
): Promise<StoredRating | null> {
  const row = await db.first<{ id: Uint8Array; stars: unknown; comment: unknown; tags: unknown; created_at: string }>(
    `SELECT ${RATING_COLUMNS} FROM \`order_ratings\` WHERE \`order_id\` = ? AND \`target\` = ?`,
    [orderId, target],
  );
  if (row === null) return null;
  return {
    id: row.id,
    stars: Number(row.stars),
    comment: typeof row.comment === "string" ? row.comment : null,
    tags: tagsOf(row.tags),
    createdAt: row.created_at,
  };
}

/**
 * Store the customer's rating, if they have not already left one for this target.
 *
 * **One rating per order**, which `27 §4` states as an anti-manipulation rule and the table enforces with
 * `uq_order_rating_target`. A second request is answered with what is stored rather than with an error: the customer's
 * answer exists, the request is satisfied, and inventing a refusal code for "you already said this" would mean the app
 * has to translate a state it can already see. Nothing is written on that path — no row, no audit entry — because a
 * write that changes nothing is noise in a chain that is supposed to be readable.
 *
 * Rejected: allowing a correction inside the window (`17 §8.1` offers "Skip", not "Edit", and a rating a vendor can
 * ask to have changed is not a rating), and a `DELETED`/`SUPERSEDED` second row (the stats would then have to filter,
 * and every reader would have to remember to).
 */
export async function writeRating(
  db: Db,
  orderId: Uint8Array,
  draft: RatingDraft,
  nowMs: number,
): Promise<{ readonly created: boolean; readonly id: Uint8Array; readonly stored: StoredRating | null }> {
  const existing = await findRating(db, orderId, draft.target);
  if (existing !== null) return { created: false, id: existing.id, stored: existing };
  const id = newId(nowMs);
  await db.execute(
    "INSERT INTO `order_ratings` (`id`, `order_id`, `target`, `stars`, `comment`, `tags`, `created_at`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, orderId, draft.target, draft.stars, draft.comment, JSON.stringify(draft.tags), sqlDatetime(new Date(nowMs))],
  );
  return { created: true, id, stored: null };
}

/** How one rider's delivery ratings tally, which is everything factor 6 needs (`11 §5`). */
export interface RatingTally {
  /** Ratings of four or five stars: the "good" count the Wilson bound is computed over. */
  readonly good: number;
  /** Every delivery rating this rider has. */
  readonly total: number;
}

/**
 * The rider's lifetime delivery ratings.
 *
 * Joined through `order_assignments` rather than `orders.rider_id` for the reason in the module comment, and bounded by
 * `LIMIT` only as a guard on a pathological history: factor 6 wants the whole record, and a rider with 5 000 deliveries
 * has a rating whose last ten rows change nothing. The bound is high enough that no honest rider reaches it.
 */
export async function riderTally(db: Db, riderId: Uint8Array, limit = 5_000): Promise<RatingTally> {
  const row = await db.first<{ good: unknown; total: unknown }>(
    "SELECT SUM(CASE WHEN `r`.`stars` >= 4 THEN 1 ELSE 0 END) AS `good`, COUNT(*) AS `total` " +
      "FROM `order_ratings` `r` JOIN `order_assignments` `a` ON `a`.`order_id` = `r`.`order_id` " +
      "WHERE `r`.`target` = 'RIDER' AND `a`.`rider_id` = ? AND `a`.`end_reason` = 'DELIVERED'",
    [riderId],
  );
  // A rider with no ratings gets `null` from `SUM` and `0` from `COUNT`, and both mean the same thing: no evidence.
  const total = row === null ? 0 : Number(row.total);
  const good = row === null || row.good === null ? 0 : Number(row.good);
  return {
    good: Number.isFinite(good) ? Math.max(0, Math.min(total, good)) : 0,
    total: Number.isFinite(total) ? Math.max(0, Math.min(limit, total)) : 0,
  };
}

/** The order code a rating belongs to, for the audit row that must not name a binary id. */
export function ratingSubject(orderCode: string, target: RatingTarget): string {
  return `${orderCode}:${target}`;
}

/** A rider id as hex, which is the form the dispatch loader keys candidates by. */
export function riderKey(riderId: Uint8Array): string {
  return toHexId(riderId);
}
