/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { failureResponse, successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { requireInternalToken } from "../middleware/internal-token.ts";
import { createRealtimeClient } from "../bindings/realtime.ts";
import { parseZoneRing } from "../domain/geo/zone-shape.ts";
import { eligibility, type AssignmentTarget } from "../domain/order/assignment.ts";
import { assembleSnapshots, type FeedFix } from "../domain/order/dispatch-assembly.ts";
import {
  notifiableUsers,
  orderForDispatch,
  rejectedWavesForOrder,
  ridersInZone,
  suspendedRiderIds,
  zonePolygon,
} from "../repositories/dispatch.ts";

/**
 * *May this rider be offered this order?* — answered, and printed (`11 §7`, D122).
 *
 * Nine rungs built the pieces of a dispatch decision and none of them would tell an operator what the decision was.
 * This route is the first that reads the whole picture for one order — the order, its zone's shape, the live riders
 * in that zone, their loads and cash, their suspensions, their devices, and the refusals this order has already
 * collected — and answers with the **verdict per rider** rather than a wave.
 *
 * **It writes nothing, and that is the point of it existing before the writer.** Planning a wave needs `11 §8`'s
 * acceptance model to rank candidates, and that model is not built; a route that invented a probability would
 * produce waves nobody could explain. What it can do today, honestly, is say which riders pass all fourteen filters
 * and — for every rider who does not — exactly which filter refused them. That is the same vocabulary the rider's
 * app will use, and it is what makes an empty wave a diagnosis instead of a mystery.
 *
 * **The refusals carry a filter number, not a sentence.** `{filter: 4, reason: "POSITION_FRESH"}` is deliberately
 * the shape: the number is stable, the name is what the app localises, and neither is a message invented here.
 */

/** The state an order must be in to have candidates considered at all. */
const DISPATCHABLE_STATE = "RIDER_SEARCH";

/** What the route answers: the order, and every rider's verdict. */
interface EligibilityAnswer {
  readonly orderCode: string;
  readonly zoneId: string;
  readonly atMs: number;
  readonly candidates: readonly {
    readonly riderId: string;
    readonly eligible: boolean;
    readonly filter: number | null;
    readonly reason: string | null;
  }[];
  /** Riders the assembly could not describe at all: a data error, not a verdict. */
  readonly unjudgeable: readonly { readonly riderId: string; readonly reason: string }[];
  readonly eligibleCount: number;
}

function nowMs(): number {
  return Date.now();
}

/**
 * Build the target from the order.
 *
 * `totalPaisa` is the customer's total, which is what filter 11 compares against the rider's cash limit — the cash
 * the rider would be carrying if they took this order, not the fee they would earn for it.
 */
function targetFor(order: Awaited<ReturnType<typeof orderForDispatch>>): AssignmentTarget | null {
  if (order === null) return null;
  return { zoneId: order.zoneId, vendorId: order.vendorId, totalPaisa: order.totalPaisa };
}

/** Answer filter verdicts for one order's zone. */
async function dispatchEligibility(ctx: Ctx, body: Record<string, unknown>): Promise<Response> {
  const refusedToken = requireInternalToken(ctx);
  if (refusedToken !== null) return refusedToken;

  const orderCode = typeof body["orderCode"] === "string" ? body["orderCode"].trim() : "";
  if (orderCode === "") {
    return failureResponse({ code: "VALIDATION_FAILED", details: { field: "orderCode" } }, ctx.locale, ctx.requestId);
  }

  const order = await orderForDispatch(ctx.db, orderCode);
  if (order === null) return failureResponse({ code: "ORDER_NOT_FOUND" }, ctx.locale, ctx.requestId);
  if (order.state !== DISPATCHABLE_STATE) {
    return failureResponse(
      { code: "ORDER_NOT_ACCEPTABLE", details: { state: order.state } },
      ctx.locale,
      ctx.requestId,
    );
  }

  const polygon = await zonePolygon(ctx.db, order.zoneIdBytes);
  if (polygon === null) return failureResponse({ code: "ZONE_NOT_FOUND" }, ctx.locale, ctx.requestId);
  const ring = parseZoneRing(polygon);
  if (ring === null) {
    // A zone whose outline will not parse cannot answer filter 7, and dispatch that silently treated every rider as
    // inside it would be a city-wide wave from a bad polygon. Reported once, with the zone, rather than per rider.
    return failureResponse(
      { code: "ZONE_TOO_FEW_POINTS", details: { zoneId: order.zoneId } },
      ctx.locale,
      ctx.requestId,
    );
  }

  const base = ctx.env.REALTIME_BASE;
  const token = ctx.env.INTERNAL_TOKEN;
  if (base === undefined || base === "" || token === undefined || token === "") {
    // Without live positions there are no candidates — not zero candidates. A microservice that answered `[]` here
    // would make every order look like a zone with nobody in it.
    return failureResponse(
      { code: "SERVICE_DEGRADED", details: { component: "realtime", reason: "not_configured" } },
      ctx.locale,
      ctx.requestId,
    );
  }

  const feed = await createRealtimeClient(base, token).candidates({ zoneId: order.zoneId });
  if (!feed.ok) {
    return failureResponse(
      { code: "SERVICE_DEGRADED", details: { component: "realtime", reason: "candidate_feed_unavailable" } },
      ctx.locale,
      ctx.requestId,
    );
  }

  const at = nowMs();
  const [candidates, rejected, notifiable, suspended] = await Promise.all([
    ridersInZone(ctx.db, order.zoneId),
    rejectedWavesForOrder(ctx.db, order.id),
    notifiableUsers(ctx.db),
    suspendedRiderIds(ctx.db, at),
  ]);

  const fixes: FeedFix[] = feed.value.map((candidate) => ({
    riderId: candidate.riderId,
    latE7: candidate.latE7,
    lonE7: candidate.lonE7,
    accuracyM: candidate.accuracyM,
    batteryPct: candidate.batteryPct,
    updatedAtMs: candidate.updatedAtMs,
    staleAfterMs: candidate.staleAfterMs,
  }));

  const target = targetFor(order);
  if (target === null) return failureResponse({ code: "ORDER_NOT_FOUND" }, ctx.locale, ctx.requestId);

  const assembled = assembleSnapshots({
    candidates,
    fixes,
    zones: new Map([[order.zoneId, ring]]),
    vendor: order.pickup,
    target,
    nowMs: at,
    signals: {
      rejectedWavesByRider: rejected,
      // Filter 14 compares **rider row ids** (the snapshot's identity); the device table is keyed by user id, so
      // the translation goes through the candidate's own two ids rather than a second query.
      notificationsAllowed: new Set(
        candidates.filter((candidate) => notifiable.has(hexOf(candidate.userId))).map((c) => hexOf(c.riderId)),
      ),
      suspendedRiders: suspended,
      // No cooldown table yet (`11 §9.2` deferred). Empty is the honest value: no rider is in a cooldown the
      // platform cannot record.
      vendorCooldownRiders: new Set(),
    },
  });

  const verdicts = assembled.snapshots.map((snapshot) => {
    const verdict = eligibility(snapshot, target);
    return {
      riderId: snapshot.riderId,
      eligible: verdict.eligible,
      filter: verdict.filter,
      reason: verdict.reason,
    };
  });

  const answer: EligibilityAnswer = {
    orderCode: order.code,
    zoneId: order.zoneId,
    atMs: at,
    candidates: verdicts,
    unjudgeable: assembled.refusals.map((refusal) => ({ riderId: refusal.riderId, reason: refusal.reason })),
    eligibleCount: verdicts.filter((verdict) => verdict.eligible).length,
  };
  return successResponse(answer, ctx.locale, ctx.requestId);
}

/** The hex form of a binary id, for the two set lookups above. */
function hexOf(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/** The internal dispatch surface. */
export const DISPATCH_ROUTES: readonly RouteDefinition[] = [
  {
    method: "POST",
    path: "/internal/dispatch/eligibility",
    // Internal: the shared token, not a user's permission, and checked as the handler's first act (D82, D116).
    permission: "*",
    // A `POST` that writes nothing: the guardrail wants the declaration, and it is true — the handler reads six
    // tables and a Worker, and the statement-by-statement test asserts that no write reaches the database.
    readOnly: true,
    group: "INTERNAL",
    maxBodyBytes: 512,
    run: async (ctx, input) =>
      dispatchEligibility(
        ctx,
        typeof input.body === "object" && input.body !== null ? (input.body as Record<string, unknown>) : {},
      ),
  },
];
