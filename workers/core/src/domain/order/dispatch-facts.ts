/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Turning a rider's history into the fourteen factors' inputs (`11 §5`, D125–D129).
 *
 * These are the joins between what the platform records and what the scoring table expects, and they live outside the
 * route for the same reason the factors do: a rate that is wrong here is wrong in every dispatch, and a function is
 * the only shape that can be tested at its anchors. They are pure — history in, numbers out — except for the two that
 * read nothing at all.
 */

import { wilsonLowerBound } from "./scoring.ts";
import { idleSeconds, type RiderHistory } from "../../repositories/dispatch-stats.ts";

/** Midnight UTC of the day an instant falls in — `rider_stats.stat_date` is a `DATE`, so the day is the key. */
export function startOfDayMs(atMs: number): number {
  const date = new Date(atMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Factor 3's rate: the Wilson bound of lifetime acceptance, zero with no history. */
export function acceptanceFrom(past: RiderHistory | undefined): number {
  if (past === undefined) return 0;
  return wilsonLowerBound(past.offersAcceptedLifetime, past.offersSentLifetime);
}

/**
 * Factor 4's two rates, both Wilson-bounded from what the platform records.
 *
 * Completion is deliveries over lifetime accepted offers; on-time has no recorded outcome yet, so it takes the same
 * figure rather than a guess — a rider who accepts and does not deliver looks unreliable, which is exactly what the
 * factor is for, and there is no separate lateness signal to use until penalties feed scoring (D126).
 */
export function ratesFrom(past: RiderHistory | undefined): { readonly completion: number; readonly onTime: number } {
  if (past === undefined) return { completion: 0, onTime: 0 };
  const completion = wilsonLowerBound(past.deliveredLifetime, past.offersAcceptedLifetime);
  return { completion, onTime: completion };
}

/**
 * Factor 6's rate: the Wilson bound of four- and five-star delivery ratings (`09 §2`, `11 §5`, D137).
 *
 * The bound is what stops one five-star rating from outranking a rider with four hundred of them — the same arithmetic
 * factor 3 and 4 use, on the same scale. A rider nobody has rated scores zero, which reads as "no evidence" rather
 * than as an average one; the alternative (a neutral 0.5) would quietly reward a rider who has never delivered.
 */
export function ratingFrom(past: RiderHistory | undefined): number {
  if (past === undefined || past.rating === null) return 0;
  return wilsonLowerBound(past.rating.good, past.rating.total);
}

/** A rider's idle time in seconds, or zero when nothing is recorded. */
export function idleFrom(past: RiderHistory | undefined, nowMs: number): number {
  return past === undefined ? 0 : idleSeconds(past, nowMs);
}

/**
 * The zone's median deliveries today, from the candidates actually in play.
 *
 * Computed from the wave's own riders rather than from a zone figure, because there is no per-zone today's count
 * stored: the median of the riders being considered is the comparison `fairness` needs, and it is the same number the
 * benchmark's `zone_median_today` stands in for.
 */
export function medianDeliveries(history: ReadonlyMap<string, RiderHistory>): number {
  const counts = [...history.values()].map((entry) => entry.deliveriesToday).sort((a, b) => a - b);
  if (counts.length === 0) return 0;
  const middle = Math.floor(counts.length / 2);
  return counts.length % 2 === 0 ? ((counts[middle - 1] ?? 0) + (counts[middle] ?? 0)) / 2 : (counts[middle] ?? 0);
}

/** The hex form of a binary id, which is how every map and set in dispatch is keyed. */
export function hexOf(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}
