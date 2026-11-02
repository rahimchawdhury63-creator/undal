/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The durable ring: one Durable Object per channel.
 *
 * A stream's replay has to survive the isolate that recorded it, and a Durable Object is the only storage
 * on this platform that is both strongly consistent and free of a cron. So each channel gets a room —
 * `stream:order:UND-7K2M9QX4`, `stream:zone:sylhet` — which holds its ring's snapshot and nothing else.
 * A room is tiny, idle rooms are evicted, and a resume is one round trip.
 *
 * The class is a plain class over `DurableObjectState`, like the coordination room, so the suite drives the
 * real code with in-memory storage instead of simulating it.
 */

import { EVENT_NAMES, catalogueName } from "./hub.ts";
import type { Channel } from "./channels.ts";
import { channelKey } from "./channels.ts";
import type { ChannelReplay } from "./hub.ts";
import type { RingEvent, RingSnapshot } from "./ring.ts";
import { EventRing } from "./ring.ts";
import type { Clock } from "../lib/clock.ts";
import { systemClock } from "../lib/clock.ts";
import type { FrameStore } from "./store.ts";

/** The storage key a channel's ring lives under. */
export const RING_KEY = "ring";

/** The RPC surface the room exposes: one object, two methods. */
interface RoomRequest {
  readonly method: StreamMethod;
  readonly args: readonly unknown[];
}

/** The two methods a stream room serves. */
export type StreamMethod = "record" | "replay";

/**
 * One channel's ring, in Durable Object storage.
 *
 * Requests are serialised by the runtime, and the room reads-modifies-writes its own key, so two broadcasts
 * that arrive together cannot both take the same next id. That is the same argument the coordination room
 * makes about claims; here it costs one storage write instead of a transaction.
 */
export class StreamRoom {
  private readonly storage: DurableObjectState["storage"];
  private readonly clock: Clock;

  constructor(state: DurableObjectState, clock: Clock = systemClock) {
    this.storage = state.storage;
    this.clock = clock;
  }

  /** The room's RPC: a method name and its arguments, nothing else. */
  async fetch(request: Request): Promise<Response> {
    let body: RoomRequest;
    try {
      body = (await request.json()) as RoomRequest;
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "not a room request" }), { status: 400 });
    }
    try {
      const data = await this.invoke(body.method, [...body.args]);
      return new Response(JSON.stringify({ ok: true, data }), {
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(JSON.stringify({ ok: false, error: message }), { status: 500 });
    }
  }

  /** Dispatch one method. Explicit, so a typo is a 500 in a test rather than a silent no-op. */
  private async invoke(method: string, args: unknown[]): Promise<unknown> {
    switch (method) {
      case "record":
        return this.record(args[0] as { kind: string; data: unknown; atMs: number; seq?: number });
      case "replay":
        return this.replay(args[0] as number | null, Number(args[1]));
      default:
        throw new RangeError(`unknown stream method: ${method}`);
    }
  }

  /** Record one event. An unknown kind is refused, not stored. */
  async record(event: { kind: string; data: unknown; atMs: number; seq?: number }): Promise<RingEvent | null> {
    const name = catalogueName(event.kind);
    if (name === null) return null;
    const ring = await this.load();
    const frame: RingEvent = { id: event.seq ?? ring.lastId() + 1, event: name, data: event.data, atMs: event.atMs };
    ring.push(frame);
    await this.save(ring);
    return frame;
  }

  /** Everything after a cursor, plus whether that is the whole of what was missed. */
  async replay(cursor: number | null, atMs: number): Promise<ChannelReplay> {
    if (cursor === null) return { frames: [], complete: true };
    const ring = await this.load();
    const resume = ring.since(cursor, atMs);
    return {
      frames: resume.events.map((event) => ({ id: event.id, event: event.event, data: event.data })),
      complete: resume.complete,
    };
  }

  /** Load the ring, pruned to the current window. */
  private async load(): Promise<EventRing> {
    const snapshot = await this.storage.get<RingSnapshot>(RING_KEY);
    const ring = EventRing.restore(snapshot ?? undefined);
    ring.trim(this.clock.nowMs());
    return ring;
  }

  private async save(ring: EventRing): Promise<void> {
    await this.storage.put(RING_KEY, ring.snapshot());
  }
}

/** The catalogue the durable store understands, for a test that asserts nothing extra was added. */
export const DURABLE_STORE_EVENTS = EVENT_NAMES;

/**
 * The frame store over a Durable Object namespace.
 *
 * One room per channel, addressed by `channelKey` so a channel's room name is its identity in logs too.
 */
export class DurableObjectFrameStore implements FrameStore {
  private readonly namespace: DurableObjectNamespace;
  private readonly clock: Clock;

  constructor(namespace: DurableObjectNamespace, clock: Clock = systemClock) {
    this.namespace = namespace;
    this.clock = clock;
  }

  async record(
    channel: Channel,
    event: { readonly kind: string; readonly data: unknown; readonly atMs: number; readonly seq?: number },
  ): Promise<ChannelReplay["frames"][number] | null> {
    const frame = await this.rpc<RingEvent | null>(channel, "record", [event]);
    return frame === null ? null : { id: frame.id, event: frame.event, data: frame.data };
  }

  replay(channel: Channel, cursor: number | null, atMs: number): Promise<ChannelReplay> {
    return this.rpc<ChannelReplay>(channel, "replay", [cursor, atMs]);
  }

  /** One RPC to a channel's room. */
  private async rpc<T>(channel: Channel, method: StreamMethod, args: readonly unknown[]): Promise<T> {
    const id = this.namespace.idFromName(`stream:${channelKey(channel)}`);
    const stub = this.namespace.get(id);
    const response = await stub.fetch("https://stream.room/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method, args } satisfies RoomRequest),
    });
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({ error: "no body" }))) as { error?: string };
      throw new Error(`stream ${method} failed: ${detail.error ?? response.status}`);
    }
    const body = (await response.json()) as { ok: boolean; data: T };
    return body.data;
  }
}
