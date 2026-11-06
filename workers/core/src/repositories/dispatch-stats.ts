/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The history a rider is scored on (`11 §5` factors 3–8, D125).
 *
 * `RiderSnapshot` says what a rider *is* right now — approved, online, carrying, within their vehicle's radius. None
 * of that ranks them against each other. What ranks them is history: how often they accept, how reliably they finish,
 * how they are rated, whether they know this vendor's back door, how long they have been idle, and how much they have
 * already done today. This module reads exactly that and nothing else.
 *
 * **Four or five statements, whatever the wave size.** Every query takes the whole candidate list as an `IN` list, because
 * the alternative — a rider at a time — is the same mistake the candidate feed avoided (D117) and would put sixty
 * round trips inside a twenty-five-second wave.
 *
 * **The rating tally arrived with the sheet that writes it (D137).** Factor 6 wants the Wilson bound of four- and
 * five-star delivery ratings, and for most of the build there was nothing to read: the table existed and no route wrote
 * it. `POST /v1/orders/{id}/rate` now does, and the fourth statement counts them per candidate. The join is
 * `order_assignments` where `end_reason = 'DELIVERED'`, not `orders.rider_id` — the latter is the *current* rider, and
 * a rating must follow the rider who actually carried the food.
 *
 * **The delivery cell is the schema's own arithmetic (D139).** `orders.delivery_cell` is a generated column over the
 * delivery coordinates — the same `44920`/`49520` cell `addresses` and `vendors` use — so factor 8's count is an
 * indexed `GROUP BY` on a column MySQL maintains, and the formula exists once in the database rather than once per
 * caller. The cell being asked about is computed by the same expression inside the query, for the same reason: a
 * TypeScript copy of the divisor is a second place for the two to drift. A `PICKUP` order has no delivery point, so the
 * statement is not run at all and every candidate scores zero — no evidence, not zero evidence.
 */

import type { Db } from "../db/client.ts";
import { sqlDatetime } from "../db/time.ts";

/** One rider's history, as far as the platform records it. */
export interface RiderHistory {
  /** Deliveries recorded in `rider_stats` for the day being scored. */
  readonly deliveriesToday: number;
  readonly offersSentToday: number;
  readonly offersAcceptedToday: number;
  /** Lifetime offers sent and accepted, for factor 3's Wilson-bounded rate. */
  readonly offersSentLifetime: number;
  readonly offersAcceptedLifetime: number;
  /** Deliveries completed for this order's vendor, for factor 7. */
  readonly deliveredFromVendor: number;
  /** Deliveries completed in total, which is what a completion rate would be computed against. */
  readonly deliveredLifetime: number;
  /** When the rider last delivered, or `null` if never — the base of `idle_s`. */
  readonly lastDeliveredAtMs: number | null;
  /** Deliveries this rider has completed into the cell being dispatched into (`11 §5` factor 8, D139). */
  readonly deliveriesIntoCell: number;
  /**
   * Delivery ratings: how many were four or five stars, out of how many (`11 §5` factor 6, D137).
   *
   * `null` means nobody has rated this rider — which is the first shift, not an error — and the caller prices that as a
   * Wilson bound of zero rather than as a middling 0.5.
   */
  readonly rating: { readonly good: number; readonly total: number } | null;
}

/** What a history read needs. */
export interface HistoryQuery {
  readonly riderIds: readonly Uint8Array[];
  /** The order's vendor, for factor 7. */
  readonly vendorId: Uint8Array;
  /** The instant being scored, and the start of the local day it falls in. */
  readonly nowMs: number;
  readonly dayStartMs: number;
  /**
   * Where the food is going, in E7, or `null` for an order with no delivery point.
   *
   * The cell is not passed pre-computed: the query derives it with the schema's own expression, so this module never
   * holds a second copy of the grid.
   */
  readonly delivery: { readonly latE7: number; readonly lonE7: number } | null;
}

