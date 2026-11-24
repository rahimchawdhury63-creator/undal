/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `POST /internal/stream/watches` — the one question realtime cannot answer itself (D82).
 *
 * "May this caller watch this order's events" is a question about three order rows: the customer who
 * placed it, the vendor that cooks it, and the rider assigned to it. Realtime holds none of them, so it
 * asks. The answer is a yes or a no plus a reason, and the reason is for the operator reading a log, not
 * for the caller — realtime collapses it to `PERM_DENIED` either way, because telling a stranger which of
 * the three they failed at is telling them the order exists.
 *
 * Authorization inside this handler is by the shared internal token, not by a session: the route is
 * declared anonymous so the pipeline does not demand a user token, and the first thing the handler does is
 * refuse a request that did not present the internal one. Two rules, either alone would be an open door.
 *
 * The route is `readOnly`: it reads an order row and answers, and writes nothing — no audit row, because an
 * authorization question is asked on every stream open and an audit table that grows with reconnects is a
 * table nobody can search.
 */

import { toHexId } from "../lib/ids.ts";
import { failureResponse, successResponse } from "../middleware/envelope.ts";
import { ANONYMOUS, uuidBytes } from "../middleware/auth.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { requireInternalToken } from "../middleware/internal-token.ts";
import { findOrderByCode, vendorForUser } from "../repositories/orders.ts";

/** The actor types a watch question may name. */
const ACTOR_TYPES = ["CUSTOMER", "VENDOR_OWNER", "RIDER", "ADMIN"] as const;

type WatchActorType = (typeof ACTOR_TYPES)[number];

/** The body the question arrives as. */
interface WatchRequest {
  readonly actorId?: unknown;
  readonly actorType?: unknown;
  readonly orderId?: unknown;
}

/** A canonical 32-hex user id, or `null`. */
function isHexId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/iu.test(value);
}

/** An answer: whether, and a reason for the log. */
interface WatchAnswer {
  readonly allowed: boolean;
  readonly reason: string;
}

/**
 * Decide.
 *
 * Order matters here only in the sense that the cheapest refusal comes first: an admin is allowed without
 * reading the row, because `getOrder` already lets an admin read any order and a hop to be told what the
 * API would already have said is a hop that can only fail.
 *
 * A rider is allowed only when the order is *assigned* to them. During an offer wave the offer reaches the
 * rider through the push channel (`15 §4`), and the order's event stream is opened after they claim it —
 * so an unassigned rider watching an order is not a bidder, it is somebody reading a stranger's order.
 */
async function decide(ctx: Ctx, actorId: string, actorType: WatchActorType, code: string): Promise<WatchAnswer> {
  if (actorType === "ADMIN") return { allowed: true, reason: "admin" };

  const row = await findOrderByCode(ctx.db, code);
  // A code that names no order is a no, not a 404: realtime's refusal path is the same either way, and an
  // internal RPC that answers 404 to a wrong guess is a probe for which codes exist.
  if (row === null) return { allowed: false, reason: "order_not_found" };

  if (actorType === "CUSTOMER") {
    return toHexId(row.customer_user_id) === actorId
      ? { allowed: true, reason: "owner" }
      : { allowed: false, reason: "not_party" };
  }
  if (actorType === "VENDOR_OWNER") {
    const vendor = await vendorForUser(ctx.db, uuidBytes(actorId));
    return vendor !== null && toHexId(vendor.id) === toHexId(row.vendor_id)
      ? { allowed: true, reason: "vendor" }
      : { allowed: false, reason: "not_party" };
  }
  return row.rider_id !== null && toHexId(row.rider_id) === actorId
    ? { allowed: true, reason: "assigned_rider" }
    : { allowed: false, reason: "not_party" };
}

/** Answer the question. */
async function watches(ctx: Ctx, body: unknown): Promise<Response> {
  const refused = requireInternalToken(ctx);
  if (refused !== null) return refused;

  const fields = (typeof body === "object" && body !== null ? body : {}) as WatchRequest;
  const actorId = fields.actorId;
  const actorType = fields.actorType;
  const code = fields.orderId;
  if (!isHexId(actorId) || typeof actorType !== "string" || !(ACTOR_TYPES as readonly string[]).includes(actorType)) {
    return failureResponse({ code: "VALIDATION_FAILED", details: { field: "actorType" } }, ctx.locale, ctx.requestId);
  }
  if (typeof code !== "string" || code.length === 0 || code.length > 64) {
    return failureResponse({ code: "VALIDATION_FAILED", details: { field: "orderId" } }, ctx.locale, ctx.requestId);
  }

  const answer = await decide(ctx, actorId, actorType as WatchActorType, code);
  return successResponse(answer, ctx.locale, ctx.requestId);
}

/** The internal routes. Not part of the public API surface, and not documented as one. */
export const STREAM_AUTH_ROUTES: readonly RouteDefinition[] = [
  {
    method: "POST",
    path: "/internal/stream/watches",
    // Anonymous in the pipeline's sense: the caller is a Worker, not a user, and the handler checks the
    // shared token itself. A `*` route still runs the rate limiter, and `INTERNAL` has no limits.
    permission: ANONYMOUS,
    group: "INTERNAL",
    readOnly: true,
    maxBodyBytes: 1_024,
    run: (ctx, input) => watches(ctx, input.body),
  },
];
