/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Where a channel's ring lives.
 *
 * A ring in a Worker's memory is forgotten when the isolate goes, so a broadcast answered by one request
 * is invisible to the next — which is why `/internal/broadcast` refuses until this port has a durable
 * implementation. The port is a port so the in-memory hub stays usable as a fast path and as a test double,
 * and so the durable implementation can be a Durable Object without the fan-out code knowing that.
 */

import type { Channel } from "./channels.ts";
import type { StreamHub } from "./hub.ts";
import type { ChannelReplay } from "./hub.ts";

/** A durable record of what each channel broadcast, for replay. */
export interface FrameStore {
  /** Record an event; `null` when the catalogue does not carry its kind. */
  record(
    channel: Channel,
    event: { readonly kind: string; readonly data: unknown; readonly atMs: number; readonly seq?: number },
  ): Promise<ChannelReplay["frames"][number] | null>;
  /** Everything after a cursor, and whether that is everything the client missed. */
  replay(channel: Channel, cursor: number | null, atMs: number): Promise<ChannelReplay>;
}

/**
 * The in-isolate store: good for one request, and for tests.
 *
 * It is deliberately the same shape as the durable one so a suite can run against both and catch a
 * divergence — the failure this port exists to prevent is the two implementations disagreeing about
 * whether a resume was complete.
 */
export class MemoryFrameStore implements FrameStore {
  private readonly hub: StreamHub;

  constructor(hub: StreamHub) {
    this.hub = hub;
  }

  async record(
    channel: Channel,
    event: { readonly kind: string; readonly data: unknown; readonly atMs: number; readonly seq?: number },
  ): Promise<ChannelReplay["frames"][number] | null> {
    const frame = this.hub.record(channel, event);
    return frame === null ? null : { id: frame.id, event: frame.event, data: frame.data };
  }

  async replay(channel: Channel, cursor: number | null, atMs: number): Promise<ChannelReplay> {
    return this.hub.replay(channel, cursor, atMs);
  }
}
