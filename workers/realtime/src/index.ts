/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { failure, success, statusFor } from "@undal/contracts";

import { readCoordinatorMode } from "./lib/config.ts";
import { DurableObjectCoordinator } from "./coordination/durable-object.ts";
import { authenticate } from "./auth/token.ts";
import type { VerifyingKey } from "./auth/token.ts";
import { handleStream } from "./routes/stream.ts";
import { handlePresenceSocket } from "./routes/presence-socket.ts";
import { handleLadder } from "./routes/ladder.ts";
import { channelAuthorizer } from "./routes/authorizer.ts";
import { createCoreOrderViewer } from "./authority/core-viewer.ts";
import { NO_ORDERS } from "./authority/order-viewer.ts";
import { createCoreCanceller } from "./authority/core-cancel.ts";
import { fcmFrom } from "./fcm/from-env.ts";
import { handleInternal } from "./routes/internal.ts";
import { handleLocationBatch } from "./routes/location.ts";
import { handleEraseInternal, handleEraseSelf } from "./routes/erase.ts";
import { d1Positions } from "./d1/store.ts";
import { DurableObjectFrameStore } from "./sse/durable-store.ts";

export { OrderRoom } from "./order-room.ts";
export { CoordinationRoom } from "./coordination/durable-object.ts";
export { StreamRoom } from "./sse/durable-store.ts";
export { ZoneHub } from "./hubs/zone-hub.ts";
export { VendorAlarm } from "./hubs/vendor-alarm.ts";

/** The bindings this Worker is given by `wrangler.toml`. */
export interface RealtimeEnv {
  readonly PUBLIC_API_BASE: string;
  /** `sql` or `durable-object`; see `readCoordinatorMode`. */
  readonly COORDINATION_MODE?: string;
  readonly ORDER_ROOM: DurableObjectNamespace;
  /** The coordination room's namespace. Absent on a deployment that has not enabled the backend. */
  readonly COORDINATION_ROOM?: DurableObjectNamespace;
  /** The public half of the session signing key, base64url JWK. Verification only. */
  readonly JWT_PUBLIC_KEY?: string;
  /** The bearer token `undal-core` presents on the internal surface. */
  readonly INTERNAL_TOKEN?: string;
  /** Where core is, for the questions only core can answer. Defaults to `PUBLIC_API_BASE`. */
  readonly CORE_BASE_URL?: string;
  /** The service account that may send a push. Present, this Worker can wake a locked phone (D83). */
  readonly FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  /** The HMAC key payloads are signed with; the Android client holds the same one. */
  readonly FCM_SIG_KEY?: string;
  /** One room per stream channel: the durable rings a broadcast is remembered in. */
  readonly STREAM_ROOM?: DurableObjectNamespace;
  /** One room per zone: the presence sockets, and the heartbeats they are kept alive by. */
  readonly ZONE_HUB?: DurableObjectNamespace;
  /** One room per order: the two-minute vendor ladder and its alarms (D84). */
  readonly VENDOR_ALARM?: DurableObjectNamespace;
  /**
   * The live-position database (`07`). D1 holds only what may be lost: a 120-slot ring per rider and one
   * current row, both erased when the shift ends. Absent, the location route says `d1_not_configured`.
   */
  readonly RIDER_DB?: D1Database;
}

/** JSON with the request id, no caching. */
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

/** A refusal in the shared envelope, with the status its code carries. */
function refuse(code: Parameters<typeof failure>[0], requestId: string, details: Record<string, unknown>): Response {
  return json(failure(code, { requestId, details }), statusFor(code), requestId);
}

/**
 * The Worker's fetch handler.
 *
 * `/health` reports which coordinator backend is live, because the two backends have different cost and
 * latency profiles and an operator looking at a p95 regression needs to know which one is running before
 * changing anything. It also refuses a `COORDINATION_MODE` it does not know, rather than running one
 * backend while the operator believes they configured the other.
 *
 * `/internal/presence` answers core's question about a rider, and `/internal/broadcast` fans an order event
 * into the per-channel `StreamRoom` rings when they are bound — a ring in one isolate is forgotten by the
 * next request, which is worse than an honest `NOT_IMPLEMENTED`, so the route refuses when they are not.
 *
 * `/v1/presence` is the other client route: the token is verified here, and the identity it carries is
 * forwarded to the zone's room as headers. The room is addressed by zone, so a zone the token does not
 * carry is refused before any socket exists.
 *
 * `/internal/ladder/*` is the two-minute vendor alarm (D84): the record lives in one room per order, its
 * alarm wakes on the next rung, and the terminal cancellation is a request to core rather than a write
 * here — realtime holds the deadline, core holds the order.
 *
 * `/rt/stream` is the third, and every path it takes is a refusal it can explain:
 * no coordination room, no public key, no token, a token that does not verify, a channel the caller may
 * not read. A stream that starts before any of those answers is a stream that lied. `order:` channels are
 * decided by core through the order-authorization port — realtime cannot answer them and does not guess.
 */
