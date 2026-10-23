/**
 * @file workers/realtime/src/dispatch-fanout.ts
 * @description Parallel Firebase RTDB active-order room projection + Data-Only FCM wake fan-out
 * (`File 06 §6.3–6.5` & `File 07 §7.4–7.5`):
 *   - Order offer issued -> parallel `o/{orderId}` RTDB write + `vendor_new_order` + `rider_offer`
 *   - Offer accepted / expired -> `alert_cancel` to silence looping Kotlin `AlarmForegroundService`
 *     plus RTDB `status` / `riderId` sync on `o/{orderId}`
 */

import { dispatchDataOnlyFcm } from './fcm-sender.ts';
import { RtdbRoomClient } from './rtdb-broker.ts';
import type {
  DispatchOrderSnapshot,
  OfferRecord,
  RealtimeDbAdapter,
  RealtimeWorkerEnv,
} from './types.ts';

function buildRoomClient(env: RealtimeWorkerEnv): RtdbRoomClient {
  return new RtdbRoomClient({
    rtdbUrl: env.FIREBASE_RTDB_URL,
    serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON,
    fetchImpl: env.fetchImpl ?? fetch,
  });
}

/**
 * Executes parallel RTDB `o/{orderId}` room creation/update and high-priority data-only FCM
 * `vendor_new_order` (attempt 1 across all outlet devices) + `rider_offer` wakes (`File 07 §7.5`).
 */
export async function fanOutOrderOfferIssued(params: {
  readonly order: DispatchOrderSnapshot;
  readonly offer: OfferRecord;
  readonly attemptNumber: number;
  readonly fallbackVendorProfileId: string | undefined;
  readonly env: RealtimeWorkerEnv;
  readonly db: RealtimeDbAdapter;
  readonly nowMs: number;
}): Promise<void> {
  const { order, offer, attemptNumber, fallbackVendorProfileId, env, db, nowMs } = params;
  const rtdb = buildRoomClient(env);
  const wakeSecret = env.INTERNAL_HMAC_SECRET ?? 'example-default-wake-hmac-key';

  const outletTargets =
    attemptNumber === 1 && db.listVendorOutletProfileIds
      ? await db.listVendorOutletProfileIds(order.vendorId)
      : attemptNumber === 1 && fallbackVendorProfileId
        ? [fallbackVendorProfileId]
        : [];

  await Promise.all([
    rtdb.upsertOrderRoom({
      orderId: order.orderId,
      customerId: order.customerId,
      vendorId: order.vendorId,
      riderId: null,
      zoneId: order.zoneId,
      status: order.status,
      etaEpochSec: Math.floor((order.prepReadyAtMs + 12 * 60_000) / 1_000),
      vendorPoint: order.vendorPoint,
      customerPoint: order.customerPoint,
      currentOffer: {
        riderId: offer.riderId,
        expEpochSec: Math.floor(offer.expiresAtMs / 1_000),
      },
      nowMs,
    }),
    outletTargets.length > 0
      ? dispatchDataOnlyFcm({
          recipientProfileIds: outletTargets,
          orderId: order.orderId,
          eventType: 'vendor_new_order',
          fields: {
            order_id: order.orderId,
            code: order.publicCode,
            cod_poisha: String(order.codCollectPoisha),
            placed_at: String(order.placedAtMs),
          },
          serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON,
          hmacSecret: wakeSecret,
          db,
          fetchImpl: env.fetchImpl ?? fetch,
          nowMs,
          retryDelayMs: 5,
        })
      : Promise.resolve(),
    dispatchDataOnlyFcm({
      recipientProfileIds: [offer.riderProfileId],
      orderId: order.orderId,
      eventType: 'rider_offer',
      fields: {
        order_id: order.orderId,
        offer_id: offer.id,
        fare_poisha: String(offer.farePoisha),
        expires_at: String(offer.expiresAtMs),
      },
      serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON,
      hmacSecret: wakeSecret,
      db,
      fetchImpl: env.fetchImpl ?? fetch,
      nowMs,
      retryDelayMs: 5,
    }),
  ]);
}

/**
 * Silences looping `AlarmForegroundService` on the target rider device(s) (`alert_cancel`) and
 * mirrors room status changes (`RIDER_ASSIGNED` or `CANCELLED`) into Firebase RTDB (`File 07 §7.4`).
 */
export async function fanOutOfferResolution(params: {
  readonly offer: OfferRecord;
  readonly resolution: 'accepted' | 'expired' | 'rejected';
  readonly env: RealtimeWorkerEnv;
  readonly db: RealtimeDbAdapter;
  readonly nowMs: number;
}): Promise<void> {
  const { offer, resolution, env, db, nowMs } = params;
  const rtdb = buildRoomClient(env);
  const wakeSecret = env.INTERNAL_HMAC_SECRET ?? 'example-default-wake-hmac-key';

  await Promise.all([
    dispatchDataOnlyFcm({
      recipientProfileIds: [offer.riderProfileId],
      orderId: offer.orderId,
      eventType: 'alert_cancel',
      fields: {
        order_id: offer.orderId,
        offer_id: offer.id,
        reason: resolution,
      },
      serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON,
      hmacSecret: wakeSecret,
      db,
      fetchImpl: env.fetchImpl ?? fetch,
      nowMs,
      retryDelayMs: 5,
    }),
    resolution === 'accepted'
      ? rtdb.patchOrderRoomResolution({
          orderId: offer.orderId,
          status: 'RIDER_ASSIGNED',
          riderId: offer.riderId,
          nowMs,
        })
      : Promise.resolve(),
  ]);
}
