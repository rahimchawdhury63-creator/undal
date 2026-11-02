/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `GET /v1/presence?zone=…` — the socket a device holds open to say it is alive (`14 §2`, `05 §4.1`).
 *
 * This route does one thing the room cannot: it knows who the caller is. The access token is verified in
 * the Worker (the room never parses a token, and never sees one), and the identity is handed over as three
 * headers that the room trusts only because it cannot be reached except through here.
 *
 * The zone is checked against the token's zones *before* the upgrade is forwarded. A room is addressed by
 * zone, so forwarding first and checking later would let a rider open a socket in a zone they may not be
 * present in, and the only trace would be a session in the wrong room — so an unauthorized zone is a
 * refusal here, in the same envelope every other refusal uses, rather than a socket that opens and then
 * behaves oddly.
 *
 * The forwarded request keeps the `Upgrade` header, because it is the header that makes the room a room
 * rather than a cache lookup: a Durable Object answers a websocket upgrade with the client end of a pair,
 * and that answer has to travel back to the caller untouched.
 */

import { failure, statusFor } from "@undal/contracts";

import type { AuthenticatedPrincipal } from "../auth/token.ts";

/** The headers the Worker sets on the forwarded upgrade; the room reads them and nothing else. */
export const ACTOR_HEADER = "X-Undal-Actor";
/** The actor type, so the room can decide which presence role the socket occupies. */
export const ACTOR_TYPE_HEADER = "X-Undal-Actor-Type";
/** The device, so one person's two devices are two sessions rather than one that keeps moving. */
export const DEVICE_HEADER = "X-Undal-Device";

/** What the presence socket route is given. */
export interface PresenceSocketContext {
  /** One room per zone. */
  readonly zoneHub: DurableObjectNamespace;
  readonly principal: AuthenticatedPrincipal;
  readonly requestId: string;
}

/** A refusal in the shared envelope, with the status its code carries. */
function refuse(code: Parameters<typeof failure>[0], requestId: string, details: Record<string, unknown>): Response {
  return new Response(JSON.stringify(failure(code, { requestId, details })), {
    status: statusFor(code),
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "X-Undal-Request-Id": requestId,
    },
  });
}

/**
 * The zone the caller is asking to be present in.
 *
 * Absent is not the same as unauthorized: an upgrade with no zone is a client bug and answers `422`, while
 * a zone the token does not carry is a privilege question and answers `403`. Both are refusals, but only
 * one of them should make a client wonder whether it was allowed.
 */
function zoneOf(request: Request): string | null {
  const url = new URL(request.url);
  const zone = url.searchParams.get("zone") ?? "";
  return zone.trim() === "" ? null : zone;
}

/** Whether the principal may be present in `zoneId`. An empty zone list means "not restricted here". */
export function zoneAllowed(principal: AuthenticatedPrincipal, zoneId: string): boolean {
  const zones = principal.zoneIds;
  if (zones === null || zones.length === 0) return true;
  return zones.includes(zoneId);
}

/**
 * Verify-then-forward.
 *
 * `request` has already been through `authenticate`; this function does not look at the token and cannot
 * be called without a verified principal, which is what makes the three identity headers trustworthy.
 */
export async function handlePresenceSocket(
  request: Request,
  context: PresenceSocketContext,
): Promise<Response> {
  const { principal, requestId } = context;
  if (request.method !== "GET") {
    return refuse("NOT_IMPLEMENTED", requestId, { method: request.method });
  }
  const upgrade = request.headers.get("Upgrade");
  if (upgrade === null || upgrade.toLowerCase() !== "websocket") {
    return refuse("VALIDATION_FAILED", requestId, { reason: "expected a websocket upgrade" });
  }
  const zoneId = zoneOf(request);
  if (zoneId === null) return refuse("VALIDATION_FAILED", requestId, { reason: "no_zone" });
  if (!zoneAllowed(principal, zoneId)) {
    return refuse("PERM_DENIED", requestId, { zone: zoneId });
  }

  // A fresh header object rather than a mutation: the inbound request is the caller's, and a client that
  // sent its own `X-Undal-Actor` must not be able to keep it.
  const headers = new Headers(request.headers);
  headers.set(ACTOR_HEADER, principal.actorId);
  headers.set(ACTOR_TYPE_HEADER, principal.actorType);
  headers.set(DEVICE_HEADER, principal.deviceId);
  const forwarded = new Request(request, { headers });

  const room = context.zoneHub.get(context.zoneHub.idFromName(`zone:${zoneId}`));
  return room.fetch(forwarded);
}
