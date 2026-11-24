/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The endpoints `undal-core` calls, and nothing else.
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
import { cadenceFor } from "../d1/cadence.ts";
import { dispatchInstants } from "../hubs/dispatch-deadline.ts";
import type { PositionStore } from "../d1/store.ts";

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
  /**
   * The live-position store, when this deployment has a D1 binding.
   *
   * Only `/internal/shift/open` needs it: the row a shift's first flush is judged against. Absent means no
   * live tracking at all, and the route says so rather than pretending the shift opened.
   */
  readonly positions?: PositionStore;
  /**
   * Arm a zone room for the instants its wave needs (`11 §7`, D132).
   *
   * A broadcast is the only thing that reaches a zone with no sockets, so it is also the only chance to tell that zone
   * when to wake. Absent — no zone rooms bound — the announcement is recorded and nothing is armed, which is exactly
   * the behaviour before D132.
   */
  readonly wake?: (zoneId: string, atMs: readonly number[]) => Promise<unknown>;
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
  // The audience is optional and is *not* validated here beyond its type: `channelsFor` refuses an id the
  // stream grammar could not carry, because the grammar lives there and a second copy of it here would be a
  // second answer to the same question (D104).
  const audience: { vendorUserId?: string; riderUserId?: string } = {};
  const rawAudience = body.audience;
  if (typeof rawAudience === "object" && rawAudience !== null) {
    const record = rawAudience as Record<string, unknown>;
    if (typeof record.vendorUserId === "string") audience.vendorUserId = record.vendorUserId;
    if (typeof record.riderUserId === "string") audience.riderUserId = record.riderUserId;
  }
  return {
    zoneId,
    orderId,
    event,
    payload: body.payload ?? {},
    atMs: typeof body.atMs === "number" ? body.atMs : 0,
    ...(typeof body.seq === "number" ? { seq: body.seq } : {}),
    ...(audience.vendorUserId === undefined && audience.riderUserId === undefined ? {} : { audience }),
  };
}

/** The accuracy of a shift's start point. It is a selfie's location, not a fix, and it must not look like one. */
export const OPEN_ACCURACY_M = 100;

/** The D1 states a shift can be opened in. `ON_ORDER` needs an order, so it is not one of them. */
const OPEN_STATES: ReadonlySet<string> = new Set(["ONLINE", "BREAK"]);

/** What opening a shift needs, or `null` when the body is not one. */
interface OpenShift {
  readonly riderId: string;
  readonly shiftId: string;
  readonly zoneId: string;
  readonly vehicle: string;
  readonly state: string;
  readonly latE7: number;
  readonly lonE7: number;
  readonly accuracyM: number;
}

/** Read a shift-open body. `false`/`null` are absent; the ids are opaque strings the streams already use. */
export function readShiftOpen(raw: unknown): OpenShift | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  const text = (value: unknown, max: number): string | null =>
    typeof value === "string" && value !== "" && value.length <= max ? value : null;
  const riderId = text(body.riderId, 64);
  const shiftId = text(body.shiftId, 64);
  const zoneId = text(body.zoneId, 64);
  const vehicle = typeof body.vehicle === "string" && (body.vehicle === "MOTORBIKE" || body.vehicle === "BICYCLE") ? body.vehicle : null;
  if (riderId === null || shiftId === null || zoneId === null || vehicle === null) return null;
  const point = typeof body.point === "object" && body.point !== null ? (body.point as Record<string, unknown>) : null;
  const lat = point?.lat;
  const lon = point?.lon;
  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (typeof lon !== "number" || !Number.isFinite(lon) || lon < -180 || lon > 180) return null;
  const state = body.state === undefined ? "ONLINE" : body.state;
  if (typeof state !== "string" || !OPEN_STATES.has(state)) return null;
  const accuracyM =
    typeof body.accuracyM === "number" && Number.isFinite(body.accuracyM) && body.accuracyM > 0
      ? Math.min(Math.round(body.accuracyM), 10_000)
      : OPEN_ACCURACY_M;
  return {
    riderId,
    shiftId,
    zoneId,
    vehicle,
    state,
    latE7: Math.round(lat * 1e7),
    lonE7: Math.round(lon * 1e7),
    accuracyM,
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
    const sentAtMs = body.atMs === 0 ? clock.nowMs() : body.atMs;
    const result = await broadcast(context.store, { ...body, atMs: sentAtMs });
    // An announced offer is also a deadline (D132): the zone room has to wake when the alarm it just carried no longer
    // has a live offer. Forwarded after the ring is written, and swallowed on failure — a broadcast that could not arm
    // a room is a tick that runs on the next alarm that zone sees, which is what happened before this hook existed.
    const instants = dispatchInstants(body.payload, sentAtMs);
    let armed = false;
    if (instants.length > 0 && context.wake !== undefined) {
      try {
        armed = (await context.wake(body.zoneId, instants)) === true;
      } catch {
        armed = false;
      }
    }
    return json(
      success({ recorded: result.recorded.length, orderId: body.orderId, armed }, { requestId }),
      200,
      requestId,
    );
  }

  if (url.pathname === "/internal/shift/open") {
    if (request.method !== "POST") return refuse("NOT_IMPLEMENTED", requestId, { method: request.method });
    if (context.positions === undefined) {
      return refuse("NOT_IMPLEMENTED", requestId, { reason: "live_positions_not_configured" });
    }
    const open = readShiftOpen(await safeJson(request));
    if (open === null) return refuse("VALIDATION_FAILED", requestId, { fields: [] });
    const nowMs = clock.nowMs();
    // The seed's own deadline, from the profile the rider starts in: idle and stationary, the widest ceiling.
    // Until the first flush this is the only claim the map has, and it must expire like any other.
    const staleAfterMs = nowMs + cadenceFor("IDLE_STATIONARY").ceilingMs * 2;
    await context.positions.open({ ...open, nowMs, staleAfterMs });
    return json(success({ opened: true, shiftId: open.shiftId, staleAfterMs }, { requestId }), 200, requestId);
  }

  if (url.pathname === "/internal/candidates") {
    if (request.method !== "POST") return refuse("NOT_IMPLEMENTED", requestId, { method: request.method });
    if (context.positions === undefined) {
      return refuse("NOT_IMPLEMENTED", requestId, { reason: "live_positions_not_configured" });
    }
    // One read of the body: a `Request` body can be consumed once, and asking twice is how a route silently
    // starts validating `undefined`.
    const raw = await safeJson(request);
    const shaped = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const zoneId = typeof shaped.zoneId === "string" ? shaped.zoneId.trim() : "";
    if (zoneId === "" || zoneId.length > 64) return refuse("VALIDATION_FAILED", requestId, { fields: ["zoneId"] });
    const candidates = await context.positions.candidatesInZone(zoneId);
    return json(
      success({ zoneId, atMs: clock.nowMs(), candidates }, { requestId }),
      200,
      requestId,
    );
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
