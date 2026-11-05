/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The streaming response itself: replay what was missed, then hold the connection open.
 *
 * An SSE response is one long body, so everything that matters happens in three moments — the first
 * flush (the replay), every twenty seconds (a keepalive), and cancellation (the client went away).
 * Each of those is a place a Worker can leak a timer, so the interval is created here, owned by this
 * function, and cleared by the stream's own `cancel` and `close`. The scheduler is injected because a
 * test that waits twenty real seconds is a test nobody runs.
 *
 * When the replay cannot be complete — the cursor is older than the ring — the stream says so in a
 * comment rather than pretending. A client that reads a comment can react; a client that receives a
 * silent gap cannot.
 */

import type { Channel } from "./channels.ts";
import { channelKey } from "./channels.ts";
import type { ChannelReplay } from "./hub.ts";
import { KEEPALIVE_INTERVAL_MS, formatComment, formatFrame, formatKeepalive, streamHeaders } from "./frame.ts";

/** How often an open stream asks its source for new frames (D103). */
export const TAIL_INTERVAL_MS = 1_000;

/** What a stream needs to start. */
export interface StreamOptions {
  readonly requestId: string;
  readonly channels: readonly Channel[];
  /** The client's cursor, or `null` for "start from now". */
  readonly lastEventId: number | null;
  /**
   * What to send before the connection goes live, one entry per channel and in the same order.
   *
   * The replay is fetched by the caller, not here: a source backed by the order log is a query, and a
   * streaming response that starts a query has to either buffer or interleave. The route awaits the
   * replay first, then hands the response a value it can write synchronously.
   */
  readonly replays: readonly ChannelReplay[];
  /**
   * Where new frames come from while the connection is open (D103).
   *
   * Without it the stream is a replay followed by keepalives: a client that connects during an order's quiet
   * minute never learns that it was accepted, because nothing pulls the events recorded after the response
   * began. A tail is asked once per `tailEveryMs` per channel, with that channel's own cursor, and the ansate
   * must be the same `ChannelReplay` a resume would get — which is what makes the ring's ordering (D100) and
   * the channel's own numbering (D101) sufficient for live delivery too.
   */
  readonly tail?: (channel: Channel, cursor: number | null) => ChannelReplay | Promise<ChannelReplay>;
  /** How often the tail is pulled. The keepalive is derived from it, so one timer does both. */
  readonly tailEveryMs?: number;
  /** A scheduler for the tick; the default is a real interval. Returns the stop function. */
  readonly schedule?: (emit: () => void) => () => void;
  readonly keepaliveMs?: number;
}

/** The comment that admits a gap. */
export const RECONCILE_COMMENT = "gap: reconcile with a full fetch";

/** The default scheduler: one interval, cleared when the stream ends. */
function realScheduler(intervalMs: number): (emit: () => void) => () => void {
  return (emit) => {
    const handle = setInterval(emit, intervalMs);
    return () => {
      clearInterval(handle);
    };
  };
}

/**
 * Build the response.
 *
 * The body is pulled, not pushed: nothing is generated until the consumer asks. That is what keeps a
 * stalled client from filling memory with keepalives, and it makes the first chunk the replay, which is
 * the order the protocol expects.
 */
export function streamResponse(options: StreamOptions): Response {
  const intervalMs = options.keepaliveMs ?? KEEPALIVE_INTERVAL_MS;
  const schedule = options.schedule ?? realScheduler(intervalMs);
  const encoder = new TextEncoder();
  let stop: (() => void) | null = null;
  let closed = false;

  const opening: string[] = [];
  for (const replay of options.replays) {
    if (!replay.complete) opening.push(formatComment(RECONCILE_COMMENT));
    for (const frame of replay.frames) opening.push(formatFrame(frame));
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (text: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // The consumer went away between the pull and the enqueue; nothing to do but stop.
          closed = true;
          stop?.();
        }
      };
      // One flush, not one per frame: the replay is a single write, so a client that reconnects is
      // caught up in one round trip instead of one per missed event.
      if (opening.length > 0) push(opening.join(""));

      const tail = options.tail;
      if (tail === undefined) {
        stop = schedule(() => push(formatKeepalive()));
        return;
      }

      // One cursor per channel: two channels of one stream number their frames independently (D101), so a
      // single cursor would skip or repeat a frame on whichever channel moved second.
      const cursors = new Map<string, number | null>();
      for (const channel of options.channels) cursors.set(channelKey(channel), options.lastEventId);
      // A gap is admitted once per episode. Repeating the comment on every tick would be a stream that shouts
      // "reconcile" once a second until the client gives up and does what it was already told to do.
      const admitted = new Set<string>();
      const everyTick = options.tailEveryMs ?? TAIL_INTERVAL_MS;
      const ticksPerKeepalive = Math.max(1, Math.round(intervalMs / everyTick));
      let ticks = 0;
      let pulling = false;

      const pull = async (): Promise<void> => {
        if (closed) return;
        let wrote = false;
        for (const channel of options.channels) {
          const key = channelKey(channel);
          const replay = await tail(channel, cursors.get(key) ?? null);
          if (!replay.complete) {
            if (!admitted.has(key)) {
              push(formatComment(RECONCILE_COMMENT));
              admitted.add(key);
            }
          } else {
            admitted.delete(key);
          }
          for (const frame of replay.frames) {
            push(formatFrame(frame));
            cursors.set(key, frame.id);
            wrote = true;
          }
        }
        ticks += 1;
        if (!wrote && ticks % ticksPerKeepalive === 0) push(formatKeepalive());
      };

      stop = schedule(() => {
        // The tick is asynchronous and the scheduler is not, so overlapping pulls are prevented here rather
        // than by the timer: a slow source must delay the next pull, not start a second one beside it.
        if (pulling || closed) return;
        pulling = true;
        void pull()
          .catch(() => {
            // A failed pull is a missed tick, not a dead stream: the next tick asks again, and the client's
            // cursor is unchanged, so nothing was skipped by the attempt that failed.
          })
          .finally(() => {
            pulling = false;
          });
      });
    },
    cancel() {
      closed = true;
      stop?.();
      stop = null;
    },
  });

  return new Response(body, { status: 200, headers: streamHeaders(options.requestId) });
}
