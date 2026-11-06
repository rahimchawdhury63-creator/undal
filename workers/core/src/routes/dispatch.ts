/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { failureResponse, successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { requireInternalToken } from "../middleware/internal-token.ts";
import * as audit from "../audit/write.ts";
import { announce } from "../bindings/announce.ts";
import { createFcmClient, fcmConfigured, fcmData, fcmStatus, FCM_DEFAULT_ENDPOINT } from "../bindings/fcm.ts";
import { createRealtimeClient } from "../bindings/realtime.ts";
import { newId, toHexId } from "../lib/ids.ts";
import { sqlDatetime } from "../db/time.ts";
import { estimateRoute, ESTIMATED_SPEED_MPS } from "../domain/order/distance.ts";
import { MAX_WAVES, planWaves, type ScoredCandidate } from "../domain/order/assignment.ts";
import { planWaveWrite } from "../domain/order/dispatch-plan.ts";
import { offerAlarm } from "../domain/order/offer-alarm.ts";
import { DEFAULT_MEDIAN_PICKUP_M, scoreCandidates, wilsonLowerBound, type ScoringFacts } from "../domain/order/scoring.ts";
import { idleSeconds, riderHistory, type RiderHistory } from "../repositories/dispatch-stats.ts";
import { claimDispatchLock, insertOfferWave, releaseDispatchLock, waveStateForOrder } from "../repositories/dispatch.ts";
import { insertDispatch, invalidateToken } from "../repositories/dispatches.ts";
import { pushFailureIsPermanent, UNREGISTERED_REASON } from "../domain/order/push-retry.ts";
import { tokensForUser } from "../repositories/recipients.ts";
import { parseZoneRing } from "../domain/geo/zone-shape.ts";
import {
  acceptanceFrom,
  hexOf,
  idleFrom,
  medianDeliveries,
  ratesFrom,
  startOfDayMs,
} from "../domain/order/dispatch-facts.ts";
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

/** How long a planner holds an order's lock: longer than a wave, shorter than a rider's patience. */
const LOCK_TTL_MS = 10_000;

/** The name a lock row carries, so two coordinators are distinguishable in the table. */
const LOCK_HOLDER = "core:dispatch/plan";

/**
 * Plan and write the next wave for an order (`11 §7`, D126).
 *
 * This is the rung the previous nine were for: it reads the order and its zone, asks realtime where the riders are,
 * assembles a snapshot per rider, drops the ones the fourteen filters refuse, scores the rest on their history, plans
 * the waves, writes **the first one** and rings nobody yet — the alarm is the FCM binding's job and the next rung.
 *
 * **Three guards before any work.** A dispatch lock, so a retried trigger and an original cannot both write wave 1
 * (`dispatch_locks` is unique on `order_id` and the claim steals an expired lock rather than waiting). The order must
 * still be searching: an order assigned while the planner was thinking is not a wave, it is a race the claim route
 * won. And no wave of this order may still be live — writing wave 2 while wave 1's phones ring tells eight riders the
 * order is gone when it is not.
 *
 * **Wave 1 only, deliberately.** `planWaves` returns the whole cascade; writing all five would offer the order to
 * five waves of riders at once, which is the opposite of a cascade. The remaining waves are written by the driver that
 * calls this route again when a wave expires (D116's sweep, plus the same caller). Answering with the plan is what
 * lets that caller say *when* to come back.
 */
async function planWave(ctx: Ctx, body: Record<string, unknown>): Promise<Response> {
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

  const at = nowMs();
  const lock = await claimDispatchLock(ctx.db, {
    id: newId(),
    orderId: order.id,
    holder: LOCK_HOLDER,
    nowMs: at,
    ttlMs: LOCK_TTL_MS,
  });
  if (!lock.taken) {
    // `409` with the holder: an operator can see that dispatch is working, rather than reading "busy" and retrying
    // into the same lock.
    return failureResponse(
      { code: "ORDER_LOCKED", details: { holder: lock.holder } },
      ctx.locale,
      ctx.requestId,
    );
  }

  try {
    const waves = await waveStateForOrder(ctx.db, order.id, at);
    if (waves.liveOffers > 0) {
      return failureResponse(
        { code: "OFFER_WAVE_CLOSED", details: { live: waves.liveOffers, wave: waves.lastWave } },
        ctx.locale,
        ctx.requestId,
      );
    }

    const polygon = await zonePolygon(ctx.db, order.zoneIdBytes);
    if (polygon === null) return failureResponse({ code: "ZONE_NOT_FOUND" }, ctx.locale, ctx.requestId);
    const ring = parseZoneRing(polygon);
    if (ring === null) {
      return failureResponse(
        { code: "ZONE_TOO_FEW_POINTS", details: { zoneId: order.zoneId } },
        ctx.locale,
        ctx.requestId,
      );
    }

    const base = ctx.env.REALTIME_BASE;
    const token = ctx.env.INTERNAL_TOKEN;
    if (base === undefined || base === "" || token === undefined || token === "") {
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

    const [candidates, rejected, notifiable, suspended] = await Promise.all([
      ridersInZone(ctx.db, order.zoneId),
      rejectedWavesForOrder(ctx.db, order.id),
      notifiableUsers(ctx.db),
      suspendedRiderIds(ctx.db, at),
    ]);

    const target = { zoneId: order.zoneId, vendorId: order.vendorId, totalPaisa: order.totalPaisa };
    const assembled = assembleSnapshots({
      candidates,
      fixes: feed.value.map((candidate) => ({
        riderId: candidate.riderId,
        latE7: candidate.latE7,
        lonE7: candidate.lonE7,
        accuracyM: candidate.accuracyM,
        batteryPct: candidate.batteryPct,
        updatedAtMs: candidate.updatedAtMs,
        staleAfterMs: candidate.staleAfterMs,
      })),
      zones: new Map([[order.zoneId, ring]]),
      vendor: order.pickup,
      target,
      nowMs: at,
      signals: {
        rejectedWavesByRider: rejected,
        notificationsAllowed: new Set(
          candidates.filter((candidate) => notifiable.has(hexOf(candidate.userId))).map((c) => hexOf(c.riderId)),
        ),
        suspendedRiders: suspended,
        vendorCooldownRiders: new Set(),
      },
    });

    const eligible = assembled.snapshots.filter((snapshot) => eligibility(snapshot, target).eligible);
    if (eligible.length === 0) {
      // Not an error: a zone with nobody available is the state the fallback ladder exists for. The answer carries the
      // per-rider verdicts so the caller can log *why* rather than "no riders".
      return successResponse(
        { orderCode: order.code, wave: null, offered: [], pNone: 1, reason: "NO_ELIGIBLE_CANDIDATES" },
        ctx.locale,
        ctx.requestId,
      );
    }

    const history = await riderHistory(ctx.db, {
      riderIds: eligible.map((snapshot) => Buffer.from(snapshot.riderId, "hex")),
      vendorId: Buffer.from(order.vendorId, "hex"),
      nowMs: at,
      dayStartMs: startOfDayMs(at),
    });

    const readyInS = order.readyAtMs === null ? 0 : Math.round((order.readyAtMs - at) / 1000);
    const scoringFacts = eligible.map((snapshot) => {
      const past = history.get(snapshot.riderId);
      const distanceM = snapshot.routedDistanceToVendorM;
      const facts: ScoringFacts = {
        riderId: snapshot.riderId,
        routedDistanceToVendorM: distanceM,
        // The same straight-line estimate the fee uses (`D67`), turned into seconds at the documented speed. When
        // routing lands, both move together.
        arrivalAtVendorS: Math.round(distanceM / ESTIMATED_SPEED_MPS),
        readyInS,
        acceptanceRate: acceptanceFrom(past),
        completionRate: ratesFrom(past).completion,
        onTimeRate: ratesFrom(past).onTime,
        idleS: idleFrom(past, at),
        deliveriesToday: past?.deliveriesToday ?? 0,
        ratingLowerBound: 0,
        deliveriesFromVendor: past?.deliveredFromVendor ?? 0,
        // No delivery-cell column on `orders`, so factor 8 has no evidence (D125).
        deliveriesIntoCell: 0,
        batchFeasibility: 0,
        currentLoad: snapshot.currentLoad,
        maxConcurrent: snapshot.maxConcurrent,
        cashInHandPaisa: snapshot.cashInHandPaisa,
        cashLimitPaisa: snapshot.cashLimitPaisa,
        coverageValue: 1,
        positionAgeS: Number.isFinite(snapshot.positionAgeS) ? snapshot.positionAgeS : 86_400,
        positionStaleAfterS: snapshot.positionStaleAfterS,
        vehicleSuitability: 1,
      };
      return { facts };
    });

    const scored = scoreCandidates(scoringFacts, {
      medianPickupM: DEFAULT_MEDIAN_PICKUP_M,
      medianDeliveriesToday: medianDeliveries(history),
    }, order.totalPaisa);

    const candidatesForPlan: ScoredCandidate[] = scored.map((entry) => ({
      riderId: entry.riderId,
      acceptanceProbability: entry.acceptanceProbability,
      score: entry.score,
    }));
    const plan = planWaves(candidatesForPlan);
    // The wave to write is the *next* one for this order, not wave 1: a second call (the advance driver, D129) must not
    // rewrite wave 1, and `uq_offers_order_rider_wave` would reject it if it tried. `planWaves` always numbers its
    // cascade 1..5, so the next wave is selected by number rather than by position.
    const nextNumber = waves.lastWave + 1;
    // The *contents* are the planner's first wave — the best remaining riders — written under this order's next wave
    // number. `planWaves` numbers a fresh cascade 1..5, so taking its wave 2 would silently skip the best candidates on
    // a re-plan; taking its wave 1 and renumbering is what makes a second call advance rather than repeat.
    const first = plan[0] === undefined ? undefined : { ...plan[0], wave: nextNumber };
    if (nextNumber > MAX_WAVES) {
      // The ladder is exhausted (`11 §11`): five waves asked and nobody took it. Not an error — the caller escalates
      // (expansion, then refund) and this route stops writing.
      return successResponse(
        { orderCode: order.code, wave: null, offered: [], pNone: 1, reason: "LADDER_EXHAUSTED" },
        ctx.locale,
        ctx.requestId,
      );
    }
    if (first === undefined) {
      return successResponse(
        { orderCode: order.code, wave: null, offered: [], pNone: 1, reason: "NO_WAVE_PLANNED" },
        ctx.locale,
        ctx.requestId,
      );
    }

    const planned = planWaveWrite(first, { nowMs: at, payoutPaisa: order.riderPayoutPaisa, scored: candidatesForPlan });
    const traceId = newId();
    // The offer rows carry their ids from here on: the alarm has to name the offer the rider will accept, and D128
    // named the *rider* instead — a deep link that could only ever 404 (D131).
    const offers = planned.offers.map((offer) => ({ ...offer, id: newId() }));
    const written = await insertOfferWave(ctx.db, {
      orderId: order.id,
      wave: planned.wave,
      traceId,
      offeredAtMs: at,
      expiresAtMs: planned.expiresAtMs,
      offers,
    });

    await audit.appendAudit(
      ctx.db,
      {
        actorId: null,
        actorType: "SYSTEM",
        actorRole: null,
        ip: null,
        userAgent: null,
        requestId: ctx.requestId,
        action: "dispatch.wave.plan",
        resourceType: "order",
        resourceId: order.code,
        subjectId: null,
        after: {
          wave: planned.wave,
          offered: planned.offers.length,
          pNone: planned.pNone,
          expiresAtMs: planned.expiresAtMs,
          unjudgeable: assembled.refusals,
        },
        reason: null,
        severity: "INFO",
      },
      at,
    );

    // Ring the wave. One alarm per offered rider, each with their own audience, because the rider channel is keyed by
    // the user id and the offer row only carries the rider row id (`D110`'s distinction, again). Then, for a phone
    // whose socket is closed, one push per valid token — recorded against the token whether it lands or not (D128).
    const userOf = new Map(candidates.map((candidate) => [hexOf(candidate.riderId), hexOf(candidate.userId)]));
    for (const offer of offers) {
      const riderId = Buffer.from(offer.riderId).toString("hex");
      const riderUserId = userOf.get(riderId);
      if (riderUserId === undefined) continue;
      const alarm = offerAlarm({
        orderCode: order.code,
        offerId: toHexId(offer.id),
        payoutPaisa: offer.payoutPaisa,
        pickupDistanceM: assembled.snapshots.find((snapshot) => snapshot.riderId === riderId)?.routedDistanceToVendorM ?? 0,
        expiresAtMs: planned.expiresAtMs,
        nowMs: at,
      });
      announce(ctx, {
        zoneId: order.zoneId,
        orderId: order.code,
        event: alarm.event,
        payload: { ...alarm.data, title: alarm.title, body: alarm.body },
        audience: { riderUserId },
      });

      if (!fcmConfigured(ctx.env)) continue;
      const sender = createFcmClient({
        endpoint: ctx.env.FCM_ENDPOINT ?? FCM_DEFAULT_ENDPOINT,
        projectId: ctx.env.FCM_PROJECT_ID ?? "",
        accessToken: ctx.env.FCM_ACCESS_TOKEN ?? "",
      });
      // The wire format wants strings, and a number sent as a number is a message the runtime rejects (D131).
      const data = fcmData({ ...alarm.data, titleEn: alarm.title.en, titleBn: alarm.title.bn });
      const userBytes = Buffer.from(riderUserId, "hex");
      // The pushes are queued, not awaited: eight phones are eight round trips, and an offer's twenty-five seconds are
      // the rider's, not the network's.
      ctx.waitUntil(
        (async () => {
          const tokens = await tokensForUser(ctx.db, userBytes);
          for (const token of tokens) {
            const result = await sender.send({ token, data });
            await insertDispatch(ctx.db, {
              id: newId(),
              orderId: order.id,
              deviceId: null,
              token,
              // The attempt counts sends to *this token*, so a first send is attempt 1 on every device (D131);
              // D128 numbered by position in the list and gave a rider's second phone an attempt it never had.
              attempt: 1,
              outcome: result.ok ? "SENT" : "FAILED",
              messageId: result.ok ? result.value.messageId : null,
              sentAt: sqlDatetime(new Date(at)),
            });
            // A phone Google answers 404 for is gone; retire it here rather than ringing it again next wave.
            if (!result.ok && pushFailureIsPermanent(fcmStatus(result.error))) {
              await invalidateToken(ctx.db, token, UNREGISTERED_REASON, at);
            }
          }
        })(),
      );
    }

    return successResponse(
      {
        orderCode: order.code,
        wave: planned.wave,
        offered: planned.offers.map((offer) => ({
          riderId: Buffer.from(offer.riderId).toString("hex"),
          rank: offer.rankInWave,
          score: offer.score,
        })),
        written,
        pNone: planned.pNone,
        expiresAtMs: planned.expiresAtMs,
        // The cascade is planned, not written: the caller comes back for wave `wave + 1` when this one expires.
        planned: plan.map((wave) => ({ wave: wave.wave, size: wave.riderIds.length, ttlS: wave.ttlS })),
      },
      ctx.locale,
      ctx.requestId,
    );
  } finally {
    await releaseDispatchLock(ctx.db, order.id, LOCK_HOLDER);
  }
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
  {
    method: "POST",
    path: "/internal/dispatch/plan",
    // Internal for the same reason as the eligibility read: a Worker calls it, not a person.
    permission: "*",
    write: true,
    group: "INTERNAL",
    maxBodyBytes: 512,
    run: async (ctx, input) =>
      planWave(ctx, typeof input.body === "object" && input.body !== null ? (input.body as Record<string, unknown>) : {}),
  },
  {
    method: "POST",
    path: "/internal/dispatch/advance",
    // The same handler under the name the driver calls it by: an order whose wave expired needs *the next* wave, and
    // the difference between "plan" and "advance" is a sentence about intent, not a different code path (D129).
    permission: "*",
    write: true,
    group: "INTERNAL",
    maxBodyBytes: 512,
    run: async (ctx, input) =>
      planWave(ctx, typeof input.body === "object" && input.body !== null ? (input.body as Record<string, unknown>) : {}),
  },
];
