/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { failure, success, statusFor } from "@undal/contracts";

import { readCoordinatorMode } from "./lib/config.ts";
import { DurableObjectCoordinator } from "./coordination/durable-object.ts";
import { authenticate } from "./auth/token.ts";
import type { VerifyingKey } from "./auth/token.ts";
import { handleStream, SELF_ONLY } from "./routes/stream.ts";
import { handlePresenceSocket } from "./routes/presence-socket.ts";
import { handleInternal } from "./routes/internal.ts";
import { DurableObjectFrameStore } from "./sse/durable-store.ts";

export { OrderRoom } from "./order-room.ts";
export { CoordinationRoom } from "./coordination/durable-object.ts";
export { StreamRoom } from "./sse/durable-store.ts";
export { ZoneHub } from "./hubs/zone-hub.ts";

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
  /** One room per stream channel: the durable rings a broadcast is remembered in. */
  readonly STREAM_ROOM?: DurableObjectNamespace;
  /** One room per zone: the presence sockets, and the heartbeats they are kept alive by. */
  readonly ZONE_HUB?: DurableObjectNamespace;
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
 * `/rt/stream` is the third, and every path it takes is a refusal it can explain:
 * no coordination room, no public key, no token, a token that does not verify, a channel the caller may
 * not read. A stream that starts before any of those answers is a stream that lied.
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
        authorizer: SELF_ONLY,
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
