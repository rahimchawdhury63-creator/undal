/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Replaying an order's stream from the log, not from a ring.
 *
 * A ring is a fast path that lives in one isolate: a broadcast answered by one Worker instance is
 * invisible to the next request, which is fine while a room holds the ring and useless once the router is
 * stateless. The order's event log is durable and already ordered, so the resume path reads it — the
 * client's `Last-Event-ID` is the `seq` it was last sent, and the page is everything after it.
 *
 * A full page means the client is far behind and got a tail rather than a history: `complete: false` there
 * is the same admission a ring makes when the cursor has been evicted, and the client's answer is the same
 * reconciling fetch.
 */

import type { Coordinator } from "../coordination/coordinator.ts";
import { EVENT_PAGE_LIMIT } from "../coordination/coordinator.ts";
import type { Channel } from "./channels.ts";
import type { ChannelReplay } from "./hub.ts";
import { catalogueName } from "./hub.ts";
import type { StreamFrame } from "./frame.ts";

/** The replay port a stream handler needs, whichever backing it uses. */
export interface ReplaySource {
  replay(channel: Channel, cursor: number | null): ChannelReplay | Promise<ChannelReplay>;
}

/**
 * Replay one order channel from the coordinator's log.
 *
 * A stored kind the catalogue does not carry is skipped rather than sent: the frame would be one the
 * client cannot decode, and the log may legitimately hold rows written before a kind was renamed.
 */
export async function replayOrder(
  coordinator: Coordinator,
  orderId: string,
  cursor: number | null,
  limit: number = EVENT_PAGE_LIMIT,
): Promise<ChannelReplay> {
  if (cursor === null) return { frames: [], complete: true };
  const events = await coordinator.readEvents(orderId, cursor, limit);
  const frames: StreamFrame[] = [];
  for (const event of events) {
    const name = catalogueName(event.kind);
    if (name === null) continue;
    frames.push({ id: event.seq, event: name, data: event.payload });
  }
  return { frames, complete: events.length < limit };
}

/** Collect the opening for a stream: one replay per channel, in the order the client asked. */
export async function collectReplay(
  source: ReplaySource,
  channels: readonly Channel[],
  cursor: number | null,
): Promise<readonly ChannelReplay[]> {
  const collected: ChannelReplay[] = [];
  for (const channel of channels) {
    collected.push(await source.replay(channel, cursor));
  }
  return collected;
}

/**
 * A replay source over the coordinator, for the `order:` channels.
 *
 * Any other channel is answered empty and complete, which is the honest answer: this source does not know
 * zone or admin streams, and a stream handler that needs them composes a second source rather than being
 * told a lie about them.
 */
export function orderLogReplay(coordinator: Coordinator, limit: number = EVENT_PAGE_LIMIT): ReplaySource {
  return {
    replay(channel, cursor) {
      if (channel.kind !== "order") return { frames: [], complete: true };
      return replayOrder(coordinator, channel.id, cursor, limit);
    },
  };
}
