/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The one timer a room owns (`14 §3.2`).
 *
 * A Durable Object has a single alarm, and the heartbeat doesn't need one per device: the earliest
 * deadline in the room is the only instant anything can change, so the alarm is set to that and the
 * sweep is `O(expired)` rather than `O(sessions)`. When the room empties, the alarm is cleared and the
 * object becomes a candidate for eviction — which is why this is allowed by the no-cron rule and a
 * cron job would not be.
 *
 * Nothing here reads a clock or touches storage. `nextAlarmAt` answers "what instant", `expiredAt`
 * answers "who", and the room does the setting.
 */

/** One device's deadline, as the room holds it. */
export interface DeadlineEntry {
  readonly actorId: string;
  readonly deviceId: string;
  /** The instant silence becomes absence: the last beat plus the deadline. */
  readonly deadlineMs: number;
}

/**
 * The instant the room's alarm should be set to, or `null` when there is nothing to wait for.
 *
 * Ties are broken by identity so the answer is deterministic: two devices that share a deadline must
 * not cause the room to re-arm on every sweep because it picked a different one each time.
 */
export function nextAlarmAt(entries: readonly DeadlineEntry[]): number | null {
  let best: DeadlineEntry | null = null;
  for (const entry of entries) {
    if (!Number.isFinite(entry.deadlineMs)) throw new RangeError(`not a deadline: ${String(entry.deadlineMs)}`);
    if (best === null || entry.deadlineMs < best.deadlineMs) best = entry;
    else if (entry.deadlineMs === best.deadlineMs && compare(entry, best) < 0) best = entry;
  }
  return best === null ? null : best.deadlineMs;
}

/**
 * Who is absent at an instant.
 *
 * Exactly on the deadline is still present — the contract says a device is gone *after* two seconds of
 * silence, and a sweep that fired a millisecond early would produce the one thing this system must
 * never do: an alert for a device that was answering.
 */
export function expiredAt(entries: readonly DeadlineEntry[], atMs: number): readonly DeadlineEntry[] {
  return entries
    .filter((entry) => atMs > entry.deadlineMs)
    .sort((left, right) => left.deadlineMs - right.deadlineMs || compare(left, right));
}

/**
 * Whether the room's alarm needs to move.
 *
 * Setting the same instant again is harmless but it is also a storage write on every heartbeat, so the
 * room only writes when the instant actually changes.
 */
export function shouldRearm(current: number | null, next: number | null): boolean {
  return current !== next;
}

/** A stable ordering for two entries with the same deadline. */
function compare(left: DeadlineEntry, right: DeadlineEntry): number {
  if (left.actorId !== right.actorId) return left.actorId < right.actorId ? -1 : 1;
  if (left.deviceId === right.deviceId) return 0;
  return left.deviceId < right.deviceId ? -1 : 1;
}
