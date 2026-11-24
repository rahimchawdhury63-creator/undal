/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `POST /internal/dispatch/pushes/retry` — the second chance for an alarm that did not land (`15 §8`, D131).
 *
 * D128 sends one push per valid token and records the outcome. A `FAILED` row was previously the end of the road:
 * Google returned a 503, the socket timed out at 1 500 ms, and the rider's phone stayed dark for the whole
 * twenty-five seconds of an offer that was still theirs to take. Most of those failures are transient and the
 * offer is still live, so one more call is cheap and the alternative is a rider who never knew.
 *
 * **The log answers the question, and the policy decides.** `retryCandidates` is one statement whose joins *are*
 * the policy — unanswered offer, unexpired, token still valid, no later row for that token, attempts left — so the
 * handler has no judgement of its own to get wrong. What it does own is the send and its record, which is why the
 * retry writes an `fcm_dispatches` row exactly like the first send did: a retried alarm that lands is evidence, and
 * an attempt history with a hole in it is not.
 *
 * **A 404 prunes.** A permanent failure invalidates the `device_tokens` row, which is what stops the next pass from
 * trying again — the `valid = 1` join is the whole of "do not retry a dead phone", and it is also what keeps a
 * support question ("when did this handset stop getting orders?") answerable from the token's own timestamp.
 *
 * **No audit row per phone.** One row per pass, at `INFO`, listing the orders and the four counters: the per-device
 * detail lives in `fcm_dispatches`, which is where `dispatch-log` already puts it.
 */

