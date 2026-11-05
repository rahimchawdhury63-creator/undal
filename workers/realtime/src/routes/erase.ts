/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Erasing a rider's live location (`07 §6`, D98).
 *
 * The brief is unambiguous: when a rider goes offline or ends a shift, their real-time location is erased from
 * D1 immediately. This route is the two doors into that, and they are different doors for different reasons:
 *
 * - **`POST /rt/location/erase`** is the rider's own, authenticated by their token. It erases the token's
 *   `sub` and nothing else: there is no rider id in the body, so an app cannot erase a colleague by guessing.
 *   It is deliberately *not* called `/rt/shift/end` — ending a shift is core's business, and a route here with
 *   that name would suggest realtime owns the shift record. This says "my live location, now".
 * - **`POST /internal/erase`** is `undal-core`'s, behind the shared internal token: an admin force-ending a
 *   shift, or a sweep that noticed a device stopped existing. It names the rider in the body because core is
 *   acting on someone else's behalf, which is exactly what the internal surface is for.
 *
 * Three properties, each of which is a decision:
 *
 * 1. **Erasure is idempotent.** A shift end, a presence timeout and an admin force-end can all fire within a
 *   second of each other. The second caller gets `200` with zero counts, not a `404`, because a `404` would
 *   tell a caller the trail is still there when it is not.
 * 2. **Erasure reports counts, not a boolean.** `{positions: 37, current: 1}` is a claim an operator can check
 *   against the ring's bound; `{ok: true}` is a claim that cannot be audited.
 * 3. **Erasure never touches TiDB.** The shift's start and end points, the distance and the delivery proof are
 *   business records and stay (`§6.2`); what is erased is the breadcrumb trail, which exists in this Worker
 *   and nowhere else.
 *
 * `readOnly` is false here and deservedly so: this is the one realtime route whose entire job is a deletion.
 */

import { failure, statusFor, success } from "@undal/contracts";

import { checkInternalToken } from "../lib/secret.ts";
import type { PositionStore } from "../d1/store.ts";

/** What the erasure routes are given. */
export interface EraseContext {
  /** The D1-backed store, or `undefined` when this deployment has no `RIDER_DB` binding. */
  readonly store: PositionStore | undefined;
  readonly requestId: string;
  /** The edge clock, injected so a test can be deterministic. */
  readonly nowMs: number;
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

/** The rider erasing their own live location. */
export async function handleEraseSelf(
  riderId: string,
  context: EraseContext,
): Promise<Response> {
  if (context.store === undefined) {
    return refuse("NOT_IMPLEMENTED", context.requestId, { reason: "d1_not_configured" });
  }
  const erased = await context.store.erase(riderId);
  return json(
    success(
      { erased, riderId, erasedAtMs: context.nowMs },
      { requestId: context.requestId },
    ),
    200,
    context.requestId,
  );
}

/** Core erasing a rider's live location on an operator's or a sweep's behalf. */
export async function handleEraseInternal(request: Request, context: EraseContext & { readonly internalToken: string | undefined }): Promise<Response> {
  // `checkInternalToken` is asynchronous and answers a result object; a bare `if (!check...)` on the promise
  // would be a permanent `true` and an open door, which is the one mistake this route cannot make.
  const authorised = await checkInternalToken(request, context.internalToken);
  if (!authorised.ok) {
    return refuse("AUTH_TOKEN_INVALID", context.requestId, { reason: "internal_token", why: authorised.reason });
  }
  if (context.store === undefined) {
    return refuse("NOT_IMPLEMENTED", context.requestId, { reason: "d1_not_configured" });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = (await request.json()) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return refuse("VALIDATION_FAILED", context.requestId, { reason: "not_json" });
  }

  const riderId = typeof body.riderId === "string" ? body.riderId.trim() : "";
  if (riderId === "" || riderId.length > 64) {
    return refuse("VALIDATION_FAILED", context.requestId, { reason: "rider_id_required" });
  }
  // Why it happened is for the caller's log, not for this Worker: the audit row for an admin force-end is
  // written by core inside the transaction that ends the shift, and this Worker has no ledger to add to.
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 64) : "unspecified";

  const erased = await context.store.erase(riderId);
  return json(
    success({ erased, riderId, reason, erasedAtMs: context.nowMs }, { requestId: context.requestId }),
    200,
    context.requestId,
  );
}
