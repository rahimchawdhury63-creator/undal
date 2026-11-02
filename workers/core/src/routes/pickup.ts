/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import * as audit from "../audit/write.ts";
import { announce } from "../bindings/announce.ts";
import { newId, toHexId } from "../lib/ids.ts";
import { sqlDatetime } from "../db/time.ts";
import { failureResponse, successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { uuidBytes } from "../middleware/auth.ts";
import { parsePointE7 } from "../domain/order/distance.ts";
import { admissibleProof, ProofRefused } from "../domain/order/evidence.ts";
import { applyTransition } from "../domain/order/lifecycle.ts";
import { verifyPickupCode } from "../domain/order/qr.ts";
import { buildStateEvent } from "../domain/order/state-events.ts";
import { findOrder, moveState, nextEventSeq } from "../repositories/orders.ts";
import { hasProofOfKind, insertProof } from "../repositories/proofs.ts";

/**
 * The rider collecting the food: `POST /v1/orders/{id}/pickup`.
 *
 * The scan is the only thing that can move an order out of `RIDER_ASSIGNED`, and it must be made *at
 * the counter*: the code is verified against the order's own rotating HMAC and the position is
 * checked against the same 150 m geofence a handover uses (`11 §5`). A rider who scans from home is
 * refused with `QR_TOO_FAR` — the meal has not moved, and the state must not say it has.
 *
 * The proof row, the state event, the SSE frame and the audit row all come out of the same decision,
 * so an accepted scan leaves a trail that agrees with itself.
 */

/** The per-order key the vendor's screen and the rider's camera both sign with. */
export function orderQrSecret(environmentSecret: string, orderId: string): string {
  return `${environmentSecret}:${orderId}`;
}

/** Collect an order. */
async function pickup(ctx: Ctx, orderId: string, body: unknown): Promise<Response> {
  const principal = ctx.principal;
  if (principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);

  let orderBytes: Uint8Array;
  try {
    orderBytes = uuidBytes(orderId);
  } catch {
    return failureResponse({ code: "ORDER_NOT_FOUND" }, ctx.locale, ctx.requestId);
  }

  const row = await findOrder(ctx.db, orderBytes);
  // A rider who is not on this order is told it does not exist, exactly as the read route does.
  if (row === null || row.rider_id === null || toHexId(row.rider_id) !== principal.userId)
    return failureResponse({ code: "ORDER_NOT_FOUND" }, ctx.locale, ctx.requestId);

  const fields = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const presented = fields["code"];
  if (typeof presented !== "string" || presented.length === 0 || presented.length > 256)
    return failureResponse({ code: "VALIDATION_FAILED", details: { field: "code" } }, ctx.locale, ctx.requestId);

  const riderPoint = parsePointE7(fields["point"]);
  if (riderPoint === null) return failureResponse({ code: "VALIDATION_FAILED", details: { field: "point" } }, ctx.locale, ctx.requestId);

  const nowMs = Date.now();
  const vendorPoint = { latE7: Number(row.pickup_lat_e7), lonE7: Number(row.pickup_lon_e7) };

  const scan = await verifyPickupCode({
    presented,
    secret: orderQrSecret(ctx.env.ORDER_QR_SECRET, toHexId(row.id)),
    orderCode: row.code,
    riderPoint,
    vendorPoint,
    nowMs,
    // A scan for an order that is not waiting at the counter has no meaning, whatever it contains.
    alreadyScanned: row.state !== "RIDER_ASSIGNED",
  });
  if (!scan.ok) return failureResponse({ code: scan.code }, ctx.locale, ctx.requestId);

  const proof = {
    kind: "PICKUP_QR" as const,
    orderId: toHexId(row.id),
    mediaId: null,
    payload: { code: presented, window: scan.window },
    point: riderPoint,
    capturedAtMs: nowMs,
  };
  // The domain decides admissibility; the geofence has already passed, so what is left here is the
  // payload and the age, which a forged request can still get wrong.
  try {
    admissibleProof(proof, { point: vendorPoint, nowMs });
  } catch (error) {
    if (error instanceof ProofRefused) return failureResponse({ code: "QR_INVALID", details: { reason: error.message } }, ctx.locale, ctx.requestId);
    throw error;
  }

  const seq = await nextEventSeq(ctx.db, orderBytes);
  const outcome = applyTransition({
    orderId: toHexId(row.id),
    from: "RIDER_ASSIGNED",
    to: "PICKED_UP",
    actor: "RIDER",
    // The guards are given the facts the scanner produced rather than the request's claims.
    context: { pickupCodeMatches: true, riderDistanceToVendorM: scan.distanceM, fulfilment: row.fulfilment as "DELIVERY" | "PICKUP" },
    nextSeq: seq,
    nowMs,
  });

  const moved = await moveState(ctx.db, {
    orderId: orderBytes,
    eventId: newId(),
    from: "RIDER_ASSIGNED",
    to: "PICKED_UP",
    actor: "RIDER",
    actorUserId: uuidBytes(principal.userId),
    event: outcome.event.event,
    reasonCode: null,
    reasonText: null,
    nowMs,
    extra: { picked_up_at: sqlDatetime(new Date(nowMs)) },
  });

  if (!moved.applied) {
    // Somebody else moved the order between the scan and the update. The event row is written only
    // for the move that actually happened, so a lost race leaves no phantom in the history.
    return failureResponse({ code: "ORDER_ALREADY_PICKED_UP" }, ctx.locale, ctx.requestId);
  }

  const proofId = await insertProof(ctx.db, proof);
  const alreadyHasScan = await hasProofOfKind(ctx.db, orderBytes, "PICKUP_QR");

  const event = buildStateEvent({
    orderId: toHexId(row.id),
    seq,
    fromState: "RIDER_ASSIGNED",
    toState: "PICKED_UP",
    actor: "RIDER",
    actorUserId: principal.userId,
    metadata: { proofId, window: scan.window, distanceM: Math.round(scan.distanceM), duplicateScan: alreadyHasScan },
    occurredAtMs: nowMs,
  });

  await audit.appendAudit(
    ctx.db,
    {
      actorId: principal.userId,
      actorType: "RIDER",
      actorRole: principal.role,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      action: "order.pickup",
      resourceType: "ORDER",
      resourceId: toHexId(row.id),
      subjectId: null,
      before: { state: "RIDER_ASSIGNED" },
      after: { state: "PICKED_UP", seq, proofId },
      reason: null,
      severity: "NOTICE",
    },
    nowMs,
  );

  // A pickup is the transition a customer watches for most closely: the meal is on the road.
  announce(ctx, {
    zoneId: toHexId(row.zone_id),
    orderId: row.code,
    event: outcome.event.event,
    payload: { orderId: row.code, state: "PICKED_UP", seq },
    seq,
  });

  return successResponse(
    {
      id: toHexId(row.id),
      state: "PICKED_UP",
      seq,
      event: outcome.event.event,
      proofId,
      distanceM: Math.round(scan.distanceM),
    },
    ctx.locale,
    ctx.requestId,
  );
}

/** The pickup route. */
export const PICKUP_ROUTES: readonly RouteDefinition[] = [
  {
    method: "POST",
    path: "/v1/orders/{id}/pickup",
    permission: "order.pickup",
    write: true,
    group: "ORDER_WRITE",
    maxBodyBytes: 4_096,
    run: async (ctx, input) => pickup(ctx, input.params["id"] ?? "", input.body),
  },
];
