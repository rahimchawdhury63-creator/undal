/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The fan-out from `undal-core`'s broadcast to the channels that watch an order.
 *
 * Core calls `POST /internal/broadcast` with a zone, an order, an event name and a payload
 * (`workers/core/src/bindings/realtime.ts`). Three groups watch an order — the customer, the vendor and
 * the rider — plus admins watching the zone, so one broadcast becomes up to four channel records. The
 * fan-out is a pure function over the hub's rings: no I/O, no clock, and a test can assert exactly which
 * channels received what.
 */

import type { Channel } from "./channels.ts";
import type { RingEvent, StreamHub } from "./hub.ts";
import { catalogueName } from "./hub.ts";

/** What core sends. */
export interface BroadcastInput {
  readonly zoneId: string;
  readonly orderId: string;
  /** The catalogue name, e.g. `order.assigned`, or the stored kind it is derived from. */
  readonly event: string;
  readonly payload: unknown;
  /** The order's sequence number, when core has one; otherwise the ring assigns the next id. */
  readonly seq?: number;
  readonly atMs: number;
}

/** The channel an order's watchers subscribe to. */
export function orderChannel(orderId: string): Channel {
  return { kind: "order", id: orderId };
}

/** The channel a zone's admins subscribe to. */
export function zoneChannel(zoneId: string): Channel {
  return { kind: "zone", id: zoneId };
}

/** The channels a broadcast reaches. */
export function channelsFor(input: BroadcastInput): readonly Channel[] {
  return [orderChannel(input.orderId), zoneChannel(input.zoneId)];
}

/**
 * Record a broadcast on every channel that watches it.
 *
 * An event the catalogue does not carry is refused rather than sent: a client that cannot decode a frame
 * shows nothing, and a silent gap is worse than an error the caller can log.
 */
export function broadcast(
  hub: StreamHub,
  input: BroadcastInput,
): { readonly recorded: readonly RingEvent[]; readonly dropped: boolean } {
  const name = catalogueName(input.event);
  if (name === null) return { recorded: [], dropped: true };
  const recorded: RingEvent[] = [];
  for (const channel of channelsFor(input)) {
    const frame = hub.record(channel, {
      ...(input.seq === undefined ? {} : { seq: input.seq }),
      kind: input.event,
      data: input.payload,
      atMs: input.atMs,
    });
    if (frame !== null) recorded.push(frame);
  }
  return { recorded, dropped: false };
}
