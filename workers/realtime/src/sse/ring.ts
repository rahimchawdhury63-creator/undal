/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The replay window behind a dropped connection (`08 §9`).
 *
 * A client that reconnects sends `Last-Event-ID`, and the hub answers from a ring of the last 200
 * events over five minutes. Inside that window the replay is exact and the client misses nothing;
 * outside it the hub must say so, because a client that silently receives a gap is a client showing a
 * stale order as if it were live. `Resume.complete` is that admission, and it is the reason the ring is
 * a class with a counter rather than a bounded array.
 */

import type { StreamFrame } from "./frame.ts";

/** How many events a channel keeps for replay. */
export const EVENT_RING_SIZE = 200;

/** How long an event stays replayable. */
export const EVENT_RING_WINDOW_MS = 300_000;

/** An event with the instant it was recorded, so the window can be enforced. */
export interface RingEvent extends StreamFrame {
  readonly atMs: number;
}

/** What a reconnect gets back. */
export interface Resume {
  readonly events: readonly RingEvent[];
  /** False when the requested cursor is older than anything the ring still holds. */
  readonly complete: boolean;
}

/**
 * A per-channel replay buffer.
 *
 * Both bounds apply: the ring holds at most `size` events, and drops anything older than `windowMs`.
 * Dropping by age is what makes a quiet channel small; dropping by size is what stops a burst from
 * holding a shift's worth of events in a Worker's memory.
 */
export class EventRing {
  private readonly size: number;
  private readonly windowMs: number;
  private events: RingEvent[] = [];
  /** The highest id ever evicted, so a resume older than it is known to be incomplete. */
  private evictedThrough = 0;
  /** The highest id ever recorded, so an empty ring can still answer a cursor. */
  private highestId = 0;

  constructor(size: number = EVENT_RING_SIZE, windowMs: number = EVENT_RING_WINDOW_MS) {
    if (!Number.isInteger(size) || size < 1) throw new RangeError(`not a ring size: ${String(size)}`);
    if (!Number.isFinite(windowMs) || windowMs < 1) throw new RangeError(`not a window: ${String(windowMs)}`);
    this.size = size;
    this.windowMs = windowMs;
  }

  /** Record an event. Events must arrive in id order; a duplicate id replaces the earlier copy. */
  push(event: RingEvent): void {
    const existing = this.events.findIndex((held) => held.id === event.id);
    if (existing >= 0) {
      this.events[existing] = event;
      return;
    }
    if (event.id <= this.evictedThrough) {
      throw new RangeError(`event ${String(event.id)} is older than what the ring still holds`);
    }
    this.events.push(event);
    this.highestId = Math.max(this.highestId, event.id);
    this.trim(event.atMs);
  }

  /** Drop everything that has aged out of the window. */
  trim(atMs: number): void {
    const cutoff = atMs - this.windowMs;
    while (this.events.length > 0 && (this.events[0] as RingEvent).atMs < cutoff) {
      const dropped = this.events.shift() as RingEvent;
      this.evictedThrough = Math.max(this.evictedThrough, dropped.id);
    }
    while (this.events.length > this.size) {
      const dropped = this.events.shift() as RingEvent;
      this.evictedThrough = Math.max(this.evictedThrough, dropped.id);
    }
  }

  /**
   * Everything after a cursor.
   *
   * A cursor that has been evicted returns the events the ring still holds with `complete: false`, so
   * the handler can replay the tail *and* tell the client to reconcile — better than either half on its
   * own.
   */
  since(lastEventId: number, atMs: number = this.highestAtMs()): Resume {
    if (!Number.isInteger(lastEventId) || lastEventId < 0) {
      throw new RangeError(`not an event id: ${String(lastEventId)}`);
    }
    this.trim(atMs);
    const events = this.events.filter((event) => event.id > lastEventId);
    const oldestHeld = this.events.length > 0 ? (this.events[0] as RingEvent).id : this.highestId + 1;
    const complete = lastEventId + 1 >= Math.min(oldestHeld, this.evictedThrough + 1);
    return { events, complete };
  }

  /** How many events are replayable right now. */
  length(): number {
    return this.events.length;
  }

  /** The highest id ever recorded. */
  lastId(): number {
    return this.highestId;
  }

  private highestAtMs(): number {
    return this.events.length === 0 ? 0 : (this.events[this.events.length - 1] as RingEvent).atMs;
  }
}
