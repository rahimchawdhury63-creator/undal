/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The push behind the ring (`15 §9`, D128, D131).
 *
 * Extracted from the planning route when the route ran out of room for the acceptance model (D133): the *decision* to
 * ring is the planner's, and the eighteen lines that turn one offer into one push per device are a different
 * responsibility that happens to be called from the same place.
 *
 * **Queued, not awaited.** Eight phones are eight round trips and an offer's twenty-five seconds belong to the rider,
 * so the sends go out on `waitUntil` — a failed push must not delay the response that tells the driver a wave exists.
 *
 * **A failure is a row, not a throw.** Every token gets an `fcm_dispatches` row whether the send landed or not, because
 * the row is what support reads when a rider asks why their phone stayed quiet; and a 404 retires the token, because
 * Google is saying the app is gone and the next wave does not need to ask again (D131).
 */

import { createFcmClient, fcmConfigured, fcmData, fcmStatus, FCM_DEFAULT_ENDPOINT } from "../bindings/fcm.ts";
import { sqlDatetime } from "../db/time.ts";
import type { OfferAlarm } from "../domain/order/offer-alarm.ts";
import { pushFailureIsPermanent, UNREGISTERED_REASON } from "../domain/order/push-retry.ts";
import { newId } from "../lib/ids.ts";
import type { Ctx } from "../middleware/context.ts";
import { insertDispatch, invalidateToken } from "../repositories/dispatches.ts";
import { tokensForUser } from "../repositories/recipients.ts";

/** What one push needs: the order, the rider's *user* id, the alarm and the moment the wave was planned. */
export interface WavePush {
  readonly orderId: Uint8Array;
  readonly riderUserId: string;
  readonly alarm: OfferAlarm;
  readonly atMs: number;
}

/**
 * Ring every valid device of one offered rider.
 *
 * Absent credentials are absence of behaviour (D85's rule): no push, and no row claiming one happened. The `attempt` is
 * 1 for every device — it counts sends to *this token*, which is what makes D131's retry arithmetic mean something.
 */
export function pushWaveOffer(ctx: Ctx, push: WavePush): void {
  if (!fcmConfigured(ctx.env)) return;
  const sender = createFcmClient({
    endpoint: ctx.env.FCM_ENDPOINT ?? FCM_DEFAULT_ENDPOINT,
    projectId: ctx.env.FCM_PROJECT_ID ?? "",
    accessToken: ctx.env.FCM_ACCESS_TOKEN ?? "",
  });
  // The wire format wants strings, and a number sent as a number is a message the runtime rejects (D131).
  const data = fcmData({ ...push.alarm.data, titleEn: push.alarm.title.en, titleBn: push.alarm.title.bn });
  const userBytes = Buffer.from(push.riderUserId, "hex");
  ctx.waitUntil(
    (async () => {
      const tokens = await tokensForUser(ctx.db, userBytes);
      for (const token of tokens) {
        const result = await sender.send({ token, data });
        await insertDispatch(ctx.db, {
          id: newId(),
          orderId: push.orderId,
          deviceId: null,
          token,
          attempt: 1,
          outcome: result.ok ? "SENT" : "FAILED",
          messageId: result.ok ? result.value.messageId : null,
          sentAt: sqlDatetime(new Date(push.atMs)),
        });
        if (!result.ok && pushFailureIsPermanent(fcmStatus(result.error))) {
          await invalidateToken(ctx.db, token, UNREGISTERED_REASON, push.atMs);
        }
      }
    })(),
  );
}
