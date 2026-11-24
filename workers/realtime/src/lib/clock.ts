/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The realtime worker's clock.
 *
 * Every deadline in this worker — a 2 000 ms heartbeat, a 1 500 ms reconnect grace, a 25 s offer,
 * a 30 s claim lease — is arithmetic on `nowMs`. Passing the clock in rather than reading `Date`
 * inside a handler is what lets the presence tests advance time by two seconds and assert absence
 * without sleeping for two seconds.
 */

/** Milliseconds in a second, named so the deadlines read as arithmetic rather than magic. */
export const SECOND_MS = 1_000;

/** The clock, as everything in this worker sees it. */
export interface Clock {
  /** Milliseconds since the Unix epoch, UTC. */
  nowMs(): number;
}

/** The production clock. The only `Date.now()` in the coordination layer. */
export const systemClock: Clock = {
  nowMs: (): number => Date.now(),
};

/**
 * A clock a test can move.
 *
 * It starts at the instant it is given and only moves when told to, so 1 000 simulated losses cost a
 * millisecond rather than thirty-three real minutes.
 */
export class FixedClock implements Clock {
  private ms: number;

  constructor(startMs: number = 1_700_000_000_000) {
    this.ms = startMs;
  }

  nowMs(): number {
    return this.ms;
  }

  /** Move the clock forward (or backward, if a test is checking a clock that went wrong). */
  advance(deltaMs: number): void {
    if (!Number.isFinite(deltaMs)) throw new RangeError(`not a duration: ${String(deltaMs)}`);
    this.ms += deltaMs;
  }

  /** Jump to an absolute instant. */
  set(atMs: number): void {
    this.ms = atMs;
  }
}

/** ISO-8601 UTC, the only timestamp format the platform stores or emits. */
export function toIso(atMs: number): string {
  return new Date(atMs).toISOString();
}

/** Parse an ISO-8601 timestamp from a client, refusing anything that is not a real instant. */
export function fromIso(iso: string): number {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) throw new RangeError(`not an ISO timestamp: ${iso}`);
  return parsed;
}
