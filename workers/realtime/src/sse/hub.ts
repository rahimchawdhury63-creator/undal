/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * One ring per channel, and the mapping from an order event to a stream frame.
 *
 * The coordination layer stores an order's events as `PLACED`, `ACCEPTED`, `RIDER_ASSIGNED`; the
 * stream catalogue names them `order.placed`, `order.accepted`, `order.assigned`. That mapping is not
 * cosmetic — a client's handler is keyed by the catalogue name — so it is a table, not a
 * `toLowerCase()` call, and a stored kind with no catalogue entry is refused rather than sent as an
 * event the client will silently ignore.
 */

import type { Channel } from "./channels.ts";
import { channelKey } from "./channels.ts";
import type { RingEvent, Resume } from "./ring.ts";
import type { StreamFrame } from "./frame.ts";
import { EventRing } from "./ring.ts";

/**
 * The stored event kinds the stream understands, and the catalogue name each becomes.
 *
 * This is the subset the coordinator itself writes. The rest of `08 §9`'s catalogue is emitted by
 * other components through the same frame format, and those components name their own events.
 */
export const EVENT_NAMES: Readonly<Record<string, string>> = {
  PLACED: "order.placed",
  ACCEPTED: "order.accepted",
  REJECTED: "order.rejected",
  RIDER_ASSIGNED: "order.assigned",
  PICKED_UP: "order.picked_up",
  ARRIVED: "order.arrived",
  DELIVERED: "order.delivered",
  SETTLED: "order.settled",
  CANCELLED: "order.cancelled",
  AUTO_CANCELLED: "order.cancelled",
  REASSIGNING: "order.reassigning",
  PREP_TIME_CHANGED: "order.prep_time_changed",
  ETA_CHANGED: "order.eta_changed",
  ITEMS_CHANGED: "order.items_changed",
  DISPUTED: "order.disputed",
  SEARCHING: "order.searching",
};

/** The catalogue name for a stored kind, or `null` when the stream does not carry it. */
export function eventNameFor(kind: string): string | null {
  return EVENT_NAMES[kind] ?? null;
}

/**
 * The catalogue name for an event in either spelling.
 *
 * `undal-core`'s broadcast sends the catalogue name (`order.assigned`) while the coordinator stores the
 * kind (`RIDER_ASSIGNED`); both are legitimate inputs and both must land on the same frame name.
 */
export function catalogueName(name: string): string | null {
  const stored = EVENT_NAMES[name];
  if (stored !== undefined) return stored;
  return (Object.values(EVENT_NAMES) as readonly string[]).includes(name) ? name : null;
}

/** An event as the rings hold it, re-exported so a caller does not import two modules to name one. */
export type { RingEvent };

/** One channel's replay buffer. */
export interface ChannelReplay {
  readonly frames: readonly StreamFrame[];
  readonly complete: boolean;
}

/** A hub of rings, keyed by channel. */
export class StreamHub {
  private readonly rings = new Map<string, EventRing>();

  /** The ring for a channel, created on first use. */
  ring(channel: Channel): EventRing {
    const key = channelKey(channel);
    let ring = this.rings.get(key);
    if (ring === undefined) {
      ring = new EventRing();
      this.rings.set(key, ring);
    }
    return ring;
  }

  /**
   * Record an event on a channel.
   *
   * An order event whose kind the catalogue does not carry is dropped: sending it would produce a
   * frame the client cannot decode, which is worse than the event not arriving over this channel at
   * all — the client's reconciling fetch is still authoritative.
   */
  record(
    channel: Channel,
    event: { readonly kind: string; readonly data: unknown; readonly atMs: number; readonly seq?: number },
  ): RingEvent | null {
    const name = catalogueName(event.kind);
    if (name === null) return null;
    const ring = this.ring(channel);
    const frame: RingEvent = { id: event.seq ?? ring.lastId() + 1, event: name, data: event.data, atMs: event.atMs };
    ring.push(frame);
    return frame;
  }

  /** Replay after a cursor. `null` means the client is live and wants nothing bygone. */
  replay(channel: Channel, cursor: number | null, atMs: number): ChannelReplay {
    if (cursor === null) return { frames: [], complete: true };
    const resume: Resume = this.ring(channel).since(cursor, atMs);
    return {
      frames: resume.events.map((event) => ({ id: event.id, event: event.event, data: event.data })),
      complete: resume.complete,
    };
  }
}
