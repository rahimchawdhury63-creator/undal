/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `POST /internal/orders/auto-cancel` — the last rung of the two-minute ladder (D84).
 *
 * `14 §4.1` cancels an order at 120 s when its vendor never answered. The deadline is realtime's to keep:
 * it holds the ladder, it sends the pushes, and it knows to the millisecond whether a vendor said *seen*.
 * The order's state is this Worker's, and nothing else may write it — so the rung is a request rather than
 * a write, and this route is where the request is answered against the state machine rather than against
 * the caller's belief about it.
 *
 * Three properties are load-bearing:
 *
 * - **The guard is the state machine's.** `PLACED → AUTO_CANCELLED` exists as a `SYSTEM` edge with the
 *   `vendorUnreachable` guard, and the guard needs both 120 s elapsed and an unreachable vendor. A ladder
 *   that fires early is refused by the same table that refuses an illegal customer cancel.
 * - **A late acceptance wins.** The read and the write are separated by a `WHERE state = 'PLACED'`, so a
 *   vendor who accepts while this request is in flight leaves `affectedRows` at 0 and the answer is
 *   `not_cancellable`, not a cancellation of an accepted order.
 * - **It is audited.** The row names `SYSTEM`, carries no user, and records the elapsed time — this is the
 *   one cancellation nobody clicked, so the trail is the only account of why it happened.
 */

import * as audit from "../audit/write.ts";
import { announce } from "../bindings/announce.ts";
import { toHexId, newId } from "../lib/ids.ts";
import { failureResponse, successResponse } from "../middleware/envelope.ts";
import { ANONYMOUS } from "../middleware/auth.ts";
import { requireInternalToken } from "../middleware/internal-token.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { applyTransition } from "../domain/order/lifecycle.ts";
import { canTransition } from "../domain/order/state-machine.ts";
import type { TransitionContext } from "../domain/order/guards.ts";
import { findOrderByCode, moveState } from "../repositories/orders.ts";

/** The reason the cancellation carries into the event and the audit row (`14 §4.1`). */
export const AUTO_CANCEL_REASON = "VENDOR_DEVICE_UNREACHABLE";

/** The body realtime sends. */
interface CancelRequest {
  readonly orderCode?: unknown;
  readonly elapsedSeconds?: unknown;
}

/** The answer: whether the order moved, and why not when it did not. */
interface CancelAnswer {
  readonly cancelled: boolean;
  readonly reason: "cancelled" | "order_not_found" | "not_cancellable" | "raced";
  /** The state the order was in, when it did not move. For the ladder's evidence block. */
  readonly state: string | null;
}

/** Cancel an order whose vendor never answered. */
async function autoCancel(ctx: Ctx, body: unknown): Promise<Response> {
  const refused = requireInternalToken(ctx);
  if (refused !== null) return refused;

  const fields = (typeof body === "object" && body !== null ? body : {}) as CancelRequest;
  const orderCode = fields.orderCode;
  const elapsedSeconds = fields.elapsedSeconds;
  if (typeof orderCode !== "string" || orderCode.length === 0 || orderCode.length > 64) {
    return failureResponse({ code: "VALIDATION_FAILED", details: { field: "orderCode" } }, ctx.locale, ctx.requestId);
  }
  if (typeof elapsedSeconds !== "number" || !Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    return failureResponse({ code: "VALIDATION_FAILED", details: { field: "elapsedSeconds" } }, ctx.locale, ctx.requestId);
  }

  const row = await findOrderByCode(ctx.db, orderCode);
  // A code that names no order is an answer, not a 404: realtime's ladder has nothing left to do either way,
  // and a 404 would be a probe for which codes exist.
  if (row === null) {
    return successResponse({ cancelled: false, reason: "order_not_found", state: null } satisfies CancelAnswer, ctx.locale, ctx.requestId);
  }

  const transitionContext: TransitionContext = { elapsedSeconds, vendorUnreachable: true };
  const verdict = canTransition(row.state, "AUTO_CANCELLED", "SYSTEM", transitionContext);
  if (!verdict.allowed) {
    return successResponse(
      { cancelled: false, reason: "not_cancellable", state: row.state } satisfies CancelAnswer,
      ctx.locale,
      ctx.requestId,
    );
  }

  const nowMs = Date.now();
  const outcome = applyTransition({
    orderId: orderCode,
    from: row.state,
    to: "AUTO_CANCELLED",
    actor: "SYSTEM",
    context: transitionContext,
    // The event's own sequence is assigned by `moveState` inside the same boundary as the move; this number
    // is only used in the in-memory outcome, which nothing here persists.
    nextSeq: 0,
    nowMs,
    reasonCode: AUTO_CANCEL_REASON,
  });

  const moved = await moveState(ctx.db, {
    orderId: row.id,
    eventId: newId(nowMs),
    from: row.state,
    to: "AUTO_CANCELLED",
    actor: "SYSTEM",
    actorUserId: null,
    event: outcome.event.event,
    reasonCode: AUTO_CANCEL_REASON,
    reasonText: null,
    nowMs,
  });

  if (!moved.applied) {
    // Somebody answered between the read and the write. Their answer is the one that counts.
    return successResponse(
      { cancelled: false, reason: "raced", state: row.state } satisfies CancelAnswer,
      ctx.locale,
      ctx.requestId,
    );
  }

  await audit.appendAudit(
    ctx.db,
    {
      actorId: null,
      actorType: "SYSTEM",
      actorRole: null,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      action: "order.auto_cancel",
      resourceType: "ORDER",
      resourceId: toHexId(row.id),
      subjectId: null,
      before: { state: row.state },
      after: { state: "AUTO_CANCELLED", seq: moved.seq, elapsedSeconds },
      reason: AUTO_CANCEL_REASON,
      severity: "WARNING",
    },
    nowMs,
  );

  // The cancellation is a transition like any other, so it is announced from the Worker that wrote it
  // rather than from the room that asked for it (D84, D85).
  announce(ctx, {
    zoneId: toHexId(row.zone_id),
    orderId: row.code,
    event: "order.cancelled",
    payload: { orderId: row.code, state: "AUTO_CANCELLED", seq: moved.seq, cancelledBy: "SYSTEM", reason: AUTO_CANCEL_REASON },
    seq: moved.seq,
  });

  return successResponse({ cancelled: true, reason: "cancelled", state: "AUTO_CANCELLED" } satisfies CancelAnswer, ctx.locale, ctx.requestId);
}

/** The internal order routes. Not part of the public API surface. */
export const AUTO_CANCEL_ROUTES: readonly RouteDefinition[] = [
  {
    method: "POST",
    path: "/internal/orders/auto-cancel",
    permission: ANONYMOUS,
    group: "INTERNAL",
    // It writes, and the audit row is inside the handler: `audit.appendAudit` is what keeps the
    // audit-coverage rule satisfied here.
    write: true,
    maxBodyBytes: 1_024,
    run: (ctx, input) => autoCancel(ctx, input.body),
  },
];