const EMPTY: RiderHistory = Object.freeze({
  deliveriesToday: 0,
  offersSentToday: 0,
  offersAcceptedToday: 0,
  offersSentLifetime: 0,
  offersAcceptedLifetime: 0,
  deliveredFromVendor: 0,
  deliveredLifetime: 0,
  lastDeliveredAtMs: null,
  deliveriesIntoCell: 0,
  rating: null,
});

function hex(value: unknown): string {
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  return String(value ?? "").toLowerCase();
}

function placeholders(count: number): string {
  return new Array(count).fill("?").join(", ");
}

/** Today's row from `rider_stats`, one per rider. */
const SELECT_TODAY = `SELECT \`rider_id\` AS \`rider_id\`, \`deliveries\` AS \`deliveries\`,
    \`offers_sent\` AS \`offers_sent\`, \`offers_accepted\` AS \`offers_accepted\`
  FROM \`rider_stats\` WHERE \`rider_id\` IN (IDS) AND \`stat_date\` = ?`;

/** Lifetime offer counts, summed across every day the rider has. */
const SELECT_LIFETIME_OFFERS = `SELECT \`rider_id\` AS \`rider_id\`, SUM(\`offers_sent\`) AS \`sent\`,
    SUM(\`offers_accepted\`) AS \`accepted\`
  FROM \`rider_stats\` WHERE \`rider_id\` IN (IDS) GROUP BY \`rider_id\``;

/**
 * Deliveries, split by whether they were for this vendor, with the most recent one.
 *
 * `DELIVERED` and `SETTLED` both count: settlement is bookkeeping after the food arrived, and a rider should not lose
 * familiarity credit because the money has not reconciled yet.
 */
const SELECT_DELIVERIES = `SELECT \`rider_id\` AS \`rider_id\`, COUNT(*) AS \`delivered\`,
    SUM(CASE WHEN \`vendor_id\` = ? THEN 1 ELSE 0 END) AS \`from_vendor\`, MAX(\`delivered_at\`) AS \`last_delivered\`
  FROM \`orders\` WHERE \`rider_id\` IN (IDS) AND \`state\` IN ('DELIVERED', 'SETTLED') AND \`delivered_at\` IS NOT NULL
  GROUP BY \`rider_id\``;

/**
 * Deliveries into the cell the order is going to, per candidate (`11 §5` factor 8, D139).
 *
 * The `WHERE` clause carries the schema's cell expression rather than a pre-computed number, so the query and the
 * generated column cannot disagree about where the grid's edges are. `DELIVERED` and `SETTLED` both count, as they do
 * for factor 7: settlement is bookkeeping after the food arrived.
 */
const SELECT_CELL_DELIVERIES = `SELECT \`rider_id\` AS \`rider_id\`, COUNT(*) AS \`delivered\`
  FROM \`orders\`
  WHERE \`rider_id\` IN (IDS) AND \`state\` IN ('DELIVERED', 'SETTLED')
    AND \`delivery_cell\` = FLOOR(? / 44920) * 1000000 + FLOOR(? / 49520)
  GROUP BY \`rider_id\``;

/**
 * The delivery ratings behind factor 6, per candidate.
 *
 * Both numbers matter: the Wilson bound of eight good ratings out of ten is not the bound of eighty out of a hundred,
 * and a single five-star rating is priced as inexperience rather than as perfection. `SUM` returns `NULL` for a rider
 * with no rows, which is why the merge treats it as zero rather than as `NaN`.
 */
const SELECT_RATINGS = `SELECT \`a\`.\`rider_id\` AS \`rider_id\`, SUM(CASE WHEN \`r\`.\`stars\` >= 4 THEN 1 ELSE 0 END) AS \`good\`,
    COUNT(*) AS \`total\`
  FROM \`order_ratings\` \`r\` JOIN \`order_assignments\` \`a\` ON \`a\`.\`order_id\` = \`r\`.\`order_id\`
  WHERE \`r\`.\`target\` = 'RIDER' AND \`a\`.\`rider_id\` IN (IDS) AND \`a\`.\`end_reason\` = 'DELIVERED'
  GROUP BY \`a\`.\`rider_id\``;