export default {
  async fetch(request: Request, env: RealtimeEnv): Promise<Response> {
    const url = new URL(request.url);
    const id = request.headers.get("X-Undal-Request-Id") ?? crypto.randomUUID();

    if (url.pathname === "/health") {
      let coordinationMode;
      try {
        coordinationMode = readCoordinatorMode(env.COORDINATION_MODE);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return refuse("INTERNAL", id, { misconfigured: message });
      }
      return json(success({ worker: "undal-realtime", status: "ok", coordinationMode }, { requestId: id }), 200, id);
    }

    if (url.pathname === "/rt/stream") {
      let mode;
      try {
        mode = readCoordinatorMode(env.COORDINATION_MODE);
      } catch (error) {
        return refuse("INTERNAL", id, { misconfigured: error instanceof Error ? error.message : String(error) });
      }
      if (mode !== "durable-object" || env.COORDINATION_ROOM === undefined) {
        return refuse("NOT_IMPLEMENTED", id, {
          reason: "coordinator_not_configured",
          mode,
          hint: "the sql backend needs core's internal surface before this route can serve",
        });
      }
      const secret = env.JWT_PUBLIC_KEY;
      if (secret === undefined || secret.trim() === "") {
        return refuse("NOT_IMPLEMENTED", id, { reason: "jwt_public_key_missing" });
      }
      let key: VerifyingKey;
      try {
        const { loadVerifyingKey } = await import("./auth/token.ts");
        key = await loadVerifyingKey(secret);
      } catch (error) {
        return refuse("INTERNAL", id, { misconfigured: error instanceof Error ? error.message : String(error) });
      }

      const authenticated = await authenticate(request, [key], Date.now());
      if (!authenticated.ok) {
        return refuse(authenticated.error === "EXPIRED" ? "AUTH_SESSION_EXPIRED" : "AUTH_TOKEN_INVALID", id, {
          reason: authenticated.error,
        });
      }

      return handleStream(request, {
        coordinator: new DurableObjectCoordinator(env.COORDINATION_ROOM),
        ...(env.STREAM_ROOM === undefined ? {} : { store: new DurableObjectFrameStore(env.STREAM_ROOM) }),
        principal: {
          actorId: authenticated.value.actorId,
          actorType: authenticated.value.actorType,
          zoneIds: authenticated.value.zoneIds,
        },
        // The order-authorization port: core is asked about an order, and a deployment that cannot ask
        // refuses order channels rather than allowing them. Identity channels do not need the hop.
        authorizer: channelAuthorizer(
          env.INTERNAL_TOKEN === undefined || env.INTERNAL_TOKEN === ""
            ? NO_ORDERS
            : createCoreOrderViewer(env.CORE_BASE_URL ?? env.PUBLIC_API_BASE, env.INTERNAL_TOKEN),
        ),
      });
    }

    if (url.pathname === "/v1/presence") {
      const zoneHub = env.ZONE_HUB;
      if (zoneHub === undefined) return refuse("NOT_IMPLEMENTED", id, { reason: "zone_hub_not_configured" });
      const secret = env.JWT_PUBLIC_KEY;
      if (secret === undefined || secret.trim() === "") {
        return refuse("NOT_IMPLEMENTED", id, { reason: "jwt_public_key_missing" });
      }
      let key: VerifyingKey;
      try {
        const { loadVerifyingKey } = await import("./auth/token.ts");
        key = await loadVerifyingKey(secret);
      } catch (error) {
        return refuse("INTERNAL", id, { misconfigured: error instanceof Error ? error.message : String(error) });
      }
      const authenticated = await authenticate(request, [key], Date.now());
      if (!authenticated.ok) {
        return refuse(authenticated.error === "EXPIRED" ? "AUTH_SESSION_EXPIRED" : "AUTH_TOKEN_INVALID", id, {
          reason: authenticated.error,
        });
      }
      return handlePresenceSocket(request, {
        zoneHub,
        principal: authenticated.value,
        requestId: id,
      });
    }

    if (url.pathname === "/rt/location/batch") {
      const secret = env.JWT_PUBLIC_KEY;
      if (secret === undefined || secret.trim() === "") {
        return refuse("NOT_IMPLEMENTED", id, { reason: "jwt_public_key_missing" });
      }
      let key: VerifyingKey;
      try {
        const { loadVerifyingKey } = await import("./auth/token.ts");
        key = await loadVerifyingKey(secret);
      } catch (error) {
        return refuse("INTERNAL", id, { misconfigured: error instanceof Error ? error.message : String(error) });
      }
      const authenticated = await authenticate(request, [key], Date.now());
      if (!authenticated.ok) {
        return refuse(authenticated.error === "EXPIRED" ? "AUTH_SESSION_EXPIRED" : "AUTH_TOKEN_INVALID", id, {
          reason: authenticated.error,
        });
      }
      // A customer's token may watch a rider; it may not *be* one. The positions a batch writes are the
      // rider's own, so the actor type is checked before the body is read (D97).
      if (authenticated.value.actorType !== "RIDER") {
        return refuse("AUTH_ROLE_MISMATCH", id, { reason: "not_a_rider", actorType: authenticated.value.actorType });
      }
      return handleLocationBatch(request, {
        store: env.RIDER_DB === undefined ? undefined : d1Positions(env.RIDER_DB),
        riderId: authenticated.value.actorId,
        shiftId: null,
        requestId: id,
        nowMs: Date.now(),
      });
    }

    if (url.pathname === "/rt/location/erase") {
      const secret = env.JWT_PUBLIC_KEY;
      if (secret === undefined || secret.trim() === "") {
        return refuse("NOT_IMPLEMENTED", id, { reason: "jwt_public_key_missing" });
      }
      let key: VerifyingKey;
      try {
        const { loadVerifyingKey } = await import("./auth/token.ts");
        key = await loadVerifyingKey(secret);
      } catch (error) {
        return refuse("INTERNAL", id, { misconfigured: error instanceof Error ? error.message : String(error) });
      }
      const authenticated = await authenticate(request, [key], Date.now());
      if (!authenticated.ok) {
        return refuse(authenticated.error === "EXPIRED" ? "AUTH_SESSION_EXPIRED" : "AUTH_TOKEN_INVALID", id, {
          reason: authenticated.error,
        });
      }
      if (authenticated.value.actorType !== "RIDER") {
        return refuse("AUTH_ROLE_MISMATCH", id, { reason: "not_a_rider", actorType: authenticated.value.actorType });
      }
      // The rider is the token's `sub`, never a body field: an app must not be able to erase a colleague.
      return handleEraseSelf(authenticated.value.actorId, {
        store: env.RIDER_DB === undefined ? undefined : d1Positions(env.RIDER_DB),
        requestId: id,
        nowMs: Date.now(),
      });
    }

    if (url.pathname === "/internal/erase") {
      return handleEraseInternal(request, {
        store: env.RIDER_DB === undefined ? undefined : d1Positions(env.RIDER_DB),
        internalToken: env.INTERNAL_TOKEN,
        requestId: id,
        nowMs: Date.now(),
      });
    }

    if (url.pathname.startsWith("/internal/ladder/")) {
      const ladder = await handleLadder(request, {
        namespace: env.VENDOR_ALARM,
        internalToken: env.INTERNAL_TOKEN,
        requestId: id,
      });
      if (ladder !== null) return ladder;
    }

    if (url.pathname === "/internal/presence" || url.pathname === "/internal/broadcast") {
      let mode;
      try {
        mode = readCoordinatorMode(env.COORDINATION_MODE);
      } catch (error) {
        return refuse("INTERNAL", id, { misconfigured: error instanceof Error ? error.message : String(error) });
      }
      if (mode !== "durable-object" || env.COORDINATION_ROOM === undefined) {
        return refuse("NOT_IMPLEMENTED", id, { reason: "coordinator_not_configured", mode });
      }
      return handleInternal(request, {
        coordinator: new DurableObjectCoordinator(env.COORDINATION_ROOM),
        internalToken: env.INTERNAL_TOKEN,
        // A broadcast needs a room to be remembered in; without one it is refused rather than answered
        // into a ring the next request will not see.
        ...(env.STREAM_ROOM === undefined
          ? { broadcastEnabled: false }
          : { store: new DurableObjectFrameStore(env.STREAM_ROOM), broadcastEnabled: true }),
      });
    }

    return refuse("NOT_IMPLEMENTED", id, { path: url.pathname });
  },
};
