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
import type { RingEvent } from "./hub.ts";
import { catalogueName } from "./hub.ts";
import type { FrameStore } from "./store.ts";

/** What core sends. */
export interface BroadcastInput {
  readonly zoneId: string;
  readonly orderId: string;
  /** The catalogue name, e.g. `order.assigned`, or the stored kind it is derived from. */
  readonly event: string;
  readonly payload: unknown;
  /**
   * The order's log sequence, when core has one.
   *
   * It is an **order-scoped** fact and it is applied to the order's channel only: copying it onto the zone
   * channel would make two orders' events share an id there, and the ring replaces a duplicate id rather than
   * refusing it — so the admin map would silently lose one of them (D101).
   */
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
export async function broadcast(
  store: FrameStore,
  input: BroadcastInput,
): Promise<{ readonly recorded: readonly { readonly id: number; readonly event: string }[]; readonly dropped: boolean }> {
  if (catalogueName(input.event) === null) return { recorded: [], dropped: true };
  const recorded: { id: number; event: string }[] = [];
  for (const channel of channelsFor(input)) {
    // A sequence belongs to the channel that owns it. `order:` channels are one order, whose log sequence is
    // exactly the id a resuming client should quote; `zone:` channels carry every order in the zone, where the
    // same per-order numbers repeat and the ring would treat the second order's frame as a replacement for the
    // first. The zone's frames are numbered by its own ring (D101).
    const seq = channel.kind === "order" ? input.seq : undefined;
    const frame = await store.record(channel, {
      ...(seq === undefined ? {} : { seq }),
      kind: input.event,
      data: input.payload,
      atMs: input.atMs,
    });
    if (frame !== null) recorded.push({ id: frame.id, event: frame.event });
  }
  return { recorded, dropped: false };
}

/** The channels a broadcast reaches, as data a test can assert without a store. */
export type BroadcastChannels = ReturnType<typeof channelsFor>;
