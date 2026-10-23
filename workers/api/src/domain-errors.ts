/**
 * @file workers/api/src/domain-errors.ts
 * @description Deterministic PostgreSQL/PostgREST domain error mapper, Haversine meter geofence
 * calculator, `Idempotency-Key` extractor, and `W2 undal-realtime` HMAC dispatch webhook signer.
 */

import type { UndalErrorCode } from '@undal/shared-ts';
import { jsonErr } from './http.ts';
import type { ApiWorkerEnv } from './types.ts';

/** Extracts and validates a mandatory `Idempotency-Key` header (`8..128` chars per `0010_promos_and_carts.sql`). */
export function requireIdempotencyKey(request: Request): string | null {
  const raw = request.headers.get('Idempotency-Key') ?? request.headers.get('idempotency-key');
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length >= 8 && trimmed.length <= 128 ? trimmed : null;
}

/** Computes great-circle Haversine distance in meters between two WGS84 pins (`File 12` & `File 22`). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Computes exact hex SHA-256 handover token matching SQL `public.compute_pickup_qr_token(order_id, nonce, secret)`. */
export async function computePickupQrTokenHex(orderId: string, nonce: string, secret: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${orderId}:${nonce}:${secret}`),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Signs and dispatches an internal event to `W2 undal-realtime` when configured (`X-Undal-Signature`). */
export async function notifyRealtimeDispatch(
  env: ApiWorkerEnv,
  endpointPath: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (!env.REALTIME_WORKER_URL || !env.INTERNAL_HMAC_SECRET) return false;
  const fetcher = env.__fetchImpl ?? fetch;
  const body = JSON.stringify(payload);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.INTERNAL_HMAC_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const sigHex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const target = `${env.REALTIME_WORKER_URL.replace(/\/+$/, '')}${endpointPath}`;
  const res = await fetcher(target, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Undal-Signature': sigHex,
    },
    body,
  }).catch(() => null);
  return Boolean(res?.ok);
}

const PG_PREFIX_TO_CATALOG: ReadonlyArray<readonly [string, UndalErrorCode, number?]> = [
  ['CART_VENDOR_CONFLICT', 'CART_VENDOR_CONFLICT'],
  ['CART_STALE', 'CART_STALE'],
  ['CART_EMPTY', 'VALIDATION_FAILED'],
  ['BELOW_MIN_ORDER', 'MIN_ORDER_NOT_MET'],
  ['OUT_OF_ZONE', 'OUTSIDE_ZONE'],
  ['VENDOR_CLOSED', 'VENDOR_CLOSED'],
  ['PICKUP_DISABLED', 'VENDOR_CLOSED'],
  ['ITEM_UNAVAILABLE', 'ITEM_UNAVAILABLE'],
  ['INVALID_VARIANT', 'ITEM_UNAVAILABLE'],
  ['VOUCHER_MIN_ORDER', 'VOUCHER_MIN_ORDER'],
  ['VOUCHER_INVALID', 'VOUCHER_INVALID'],
  ['VOUCHER_LIMIT_REACHED', 'VOUCHER_INVALID'],
  ['VOUCHER_BUDGET_EXHAUSTED', 'VOUCHER_INVALID'],
  ['COD_LIMIT_EXCEEDED', 'VALIDATION_FAILED'],
  ['ORDER_NOT_FOUND', 'VALIDATION_FAILED', 404],
  ['ILLEGAL_ORDER_TRANSITION', 'ORDER_STATE_ILLEGAL'],
  ['PICKUP_NOT_READY', 'ORDER_STATE_ILLEGAL'],
  ['CHAT_READ_ONLY', 'ORDER_STATE_ILLEGAL'],
  ['REVIEW_ORDER_NOT_COMPLETED', 'ORDER_STATE_ILLEGAL'],
  ['PICKUP_TOKEN_MISMATCH', 'QR_INVALID'],
  ['PICKUP_WRONG_RIDER', 'AUTH_FORBIDDEN_PERMISSION'],
  ['PICKUP_UNAUTHORIZED', 'AUTH_FORBIDDEN_PERMISSION'],
  ['REVIEW_NOT_BUYER', 'AUTH_FORBIDDEN_PERMISSION'],
  ['ACCOUNT_INACTIVE', 'AUTH_ACCOUNT_SUSPENDED'],
  ['DOOR_PROTOCOL_INCOMPLETE', 'VALIDATION_FAILED'],
  ['CANCEL_REASON_REQUIRED', 'VALIDATION_FAILED'],
  ['RIDER_CASH_CEILING_EXCEEDED', 'CASH_CEILING_REACHED'],
  ['RIDER_NOT_FOUND', 'AUTH_ROLE_MISMATCH'],
];

/** Converts PostgreSQL/PostgREST domain exceptions into standard bilingual `Appendix G` HTTP responses. */
export function mapDomainErrorToResponse(err: unknown, requestId: string): Response {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('bkash_trxid') || message.includes('TRXID_DUPLICATE') || message.includes('remittances_bkash_trxid_key')) {
    return jsonErr('TRXID_DUPLICATE', requestId);
  }
  for (const [prefix, code, statusOverride] of PG_PREFIX_TO_CATALOG) {
    if (message.includes(prefix)) {
      return jsonErr(code, requestId, { domain_reason: prefix }, undefined, statusOverride);
    }
  }
  return jsonErr('SERVER_BUSY', requestId);
}
