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

/** A ring's state, in a shape storage can hold. */
export interface RingSnapshot {
  readonly events: readonly RingEvent[];
  readonly evictedThrough: number;
  readonly highestId: number;
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

  /**
   * Record an event. A duplicate id replaces the earlier copy.
   *
   * Arrival order is not id order and the ring does not pretend otherwise (D100): two requests for the same
   * order can be in flight at once, and the one carrying the higher sequence can be recorded first. Appending
   * such an event would break the two things every reader relies on — that `since` returns events in id order,
   * and that `trim` evicts oldest-id first — so a late event is **inserted where it belongs**. The live socket
   * that already received the higher id cannot be repaired after the fact; the replay window can, and it is the
   * one a client resuming from `Last-Event-ID` actually depends on.
   */
  push(event: RingEvent): void {
    const existing = this.events.findIndex((held) => held.id === event.id);
    if (existing >= 0) {
      this.events[existing] = event;
      return;
    }
    if (event.id <= this.evictedThrough) {
      throw new RangeError(`event ${String(event.id)} is older than what the ring still holds`);
    }
    const after = this.events.findIndex((held) => held.id > event.id);
    if (after < 0) this.events.push(event);
    else this.events.splice(after, 0, event);
    this.highestId = Math.max(this.highestId, event.id);
    this.trim(event.atMs);
  }

  /**
   * Drop everything that has aged out of the window, then everything past the size.
   *
   * Trimming filters rather than shifting the front, because a late event can carry an older timestamp than
   * the one before it in id order; a front-only loop would leave that event in place until the front overtook
   * it, which for a quiet channel is never.
   */
  trim(atMs: number): void {
    const cutoff = atMs - this.windowMs;
    this.retain((event) => event.atMs >= cutoff);
    while (this.events.length > this.size) {
      const dropped = this.events.shift() as RingEvent;
      this.evictedThrough = Math.max(this.evictedThrough, dropped.id);
    }
  }

  /** Keep the events a predicate accepts, remembering the highest id dropped. */
  private retain(keep: (event: RingEvent) => boolean): void {
    if (this.events.every(keep)) return;
    const kept: RingEvent[] = [];
    for (const event of this.events) {
      if (keep(event)) kept.push(event);
      else this.evictedThrough = Math.max(this.evictedThrough, event.id);
    }
    this.events = kept;
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
    // A cursor ahead of anything this ring has ever recorded is not a cursor this ring can answer. A fresh
    // isolate, an evicted room and a lost snapshot all look the same from here, and each of them means the
    // client's history went somewhere this channel cannot see. Saying `complete` would turn a lost stream
    // into a silence the customer reads as "nothing happened" (D100).
    if (lastEventId > this.highestId) return { events: [], complete: false };
    const events = this.events.filter((event) => event.id > lastEventId);
    const oldestHeld = this.events.length > 0 ? (this.events[0] as RingEvent).id : this.highestId + 1;
    const complete = lastEventId + 1 >= Math.min(oldestHeld, this.evictedThrough + 1);
    return { events, complete };
  }

  /** The state, for a room that persists its ring between requests. */
  snapshot(): RingSnapshot {
    return { events: [...this.events], evictedThrough: this.evictedThrough, highestId: this.highestId };
  }

  /**
   * Rebuild a ring from a snapshot.
   *
   * The counters come back with the events, which is the point: a restored ring that only remembered its
   * events would answer "complete" for a cursor it had already forgotten, and the client would be told a
   * silence was a gap it did not miss.
   */
  static restore(snapshot: RingSnapshot | undefined, size: number = EVENT_RING_SIZE, windowMs: number = EVENT_RING_WINDOW_MS): EventRing {
    const ring = new EventRing(size, windowMs);
    if (snapshot === undefined) return ring;
    ring.events = [...snapshot.events];
    ring.evictedThrough = snapshot.evictedThrough;
    ring.highestId = snapshot.highestId;
    return ring;
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
    let highest = 0;
    for (const event of this.events) highest = Math.max(highest, event.atMs);
    return highest;
  }
}
