/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The ladder's front door: `POST /internal/ladder/{begin,seen,reply}` and `GET /internal/ladder/state`.
 *
 * `VendorAlarm` is addressed by order, so these four handlers do three things and no more — check the
 * internal token, read the order out of the request, forward to that order's room. Keeping them thin is
 * what lets the room be the only place the ladder's rules live: a route that also decided when a rung was
 * due would be a second implementation of the schedule.
 *
 * `readOnly: true`, in the same sense `/internal/broadcast` uses it: this Worker has no audit table to
 * write to (`05 §2.1` forbids it TiDB writes), and the ladder's durable state is a Durable Object's
 * storage rather than a row. The auditable event this ladder produces is the cancellation, and that audit
 * row is written by `undal-core` inside the transaction that moves the order (`routes/auto-cancel.ts`).
 *
 * The parameter travels in the body for the writes and in the query for the read. That asymmetry is
 * deliberate: a `GET` has no body, and inventing a `POST /state` to keep the shape symmetrical would mean a
 * read that looks like a write to every audit and cache tool in the platform.
 */

import { failure, statusFor } from "@undal/contracts";

import { checkInternalToken } from "../lib/secret.ts";
import type { BeginInput } from "../hubs/vendor-alarm.ts";

/** What the ladder routes are given. */
export interface LadderContext {
  /** The namespace of the per-order alarm rooms. */
  readonly namespace: DurableObjectNamespace | undefined;
  readonly internalToken: string | undefined;
  readonly requestId: string;
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

/** A refusal in the shared envelope, with the status its code carries. */
function refuse(code: Parameters<typeof failure>[0], requestId: string, details: Record<string, unknown>): Response {
  return json(failure(code, { requestId, details }), statusFor(code), requestId);
}

/** A body, or `null` when it is not JSON. */
async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await request.json()) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Whether a body is a `begin`. The room validates the rest; this refuses an address with no order. */
function readBegin(body: Record<string, unknown> | null): BeginInput | null {
  if (body === null) return null;
  const orderCode = body["orderCode"];
  const zoneId = body["zoneId"];
  const push = body["push"];
  const devices = body["devices"];
  if (typeof orderCode !== "string" || orderCode === "") return null;
  if (typeof zoneId !== "string" || zoneId === "") return null;
  if (typeof push !== "object" || push === null) return null;
  if (!Array.isArray(devices) || devices.some((device) => typeof device !== "string")) return null;
  return {
    orderCode,
    zoneId,
    push: push as BeginInput["push"],
    devices: devices as readonly string[],
    ...(typeof body["publishedAtMs"] === "number" ? { publishedAtMs: body["publishedAtMs"] } : {}),
  };
}

/** Forward to one order's room. */
function room(context: LadderContext, orderCode: string): DurableObjectStub {
  const namespace = context.namespace;
  if (namespace === undefined) throw new Error("no ladder namespace");
  return namespace.get(namespace.idFromName(`ladder:${orderCode}`));
}

/** Serve one of the four ladder paths, or answer `null` when the path is not one of them. */
export async function handleLadder(request: Request, context: LadderContext): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const isWrite = path === "/internal/ladder/begin" || path === "/internal/ladder/seen" || path === "/internal/ladder/reply";
  if (!isWrite && path !== "/internal/ladder/state") return null;

  const auth = await checkInternalToken(request, context.internalToken);
  if (!auth.ok) return refuse("PERM_DENIED", context.requestId, { reason: auth.reason });
  if (context.namespace === undefined) {
    // A ladder with no room is a ladder in one isolate: the 8-second probe would be forgotten by the
    // request that armed it. Refusing is the honest answer, and core's client already degrades.
    return refuse("NOT_IMPLEMENTED", context.requestId, { reason: "ladder_not_configured" });
  }

  if (request.method === "GET") {
    const orderCode = url.searchParams.get("order") ?? "";
    if (orderCode === "") return refuse("VALIDATION_FAILED", context.requestId, { fields: [], reason: "no_order" });
    return room(context, orderCode).fetch(new Request(`https://ladder.internal/state`));
  }

  if (request.method !== "POST") {
    return refuse("NOT_IMPLEMENTED", context.requestId, { method: request.method });
  }

  const body = await readJson(request);
  const suffix = path.slice("/internal/ladder/".length);
  if (suffix === "begin") {
    const begin = readBegin(body);
    if (begin === null) return refuse("VALIDATION_FAILED", context.requestId, { fields: [], reason: "not_a_begin" });
    return room(context, begin.orderCode).fetch(
      new Request("https://ladder.internal/begin", { method: "POST", body: JSON.stringify(begin) }),
    );
  }
  const orderCode = body?.["orderCode"];
  if (typeof orderCode !== "string" || orderCode === "") {
    return refuse("VALIDATION_FAILED", context.requestId, { fields: [], reason: "no_order" });
  }
  return room(context, orderCode).fetch(
    new Request(`https://ladder.internal/${suffix}`, {
      method: "POST",
      body: JSON.stringify(typeof body?.["atMs"] === "number" ? { atMs: body["atMs"] } : {}),
    }),
  );
}
