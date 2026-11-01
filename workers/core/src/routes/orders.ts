/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import * as audit from "../audit/write.ts";
import { toHexId, newId } from "../lib/ids.ts";
import { failureResponse, successResponse } from "../middleware/envelope.ts";
import { uuidBytes } from "../middleware/auth.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { applyTransition } from "../domain/order/lifecycle.ts";
import { canTransition } from "../domain/order/state-machine.ts";
import type { TransitionContext } from "../domain/order/guards.ts";
import type { OrderState } from "../domain/order/states.ts";
import { findOrder, listOrders, moveState, nextEventSeq, vendorForUser, type OrderRow } from "../repositories/orders.ts";

/**
 * The order routes: read one, list mine, accept, reject.
 *
 * Every handler here does the same three things in the same order — load the order, ask the
 * state machine whether the move is legal, then perform it with the state in the `WHERE` clause.
 * That shape is why there is no `if (order.state === "PLACED")` anywhere in this file: the day a
 * new state or a new guard appears, these endpoints already know about it.
 */

/** The JSON shape of an order, with every amount an integer number of paisa. */
export function serialiseOrder(row: OrderRow): Record<string, unknown> {
  return {
    id: toHexId(row.id),
    code: row.code,
    state: row.state,
    fulfilment: row.fulfilment,
    vendorId: toHexId(row.vendor_id),
    customerId: toHexId(row.customer_user_id),
    zoneId: toHexId(row.zone_id),
    riderId: row.rider_id === null ? null : toHexId(row.rider_id),
    money: {
      subtotalPaisa: Number(row.subtotal_paisa),
      discountPaisa: Number(row.discount_paisa),
      deliveryFeePaisa: Number(row.delivery_fee_paisa),
      smallOrderFeePaisa: Number(row.small_order_fee_paisa),
      taxPaisa: Number(row.tax_paisa),
      tipPaisa: Number(row.tip_paisa),
      roundingPaisa: Number(row.rounding_paisa),
      totalPaisa: Number(row.total_paisa),
      cashCollectedPaisa: row.cash_collected_paisa === null ? null : Number(row.cash_collected_paisa),
      commissionPaisa: Number(row.commission_paisa),
      riderBonusPaisa: Number(row.rider_bonus_paisa),
      riderPayoutPaisa: Number(row.rider_payout_paisa),
      vendorPayoutPaisa: Number(row.vendor_payout_paisa),
    },
    surgeBps: Number(row.surge_bps),
    prepTimeSeconds: row.prep_time_s === null ? null : Number(row.prep_time_s),
    customerNote: row.customer_note,
    placedAt: row.placed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Read one order, if the caller is allowed to see it. */
async function getOrder(ctx: Ctx, orderId: string): Promise<Response> {
  const principal = ctx.principal;
  if (principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);

  const row = await findOrder(ctx.db, uuidBytes(orderId));
  if (row === null) return failureResponse({ code: "ORDER_NOT_FOUND" }, ctx.locale, ctx.requestId);

  const isOwner =
    (principal.actorType === "CUSTOMER" && toHexId(row.customer_user_id) === principal.userId) ||
    principal.actorType === "ADMIN" ||
    principal.actorType === "RIDER";
  if (!isOwner) {
    const vendor = await vendorForUser(ctx.db, uuidBytes(principal.userId));
    if (vendor === null || toHexId(vendor.id) !== toHexId(row.vendor_id)) {
      // Not "forbidden": to a caller who is not party to the order, it does not exist.
      return failureResponse({ code: "ORDER_NOT_FOUND" }, ctx.locale, ctx.requestId);
    }
  }

  return successResponse({ order: serialiseOrder(row) }, ctx.locale, ctx.requestId);
}

/** The caller's own orders. */
async function listMyOrders(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);

  const limit = Number(ctx.url.searchParams.get("limit") ?? "20");
  const user = uuidBytes(principal.userId);

  if (principal.actorType === "VENDOR_OWNER") {
    const vendor = await vendorForUser(ctx.db, user);
    if (vendor === null) return successResponse({ orders: [] }, ctx.locale, ctx.requestId);
    const rows = await listOrders(ctx.db, { vendorId: vendor.id, limit });
    return successResponse({ orders: rows.map(serialiseOrder) }, ctx.locale, ctx.requestId);
  }

  const rows = await listOrders(ctx.db, { customerUserId: user, limit });
  return successResponse({ orders: rows.map(serialiseOrder) }, ctx.locale, ctx.requestId);
}

/** Shared body of accept and reject: load, authorise, ask the table, move, audit. */
async function vendorMove(
  ctx: Ctx,
  orderId: string,
  to: "ACCEPTED" | "REJECTED",
  body: unknown,
): Promise<Response> {
  const principal = ctx.principal;
  if (principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);

  const row = await findOrder(ctx.db, uuidBytes(orderId));
  if (row === null) return failureResponse({ code: "ORDER_NOT_FOUND" }, ctx.locale, ctx.requestId);

  const vendor = await vendorForUser(ctx.db, uuidBytes(principal.userId));
  const ownsOrder = vendor !== null && toHexId(vendor.id) === toHexId(row.vendor_id);

  const fields = (body ?? {}) as Record<string, unknown>;
  const prepTime = typeof fields["prepTimeSeconds"] === "number" ? fields["prepTimeSeconds"] : undefined;
  const reasonCode = typeof fields["reasonCode"] === "string" ? fields["reasonCode"] : null;
  const reasonText = typeof fields["reasonText"] === "string" ? fields["reasonText"] : null;

  const transitionCtx: TransitionContext = {
    vendorOwnsOrder: ownsOrder,
    ...(prepTime === undefined ? {} : { prepTimeSeconds: prepTime }),
    reasonCode,
  };

  const verdict = canTransition(row.state, to, "VENDOR", transitionCtx);
  if (!verdict.allowed) {
    if (verdict.refusal === "ACTOR_NOT_PERMITTED" || verdict.guard === "vendorOwnsOrder") {
      return failureResponse({ code: "ORDER_NOT_YOURS" }, ctx.locale, ctx.requestId);
    }
    if (verdict.refusal === "ILLEGAL_EDGE") {
      const code = row.state === "ACCEPTED" ? "ORDER_ALREADY_ACCEPTED" : "ORDER_NOT_ACCEPTABLE";
      return failureResponse({ code }, ctx.locale, ctx.requestId);
    }
    if (verdict.guard === "reasonCodePresent") {
      return failureResponse({ code: "ORDER_REJECT_REASON_REQUIRED" }, ctx.locale, ctx.requestId);
    }
    if (verdict.guard === "prepTimeInWindow") {
      return failureResponse({ code: "ORDER_PREP_TIME_OUT_OF_RANGE", field: "prepTimeSeconds" }, ctx.locale, ctx.requestId);
    }
    return failureResponse({ code: "ORDER_NOT_ACCEPTABLE" }, ctx.locale, ctx.requestId);
  }

  const nowMs = Date.now();
  const outcome = applyTransition({
    orderId,
    from: row.state,
    to: to as OrderState,
    actor: "VENDOR",
    context: transitionCtx,
    nextSeq: await nextEventSeq(ctx.db, row.id),
    nowMs,
    reasonCode,
  });

  const moved = await moveState(ctx.db, {
    orderId: row.id,
    eventId: newId(nowMs),
    from: row.state,
    to,
    actor: "VENDOR",
    actorUserId: uuidBytes(principal.userId),
    event: outcome.event.event,
    reasonCode,
    reasonText,
    nowMs,
    extra: to === "ACCEPTED" ? { prep_time_s: prepTime ?? null, accepted_at: new Date(nowMs).toISOString().replace("T", " ").replace("Z", "") } : {},
  });

  if (!moved.applied) {
    // Somebody else moved it between the read and the write; the customer must not be told
    // "accepted" when the state says otherwise.
    return failureResponse({ code: "ORDER_ALREADY_ACCEPTED" }, ctx.locale, ctx.requestId);
  }

  // The audit row is the evidence that a vendor answered in time; `waitUntil` keeps it off the
  // response's critical path, and the chain is ordered by `seq` so a lost tail is detectable.
  await audit.appendAudit(ctx.db, {
    actorId: principal.userId,
    actorType: principal.actorType === "VENDOR_OWNER" ? "VENDOR" : principal.actorType,
    actorRole: principal.role,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    action: to === "ACCEPTED" ? "order.accept" : "order.reject",
    resourceType: "ORDER",
    resourceId: toHexId(row.id),
    subjectId: null,
    before: { state: row.state },
    after: { state: to, seq: moved.seq, prepTimeSeconds: prepTime ?? null },
    reason: reasonCode,
    severity: "NOTICE",
  }, nowMs);

  const updated = await findOrder(ctx.db, row.id);
  return successResponse(
    { order: updated === null ? null : serialiseOrder(updated), seq: moved.seq },
    ctx.locale,
    ctx.requestId,
  );
}

/** The order routes, in the order `08` lists them. */
export const ORDER_ROUTES: readonly RouteDefinition[] = [
  { method: "GET", path: "/v1/orders", permission: "order.list", group: "ORDER_WRITE", run: (ctx) => listMyOrders(ctx) },
  { method: "GET", path: "/v1/orders/{id}", permission: "order.read", group: "ORDER_WRITE", run: (ctx, input) => getOrder(ctx, input.params["id"] as string) },
  {
    method: "POST",
    path: "/v1/orders/{id}/accept",
    permission: "order.accept",
    write: true,
    group: "ORDER_WRITE",
    maxBodyBytes: 4 * 1024,
    run: (ctx, input) => vendorMove(ctx, input.params["id"] as string, "ACCEPTED", input.body),
  },
  {
    method: "POST",
    path: "/v1/orders/{id}/reject",
    permission: "order.reject",
    write: true,
    group: "ORDER_WRITE",
    maxBodyBytes: 4 * 1024,
    run: (ctx, input) => vendorMove(ctx, input.params["id"] as string, "REJECTED", input.body),
  },
];
