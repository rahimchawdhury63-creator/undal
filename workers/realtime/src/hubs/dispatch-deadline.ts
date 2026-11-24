/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * When a zone room should wake for an offer it has just announced (`11 §7`, D132).
 *
 * D130 closed the dispatch loop inside the zone alarm, and left one hole: the alarm belongs to a room that only exists
 * while that zone has sockets, so an order in a quiet zone had no tick. The gap is closed by the announcement itself —
 * core broadcasts the wave to the zone room, and a broadcast is a request, so the room exists for at least that
 * moment. What it needs is a reason to be alive later, and an offer is one: it expires in twenty-five seconds.
 *
 * **Two instants per wave, not one.** The expiry is the obvious one; the *retry* is the one that matters more. A push
 * that failed has to be re-sent while the offer is still live (D131), which is seconds after the wave, not half a
 * minute — and a room whose alarm is set only to the expiry would never run a retry pass in a quiet zone.
 *
 * Both are deliberately generous: `EXPIRE_SLACK_MS` past the deadline, because the expiry is a comparison against the
 * database's clock and waking a millisecond early would find the offer still live and expire nothing.
 */

/** How long after a wave's announcement the retry pass is worth a wake. Three seconds: past `RETRY_AFTER_MS`. */
export const RETRY_WAKE_MS = 3_000;

/** How far past an offer's expiry the room wakes, so the sweep's `expires_at <= now` is certainly true. */
export const EXPIRE_SLACK_MS = 1_000;

/** The furthest ahead a wake may be armed. An offer lives twenty-five seconds; five minutes is a bad clock, not an offer. */
export const MAX_WAKE_HORIZON_MS = 300_000;

/** The `expiresAtMs` an announcement carries, or `null` when it does not carry a usable one. */
function offerExpiry(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as { expiresAtMs?: unknown }).expiresAtMs;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The instants a room must wake for, from a broadcast's payload and the moment it was sent.
 *
 * An announcement that carries no offer deadline — an order state change, a cancellation, a chat message — is not a
 * dispatch deadline and answers `[]`. The forward that calls this then does nothing at all, which is what keeps a busy
 * room's alarm from being re-armed by traffic that has nothing to expire.
 */
export function dispatchInstants(payload: unknown, atMs: number): readonly number[] {
  const expiresAtMs = offerExpiry(payload);
  if (expiresAtMs === null) return [];
  const horizonEnd = atMs + MAX_WAKE_HORIZON_MS;
  if (expiresAtMs <= atMs || expiresAtMs > horizonEnd) return [];
  const instants = new Set<number>();
  const retryAt = atMs + RETRY_WAKE_MS;
  // A wave can be announced after its own retry window — a re-send, a late push — and a retry instant at or past the
  // expiry is a wake whose only work would be the expiry itself.
  if (retryAt < expiresAtMs) instants.add(retryAt);
  instants.add(expiresAtMs + EXPIRE_SLACK_MS);
  return [...instants].sort((left, right) => left - right);
}
