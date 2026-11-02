/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `GET /rt/stream?channels=…` — the event stream a browser holds open (`05 §4.3`, `08 §9`).
 *
 * Three decisions happen before a single byte is written, and all three are refusals rather than
 * best-efforts: the channels must parse, every channel must be authorized for *this* principal, and the
 * replay must be fetched before the response is constructed. A stream that starts and then discovers it
 * may not read a channel has already told the client it is subscribed.
 *
 * The authorization port is a port because this Worker cannot answer it alone. Whether a customer may
 * watch `order:UND-7K2M9QX4` is a question about that order's owner, which lives in `undal-core`; realtime
 * holds no order rows and is not allowed to read them. The port is where that answer arrives — and until
 * it is wired, the default denies everything except a caller's own `self` channel. A closed door is the
 * correct default for a stream that carries order contents.
 */

import { failure, statusFor } from "@undal/contracts";
import type { Coordinator } from "../coordination/coordinator.ts";
import type { Clock } from "../lib/clock.ts";
import { systemClock } from "../lib/clock.ts";
import type { Channel } from "../sse/channels.ts";
import { parseChannels } from "../sse/channels.ts";
import { streamResponse } from "../sse/stream.ts";
import { parseLastEventId } from "../sse/frame.ts";
import type { StreamHub } from "../sse/hub.ts";
import type { ReplaySource } from "../sse/replay.ts";
import { collectReplay, orderLogReplay } from "../sse/replay.ts";

/** Who is asking. Resolved by the caller from the session token. */
export interface StreamPrincipal {
  readonly actorId: string;
  readonly actorType: "CUSTOMER" | "VENDOR_OWNER" | "RIDER" | "ADMIN";
  /** Zones an admin is limited to; `null` or absent means everywhere. */
  readonly zoneIds?: readonly string[] | null;
}

/** Whether a principal may watch a channel. */
export interface ChannelAuthorizer {
  allows(principal: StreamPrincipal, channel: Channel): boolean | Promise<boolean>;
}

/** What the stream route is given. */
export interface StreamContext {
  readonly coordinator: Coordinator;
  readonly principal: StreamPrincipal;
  readonly authorizer: ChannelAuthorizer;
  /** The in-isolate rings, when a room holds them; the order log is the durable fallback. */
  readonly hub?: StreamHub;
  readonly clock?: Clock;
}

/** The `self` channel, resolved against the caller. */
export function resolveSelf(channel: Channel, principal: StreamPrincipal): Channel | null {
  if (channel.id !== "self") return channel;
  if (principal.actorType === "RIDER" && channel.kind === "rider") return { kind: "rider", id: principal.actorId };
  if (principal.actorType === "VENDOR_OWNER" && channel.kind === "vendor") return { kind: "vendor", id: principal.actorId };
  if (principal.actorType === "ADMIN" && channel.kind === "admin") return { kind: "admin", id: principal.actorId };
  return null;
}

/** The default authorizer: a caller may watch only its own `self` channel. */
export const DENY_ALL: ChannelAuthorizer = { allows: () => false };

/** JSON, with the request id and no caching. */
function json(body: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "X-Undal-Request-Id": requestId,
    },
  });
}

/** A refusal in the shared envelope. */
function refuse(code: Parameters<typeof failure>[0], requestId: string, details: Record<string, unknown>): Response {
  return json(failure(code, { requestId, details }), statusFor(code), requestId);
}

/**
 * Serve the stream.
 *
 * The replay is assembled from the room's rings when they are available and from the order log
 * otherwise, so a Worker that has just started still answers a `Last-Event-ID` correctly — it is slower
 * and it is not wrong.
 */
export async function handleStream(request: Request, context: StreamContext): Promise<Response> {
  const requestId = request.headers.get("X-Undal-Request-Id") ?? crypto.randomUUID();
  const clock = context.clock ?? systemClock;
  if (request.method !== "GET") return refuse("NOT_IMPLEMENTED", requestId, { method: request.method });

  const url = new URL(request.url);
  let requested: readonly Channel[];
  let cursor: number | null;
  try {
    requested = parseChannels(url.searchParams.get("channels"));
    cursor = parseLastEventId(request.headers.get("Last-Event-ID"), url.searchParams.get("lastEventId"));
  } catch (error) {
    return refuse("VALIDATION_FAILED", requestId, {
      fields: [],
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  const channels: Channel[] = [];
  for (const channel of requested) {
    const resolved = resolveSelf(channel, context.principal);
    if (resolved === null) return refuse("PERM_DENIED", requestId, { channel: `${channel.kind}:${channel.id}` });
    if (!(await context.authorizer.allows(context.principal, resolved))) {
      return refuse("PERM_DENIED", requestId, { channel: `${resolved.kind}:${resolved.id}` });
    }
    channels.push(resolved);
  }

  const logSource = orderLogReplay(context.coordinator);
  const source: ReplaySource = {
    replay: async (channel, at) => {
      const fromRing = context.hub?.replay(channel, at, clock.nowMs());
      if (fromRing !== undefined && fromRing.frames.length > 0) return fromRing;
      return logSource.replay(channel, at);
    },
  };
  const replays = await collectReplay(source, channels, cursor);

  return streamResponse({ requestId, channels, lastEventId: cursor, replays });
}
