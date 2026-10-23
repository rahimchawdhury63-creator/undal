/**
 * @file workers/realtime/src/routes/realtime-alerts.ts
 * @description `Build Response 9` HTTP routes on `W2 undal-realtime` (`06-api-contract-final.md` `B09`):
 *   - `POST /v1/realtime/token` — Participant-verified RS256 Firebase Custom Token minter gated
 *     strictly by `RtdbLeaseBroker` (`< 85 / 100` Spark ceiling -> seamless `5000ms` polling fallback)
 *   - `POST /v1/alerts/test` — Dispatches live high-priority data-only `test_alarm` FCM (`ALM-01`)
 *     for Partner/Rider Alarm-Health self-test onboarding (`p-07` / `r-06`)
 *   - `GET /v1/cashgate/config` — Serves `UNDAL_BKASH_NUMBER` / `UNDAL_NAGAD_NUMBER` exclusively to
 *     KYC-approved riders from Worker secret bindings (`0` hardcoded numbers in APKs!)
 */

import { dispatchDataOnlyFcm } from '../fcm-sender.ts';
import { checkRateLimit, jsonErr, jsonOk } from '../http.ts';
import { GLOBAL_RTDB_LEASE_BROKER, type LeaseActorKind } from '../rtdb-broker.ts';
import type { AuthPrincipal, RealtimeDbAdapter, RealtimeWorkerEnv } from '../types.ts';

