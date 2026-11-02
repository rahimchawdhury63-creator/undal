/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The two endpoints `undal-core` calls, and nothing else.
 *
 * Core's typed client (`workers/core/src/bindings/realtime.ts`) is the specification: one broadcast that
 * fans an order event out to the order and its zone, and one presence question for a single rider. Both
 * are behind the shared bearer token, both answer in the platform's envelope, and both fail by degrading
 * — core treats a broadcast failure as a missed push, not as a reason to stop an order.
 *
 * The handlers are separate from the Worker's fetch router so a test can call them with an injected
 * coordinator, a hub and a clock. Routing is a string comparison; this file is the behaviour.
 *
 * `readOnly: true` — and this is a statement about the system of record, not a technicality. A broadcast
 * appends to an in-memory ring and answers; it writes no row anywhere, because the order transition it
 * announces was audited by `undal-core` before the call was made. Presence reads and writes nothing
 * either. Realtime is not allowed to write TiDB (`05 §2.1`), so there is no audit table here to write to,
 * and inventing one would be a second ledger.
 */

import { failure, statusFor, success } from "@undal/contracts";
import type { Coordinator } from "../coordination/coordinator.ts";

import type { Clock } from "../lib/clock.ts";
import { systemClock } from "../lib/clock.ts";
import { checkInternalToken } from "../lib/secret.ts";
import { catalogueName } from "../sse/hub.ts";
import type { FrameStore } from "../sse/store.ts";
import type { BroadcastInput } from "../sse/fanout.ts";
import { broadcast } from "../sse/fanout.ts";

/** What the internal routes are given. */
export interface InternalContext {
  readonly coordinator: Coordinator;
  /** The rings a broadcast records into. Absent until a room owns them. */
  readonly store?: FrameStore;
  /** The shared secret core presents. `undefined` means this deployment accepts no internal calls. */
  readonly internalToken: string | undefined;
  /**
   * Whether a broadcast can be recorded.
   *
   * A ring lives in one isolate; until a room owns one, a broadcast answered here would be remembered by
   * the request that handled it and forgotten by the next. Refusing is honest, and it is what core's
   * client already expects: the broadcast is a notification and a failure degrades.
   */
  readonly broadcastEnabled?: boolean;
  readonly clock?: Clock;
}

/** The body of a broadcast, and whether it is shaped like one. */
function readBroadcast(raw: unknown): BroadcastInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  const zoneId = body.zoneId;
  const orderId = body.orderId;
  const event = body.event;
  if (typeof zoneId !== "string" || zoneId === "") return null;
  if (typeof orderId !== "string" || orderId === "") return null;
  if (typeof event !== "string" || event === "") return null;
  return {
    zoneId,
    orderId,
    event,
    payload: body.payload ?? {},
    atMs: typeof body.atMs === "number" ? body.atMs : 0,
    ...(typeof body.seq === "number" ? { seq: body.seq } : {}),
  };
}

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

/** A failure in the shared envelope, with the status the registry assigns to its code. */
function refuse(code: Parameters<typeof failure>[0], requestId: string, details: Record<string, unknown>): Response {
  return json(failure(code, { requestId, details }), statusFor(code), requestId);
}

/**
 * Serve `/internal/broadcast` and `/internal/presence`.
 *
 * Anything else is `NOT_IMPLEMENTED`, matching the Worker's public catch-all: a misrouted internal call
 * should be a loud 501 in core's logs, not a silent 200 that fanned nothing out.
 */
export async function handleInternal(request: Request, context: InternalContext): Promise<Response> {
  const requestId = request.headers.get("X-Undal-Request-Id") ?? crypto.randomUUID();
  const clock = context.clock ?? systemClock;
  const url = new URL(request.url);

  const auth = await checkInternalToken(request, context.internalToken);
  if (!auth.ok) {
    return refuse("PERM_DENIED", requestId, { reason: auth.reason });
  }

  if (url.pathname === "/internal/broadcast") {
    if (request.method !== "POST") return refuse("NOT_IMPLEMENTED", requestId, { method: request.method });
    const body = readBroadcast(await safeJson(request));
    if (body === null) return refuse("VALIDATION_FAILED", requestId, { fields: [] });
    if (catalogueName(body.event) === null) {
      return refuse("VALIDATION_FAILED", requestId, { fields: [], reason: "unknown_event", event: body.event });
    }
    if (context.broadcastEnabled === false || context.store === undefined) {
      return refuse("NOT_IMPLEMENTED", requestId, { reason: "rings_not_durable" });
    }
    const result = await broadcast(context.store, { ...body, atMs: body.atMs === 0 ? clock.nowMs() : body.atMs });
    return json(success({ recorded: result.recorded.length, orderId: body.orderId }, { requestId }), 200, requestId);
  }

  if (url.pathname === "/internal/presence") {
    if (request.method !== "POST") return refuse("NOT_IMPLEMENTED", requestId, { method: request.method });
    const body = await safeJson(request);
    const shaped = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const zoneId = shaped.zoneId;
    const riderId = shaped.riderId;
    if (typeof zoneId !== "string" || zoneId === "" || typeof riderId !== "string" || riderId === "") {
      return refuse("VALIDATION_FAILED", requestId, { fields: [] });
    }
    const now = clock.nowMs();
    const sessions = await context.coordinator.listPresence(zoneId, "RIDER");
    const session = sessions.find((held) => held.actorId === riderId) ?? null;
    // How wide "online" is belongs to the backend (D89): a Durable Object writes every beat, the sql backend
    // stamps once per window. Asking the coordinator keeps both answers true.
    const online = session !== null && now - session.lastHeartbeatMs <= context.coordinator.presenceWindowMs;
    return json(
      success(
        {
          online,
          lastSeenAt: session === null ? null : new Date(session.lastHeartbeatMs).toISOString(),
        },
        { requestId },
      ),
      200,
      requestId,
    );
  }

  return refuse("NOT_IMPLEMENTED", requestId, { path: url.pathname });
}


/** A JSON body, or `undefined` when the body is absent or is not JSON. */
async function safeJson(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    return undefined;
  }
}
