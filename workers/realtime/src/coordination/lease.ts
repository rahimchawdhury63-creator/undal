/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Leases: the only reason a Worker that dies mid-claim does not strand an order forever.
 *
 * A dispatch claim is a race between riders, and the winner's claim is a row with an expiry rather
 * than a flag. Thirty seconds is the offer TTL plus a margin: long enough that the winner's app can
 * finish its own confirm dialog, short enough that a crashed coordinator costs one wave rather than
 * the evening.
 *
 * Nothing here reads a clock. A lease is a number, and every function that asks whether it has expired
 * is given the answer's date by its caller — which is what makes the expiry tests exact.
 */

/** The default lease on a dispatch claim: the 25 s offer TTL plus five seconds of margin. */
export const DISPATCH_LEASE_MS = 30_000;

/** A lease shorter than this cannot cover a network round trip and is a configuration bug. */
export const MIN_LEASE_MS = 5_000;

/** A lease longer than this outlives the cascade and would block the fallback ladder. */
export const MAX_LEASE_MS = 120_000;

/** A lease, as the instant it stops being valid. */
export interface Lease {
  readonly untilMs: number;
}

/** Clamp a configured TTL into the range the cascade can actually tolerate. */
export function clampLease(ttlMs: number): number {
  if (!Number.isFinite(ttlMs)) throw new RangeError(`not a lease: ${String(ttlMs)}`);
  return Math.min(MAX_LEASE_MS, Math.max(MIN_LEASE_MS, Math.round(ttlMs)));
}

/** A fresh lease, starting now. */
export function leaseFrom(atMs: number, ttlMs: number = DISPATCH_LEASE_MS): Lease {
  if (!Number.isFinite(atMs)) throw new RangeError(`not an instant: ${String(atMs)}`);
  return { untilMs: Math.round(atMs) + clampLease(ttlMs) };
}

/** Whether the lease has lapsed at `atMs`. A lease is valid through its expiry instant. */
export function leaseExpired(lease: Lease, atMs: number): boolean {
  return atMs > lease.untilMs;
}

/** How long is left, never negative — the number an admin panel shows beside a claim. */
export function leaseRemainingMs(lease: Lease, atMs: number): number {
  return Math.max(0, lease.untilMs - atMs);
}

/** Renew a lease from `atMs`, which is how a coordinator keeps a long-running claim. */
export function renewLease(lease: Lease, atMs: number, ttlMs: number = DISPATCH_LEASE_MS): Lease {
  return leaseFrom(Math.max(lease.untilMs - clampLease(ttlMs), atMs), ttlMs);
}