/**
 * Read every candidate's history.
 *
 * A rider with no `rider_stats` row and no deliveries gets `EMPTY`, which is not a failure: a rider on their first
 * shift has no history, and every factor that needs one scores zero for them. That is a real disadvantage for new
 * riders and it is deliberately visible rather than padded with a hopeful default — factor 5 (`fairness`) gives a new
 * rider the full load term precisely because they have delivered nothing today.
 */
export async function riderHistory(db: Db, query: HistoryQuery): Promise<ReadonlyMap<string, RiderHistory>> {
  const out = new Map<string, RiderHistory>();
  if (query.riderIds.length === 0) return out;

  const ids = placeholders(query.riderIds.length);
  const day = sqlDatetime(new Date(query.dayStartMs));

  // A pickup order has no delivery point, so there is no cell to be familiar with and no statement to run.
  const cell =
    query.delivery === null
      ? Promise.resolve([] as Record<string, unknown>[])
      : db.query<Record<string, unknown>>(SELECT_CELL_DELIVERIES.replace("IDS", ids), [
          ...query.riderIds,
          query.delivery.latE7,
          query.delivery.lonE7,
        ]);

  const [today, lifetimeOffers, deliveries, ratings, intoCell] = await Promise.all([
    db.query<Record<string, unknown>>(SELECT_TODAY.replace("IDS", ids), [...query.riderIds, day]),
    db.query<Record<string, unknown>>(SELECT_LIFETIME_OFFERS.replace("IDS", ids), [...query.riderIds]),
    db.query<Record<string, unknown>>(SELECT_DELIVERIES.replace("IDS", ids), [query.vendorId, ...query.riderIds]),
    db.query<Record<string, unknown>>(SELECT_RATINGS.replace("IDS", ids), [...query.riderIds]),
    cell,
  ]);

  const merge = (riderId: string): RiderHistory => out.get(riderId) ?? EMPTY;

  for (const row of today) {
    const riderId = hex(row["rider_id"]);
    out.set(riderId, {
      ...merge(riderId),
      deliveriesToday: Number(row["deliveries"] ?? 0),
      offersSentToday: Number(row["offers_sent"] ?? 0),
      offersAcceptedToday: Number(row["offers_accepted"] ?? 0),
    });
  }
  for (const row of lifetimeOffers) {
    const riderId = hex(row["rider_id"]);
    out.set(riderId, {
      ...merge(riderId),
      offersSentLifetime: Number(row["sent"] ?? 0),
      offersAcceptedLifetime: Number(row["accepted"] ?? 0),
    });
  }
  for (const row of deliveries) {
    const riderId = hex(row["rider_id"]);
    const last = row["last_delivered"];
    const lastDeliveredAtMs =
      last === null || last === undefined ? null : new Date(String(last).replace(" ", "T") + "Z").getTime();
    out.set(riderId, {
      ...merge(riderId),
      deliveredLifetime: Number(row["delivered"] ?? 0),
      deliveredFromVendor: Number(row["from_vendor"] ?? 0),
      lastDeliveredAtMs: Number.isFinite(lastDeliveredAtMs) ? lastDeliveredAtMs : null,
    });
  }
  for (const row of intoCell) {
    const riderId = hex(row["rider_id"]);
    out.set(riderId, { ...merge(riderId), deliveriesIntoCell: Number(row["delivered"] ?? 0) });
  }
  for (const row of ratings) {
    const riderId = hex(row["rider_id"]);
    const total = Number(row["total"] ?? 0);
    const good = row["good"] === null || row["good"] === undefined ? 0 : Number(row["good"]);
    out.set(riderId, {
      ...merge(riderId),
      rating: { good: Number.isFinite(good) ? good : 0, total: Number.isFinite(total) ? total : 0 },
    });
  }
  return out;
}

/** How long a rider has been idle, in seconds, from their last delivery — capped so a stale id never overflows. */
export function idleSeconds(history: RiderHistory, nowMs: number): number {
  if (history.lastDeliveredAtMs === null) return 0;
  const seconds = Math.floor((nowMs - history.lastDeliveredAtMs) / 1000);
  return seconds > 0 ? Math.min(seconds, 86_400) : 0;
}