import * as audit from "../audit/write.ts";
import { createFcmClient, fcmConfigured, fcmData, fcmStatus, FCM_DEFAULT_ENDPOINT } from "../bindings/fcm.ts";
import { sqlDatetime } from "../db/time.ts";
import { offerAlarm } from "../domain/order/offer-alarm.ts";
import {
  MAX_PUSH_ATTEMPTS,
  MAX_RETRIES_PER_PASS,
  nextAttempt,
  pushFailureIsPermanent,
  RETRY_AFTER_MS,
  RETRY_MIN_REMAINING_MS,
  UNREGISTERED_REASON,
} from "../domain/order/push-retry.ts";
import { newId, toHexId } from "../lib/ids.ts";
import { requireInternalToken } from "../middleware/internal-token.ts";
import { successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { insertDispatch, invalidateToken, retryCandidates } from "../repositories/dispatches.ts";

/** Where the tick asks for a retry pass. */
export const PUSH_RETRY_PATH = "/internal/dispatch/pushes/retry";

/** What one pass counted, which is also what it answers. */
interface RetryCounters {
  readonly retried: number;
  readonly sent: number;
  readonly failed: number;
  readonly pruned: number;
}

/** The prune reason for a refused send: the status is what support needs, so it travels in the column. */
function invalidReason(status: number | null): string {
  return status === 404 ? UNREGISTERED_REASON : `FCM_REJECTED_${String(status ?? 0)}`;
}

/** One pass: read the candidates, re-send each, record what happened. */
async function retryPushes(ctx: Ctx): Promise<Response> {
  // The route is declared anonymous so the pipeline does not demand a session from a Worker; its first act is the
  // shared token, and an absent token is a refusal rather than a wildcard (D82).
  const refused = requireInternalToken(ctx);
  if (refused !== null) return refused;
  const nowMs = Date.now();

  if (!fcmConfigured(ctx.env)) {
    // Absent credentials are a configuration state, not an error (D85's rule): nothing is sent, nothing is recorded,
    // and the answer says `configured: false` so a caller can tell it apart from a pass that found no failures.
    return successResponse(
      { retried: 0, sent: 0, failed: 0, pruned: 0, configured: false, atMs: nowMs },
      ctx.locale,
      ctx.requestId,
    );
  }

  const candidates = await retryCandidates(ctx.db, {
    nowMs,
    maxAttempts: MAX_PUSH_ATTEMPTS,
    retryAfterMs: RETRY_AFTER_MS,
    minRemainingMs: RETRY_MIN_REMAINING_MS,
    limit: MAX_RETRIES_PER_PASS,
  });
  if (candidates.length === 0) {
    // The common case by far — a pass with nothing to do must not touch `fcm_dispatches` or the audit chain, or the
    // table becomes a heartbeat and the chain a metronome.
    return successResponse(
      { retried: 0, sent: 0, failed: 0, pruned: 0, configured: true, atMs: nowMs },
      ctx.locale,
      ctx.requestId,
    );
  }

  const sender = createFcmClient({
    endpoint: ctx.env.FCM_ENDPOINT ?? FCM_DEFAULT_ENDPOINT,
    projectId: ctx.env.FCM_PROJECT_ID ?? "",
    accessToken: ctx.env.FCM_ACCESS_TOKEN ?? "",
  });

  const counters = { retried: 0, sent: 0, failed: 0, pruned: 0 } satisfies Record<keyof RetryCounters, number>;
  const orderCodes = new Set<string>();
  for (const candidate of candidates) {
    // The alarm is rebuilt from the offer row rather than remembered: the ranking pass that built the first one
    // belonged to the request that planned the wave. Payout and countdown are the offer's own, so a retried alarm
    // shows the rider the same number the first one would have. The pickup distance is `0` — the routing snapshots
    // are gone, and inventing a distance would be worse than omitting one (D131).
    const alarm = offerAlarm({
      orderCode: candidate.orderCode,
      offerId: toHexId(candidate.offerId),
      payoutPaisa: candidate.payoutPaisa,
      pickupDistanceM: 0,
      expiresAtMs: candidate.expiresAtMs,
      nowMs,
    });
    const data = fcmData({ ...alarm.data, titleEn: alarm.title.en, titleBn: alarm.title.bn });
    const result = await sender.send({ token: candidate.token, data });
    await insertDispatch(ctx.db, {
      id: newId(),
      orderId: candidate.orderId,
      deviceId: null,
      token: candidate.token,
      attempt: nextAttempt(candidate.attempt),
      outcome: result.ok ? "SENT" : "FAILED",
      messageId: result.ok ? result.value.messageId : null,
      sentAt: sqlDatetime(new Date(nowMs)),
    });
    counters.retried += 1;
    orderCodes.add(candidate.orderCode);
    if (result.ok) {
      counters.sent += 1;
      continue;
    }
    counters.failed += 1;
    const status = fcmStatus(result.error);
    if (!pushFailureIsPermanent(status)) continue;
    // A token that can never work again is retired here rather than in a nightly sweep: the next wave reads
    // `valid`, and a dead phone that stays valid costs one wasted round trip per offer until somebody notices.
    if (await invalidateToken(ctx.db, candidate.token, invalidReason(status), nowMs)) counters.pruned += 1;
  }

  await audit.appendAudit(ctx.db, {
    actorId: null,
    actorType: "SYSTEM",
    actorRole: null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    action: "dispatch.push.retry",
    resourceType: "ORDER",
    resourceId: null,
    subjectId: null,
    before: null,
    after: {
      orders: [...orderCodes],
      retried: counters.retried,
      sent: counters.sent,
      failed: counters.failed,
      pruned: counters.pruned,
    },
    reason: null,
    severity: "INFO",
  });

  return successResponse({ ...counters, configured: true, atMs: nowMs }, ctx.locale, ctx.requestId);
}

/** The retry surface. One route: a pass is a pass, and the sweep decides when it runs. */
export const PUSH_RETRY_ROUTES: readonly RouteDefinition[] = [
  {
    method: "POST",
    path: PUSH_RETRY_PATH,
    // Internal: the shared token, not a user's permission, and checked as the handler's first act (D82, D116).
    permission: "*",
    write: true,
    group: "INTERNAL",
    // The body is empty by design — the pass reads its own work from the log — so the cap is the smallest that
    // still lets a client send `{}`.
    maxBodyBytes: 64,
    run: async (ctx) => retryPushes(ctx),
  },
];
