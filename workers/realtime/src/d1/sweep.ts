/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The fifth erasure trigger: the sweep that notices a device which will never ask (`07 §6.1`, D107).
 *
 * `§6.1`'s table names five ways a rider's live location is deleted and, until now, four existed. The fifth —
 * *app uninstalled / token invalid, next zone sweep, under 60 s* — had nothing to run it, and it is the one
 * whose caller can never arrive: an uninstalled app does not send an end-shift request, and a revoked token
 * cannot authenticate one. The row it leaves behind is a `rider_current` row nothing refreshes, which is also
 * the largest thing the platform keeps that no user asked it to keep.
 *
 * **The sweep reads time, not people.** `rider_current.stale_after` is `updated_at + 2 × ceiling` and it is
 * computed on every flush, so "expired more than a minute ago" is already the platform's own answer to "this
 * marker is not live". Nothing here counts heartbeats, joins presence or asks D1 for the connection table: a row
 * past its own deadline by a grace minute is a row whose owner cannot be reached, by definition rather than by
 * inference.
 *
 * **The grace minute is the whole design.** A sweep that ran at `stale_after` exactly would race the flush that
 * is in flight — a phone on a bad connection retries at 30 s intervals and its marker is "stale" between
 * attempts. One minute is four retries at D91's ceiling, and §6.1 promises the deletion *under* 60 s from the
 * next sweep, not under 60 s from the moment the phone died.
 *
 * **A failed sweep is reported, not retried.** The room's alarm has presence deadlines to publish in the same
 * tick, and those are the promises with a five-second budget. This one is already the slow path — the rider has
 * been gone a minute — so a D1 error is logged and the next alarm tries again, thirty seconds later at worst.
 *
 * Ordering inside the alarm matters and is why this is a function rather than three lines in the Durable
 * Object: the presence sweep runs **first**, so an absence published in this tick erases its own rider before
 * the sweep looks, and a sweep can never be the thing that reports a rider gone when the room knew it.
 */

import type { PositionStore, Swept } from "./store.ts";

/** How long past its own deadline a row must be before the sweep treats its owner as gone. */
export const SWEEP_GRACE_MS = 60_000;

/** What the alarm needs, as two functions, so the ordering can be tested without a Durable Object. */
export interface ZoneAlarmDeps {
  /** The presence sweep: publish the absences this tick has earned. Runs first; its answer is not the sweep's. */
  presence(nowMs: number): Promise<unknown>;
  /** The D1 sweep, or `null` when this deployment has no live-position database. */
  sweep: ((cutoffMs: number) => Promise<Swept>) | null;
  /** How a sweep that removed rows is reported, so an operator sees a phone that died rather than a quiet zero. */
  report(swept: Swept, cutoffMs: number): void;
  /** How a sweep that failed is reported. A failure is not a throw (see above). */
  reportError(error: unknown): void;
}

/**
 * One alarm tick: presence first, then the sweep.
 *
 * The presence sweep's failure is the caller's — an absence that cannot be published is a live problem with a
 * five-second budget, and swallowing it here would hide it behind a deletion that is allowed to be late.
 */
export async function runZoneAlarm(deps: ZoneAlarmDeps, nowMs: number): Promise<void> {
  await deps.presence(nowMs);
  if (deps.sweep === null) return;
  const cutoffMs = nowMs - SWEEP_GRACE_MS;
  try {
    const swept = await deps.sweep(cutoffMs);
    if (swept.riders > 0) deps.report(swept, cutoffMs);
  } catch (error) {
    deps.reportError(error);
  }
}
