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
 * **Three statements, whatever the wave size.** Every query takes the whole candidate list as an `IN` list, because
 * the alternative — a rider at a time — is the same mistake the candidate feed avoided (D117) and would put sixty
 * round trips inside a twenty-five-second wave.
 *
 * **Two figures the schema cannot supply, stated rather than invented.** `orders` carries no delivery-cell column, so
 * `area_familiarity` (`11 §5` factor 8) has no input: the caller scores it zero, which is the honest value for "no
 * evidence about this cell". There is also no ratings table, so `rating` has no history either; the loader returns
 * `null` and the caller treats it as a Wilson bound of zero. Both are recorded as gaps in `DECISIONS.md` — a factor
 * fed a zero because the evidence does not exist is different from a factor fed a zero because nobody wrote the query,
 * and only one of them is a bug.
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
  /** Rated deliveries and their star total, or `null` when the schema has no ratings (see the module note). */
  readonly rating: { readonly count: number; readonly starsTimesTen: number } | null;
}

/** What a history read needs. */
export interface HistoryQuery {
  readonly riderIds: readonly Uint8Array[];
  /** The order's vendor, for factor 7. */
  readonly vendorId: Uint8Array;
  /** The instant being scored, and the start of the local day it falls in. */
  readonly nowMs: number;
  readonly dayStartMs: number;
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

  const [today, lifetimeOffers, deliveries] = await Promise.all([
    db.query<Record<string, unknown>>(SELECT_TODAY.replace("IDS", ids), [...query.riderIds, day]),
    db.query<Record<string, unknown>>(SELECT_LIFETIME_OFFERS.replace("IDS", ids), [...query.riderIds]),
    db.query<Record<string, unknown>>(SELECT_DELIVERIES.replace("IDS", ids), [query.vendorId, ...query.riderIds]),
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
  return out;
}

/** How long a rider has been idle, in seconds, from their last delivery — capped so a stale id never overflows. */
export function idleSeconds(history: RiderHistory, nowMs: number): number {
  if (history.lastDeliveredAtMs === null) return 0;
  const seconds = Math.floor((nowMs - history.lastDeliveredAtMs) / 1000);
  return seconds > 0 ? Math.min(seconds, 86_400) : 0;
}