/** Handles `POST /v1/realtime/token`, `POST /v1/alerts/test`, and `GET /v1/cashgate/config`. */
export async function handleRealtimeTokenAndAlertRoutes(params: {
  readonly request: Request;
  readonly pathname: string;
  readonly requestId: string;
  readonly principal: AuthPrincipal | null;
  readonly env: RealtimeWorkerEnv;
  readonly db: RealtimeDbAdapter;
  readonly nowMs: number;
}): Promise<Response | null> {
  const { request, pathname, requestId, principal, env, db, nowMs } = params;

  // 1. `POST /v1/realtime/token` — Spark `< 85 / 100` lease broker + RS256 custom token minter
  if (request.method === 'POST' && pathname === '/v1/realtime/token') {
    if (!principal) return jsonErr('SESSION_EXPIRED', requestId);
    const rl = checkRateLimit(`rtdb-tok:${principal.sub}`, 10, 60_000, nowMs);
    if (!rl.allowed) {
      return jsonErr('RATE_LIMITED', requestId, undefined, { 'Retry-After': String(rl.retryAfterSeconds) });
    }

    let body: { order_id?: string; release?: boolean; slot?: number } = {};
    try {
      const txt = await request.text();
      if (txt.trim().length > 0) body = JSON.parse(txt) as typeof body;
    } catch {
      return jsonErr('VALIDATION_FAILED', requestId);
    }

    const identity = await db.getOperatorIdentity(principal.sub, principal.role);
    const claims: Record<string, string> = { role: principal.role };
    if (identity?.kind === 'vendor') claims['vendor_id'] = identity.refId;
    if (identity?.kind === 'rider') claims['rider_id'] = identity.refId;

    let actorKind: LeaseActorKind;
    let scopeKey: string;
    let dbPath: string;
    let fallbackPath: string;

    if (body.order_id) {
      const meta = db.getOrderAccessMeta ? await db.getOrderAccessMeta(body.order_id) : null;
      if (!meta) return jsonErr('ORDER_STATE_ILLEGAL', requestId, { reason: 'order_not_found' }, undefined, 404);

      const allowed =
        principal.role === 'admin' ||
        meta.customerId === principal.sub ||
        (identity?.kind === 'vendor' && meta.vendorId === identity.refId) ||
        (identity?.kind === 'rider' && meta.riderId === identity.refId);
      if (!allowed) {
        return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);
      }

      actorKind =
        principal.role === 'rider'
          ? 'rider'
          : principal.role === 'vendor_owner' || principal.role === 'vendor_staff'
            ? 'vendor'
            : principal.role === 'admin'
              ? 'admin'
              : 'customer';
      scopeKey =
        actorKind === 'vendor' && identity
          ? `outlet:${identity.refId}`
          : actorKind === 'admin'
            ? `${principal.sub}:${body.slot === 2 ? '2' : '1'}`
            : `${principal.sub}:${meta.orderId}`;
      dbPath = `o/${meta.orderId}`;
      fallbackPath = `/v1/orders/${meta.publicCode}/live`;
    } else if (identity?.kind === 'vendor') {
      actorKind = 'vendor';
      scopeKey = `outlet:${identity.refId}`;
      dbPath = `p/v/${identity.refId}`;
      fallbackPath = '/v1/orders';
    } else if (identity?.kind === 'rider') {
      actorKind = 'rider';
      scopeKey = `session:${identity.refId}`;
      dbPath = `p/r/${identity.refId}`;
      fallbackPath = '/v1/orders';
    } else if (principal.role === 'admin') {
      actorKind = 'admin';
      scopeKey = `${principal.sub}:${body.slot === 2 ? '2' : '1'}`;
      dbPath = `inbox/${principal.sub}/last`;
      fallbackPath = '/v1/admin/dispatch/board';
    } else {
      return jsonErr('VALIDATION_FAILED', requestId, { required: 'order_id' });
    }

    if (body.release) {
      const released = GLOBAL_RTDB_LEASE_BROKER.releaseLease(`${actorKind}:${scopeKey}`);
      return jsonOk(
        { released, activeLeases: GLOBAL_RTDB_LEASE_BROKER.countActive(nowMs) },
        requestId,
      );
    }

    const hardCap = Number(env.RTDB_LEASE_HARD_CAP ?? '85');
    const grant = await GLOBAL_RTDB_LEASE_BROKER.acquireTokenOrPollFallback({
      profileId: principal.sub,
      actorKind,
      scopeKey,
      dbPath,
      fallbackPath,
      claims,
      hardCap,
      realtimeMode: env.REALTIME_MODE ?? 'rtdb',
      rtdbUrl: env.FIREBASE_RTDB_URL,
      serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON,
      nowMs,
    });

    return jsonOk(grant, requestId);
  }

  // 2. `POST /v1/alerts/test` — Alarm-Health self-test data-only FCM (`p-07` / `r-06`)
  if (request.method === 'POST' && pathname === '/v1/alerts/test') {
    if (!principal) return jsonErr('SESSION_EXPIRED', requestId);
    if (
      principal.role !== 'vendor_owner' &&
      principal.role !== 'vendor_staff' &&
      principal.role !== 'rider' &&
      principal.role !== 'admin'
    ) {
      return jsonErr('AUTH_ROLE_MISMATCH', requestId);
    }
    const rl = checkRateLimit(`alert-test:${principal.sub}`, 5, 60_000, nowMs);
    if (!rl.allowed) {
      return jsonErr('RATE_LIMITED', requestId, undefined, { 'Retry-After': String(rl.retryAfterSeconds) });
    }

    const report = await dispatchDataOnlyFcm({
      recipientProfileIds: [principal.sub],
      orderId: null,
      eventType: 'test_alarm',
      fields: {
        duration_seconds: '5',
        stream: 'STREAM_ALARM',
      },
      serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON,
      hmacSecret: env.INTERNAL_HMAC_SECRET ?? 'example-default-wake-hmac-key',
      db,
      fetchImpl: env.fetchImpl ?? fetch,
      nowMs,
      retryDelayMs: 5,
    });

    return jsonOk(
      {
        event_type: 'test_alarm',
        data_only: true,
        ...report,
      },
      requestId,
    );
  }

  // 3. `GET /v1/cashgate/config` — Wallet numbers exclusively from Worker secrets (`D-03`)
  if (request.method === 'GET' && pathname === '/v1/cashgate/config') {
    if (!principal) return jsonErr('SESSION_EXPIRED', requestId);
    if (principal.role !== 'rider') return jsonErr('AUTH_ROLE_MISMATCH', requestId);
    const rl = checkRateLimit(`cashgate-cfg:${principal.sub}`, 10, 60_000, nowMs);
    if (!rl.allowed) {
      return jsonErr('RATE_LIMITED', requestId, undefined, { 'Retry-After': String(rl.retryAfterSeconds) });
    }

    const preFlight = await db.getRiderPreFlight(principal.sub);
    if (!preFlight || preFlight.kycStatus !== 'approved') {
      return jsonErr('KYC_INCOMPLETE', requestId);
    }

    return jsonOk(
      {
        bkash_number: env.UNDAL_BKASH_NUMBER ?? null,
        nagad_number: env.UNDAL_NAGAD_NUMBER ?? null,
        configured: Boolean(env.UNDAL_BKASH_NUMBER || env.UNDAL_NAGAD_NUMBER),
        merchant_label_en: 'Undal Rider Cash Remittance',
        merchant_label_bn: 'উন্দাল রাইডার ক্যাশ জমা',
        unremitted_cash_poisha: preFlight.unremittedCashPoisha,
        cash_ceiling_poisha: preFlight.cashCeilingPoisha,
        cash_gate_blocked: preFlight.cashGateBlocked,
      },
      requestId,
    );
  }

  return null;
}
