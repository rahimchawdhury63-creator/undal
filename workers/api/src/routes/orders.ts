/**
 * @file workers/api/src/routes/orders.ts
 * @description Core COD Order Engine for `W1 undal-api` (`Build Response 7`):
 *   - Atomic idempotent `POST /v1/orders` (`place_order()` + Turnstile check + `W2` HMAC dispatch)
 *   - Role-scoped `GET /v1/orders`, `GET /v1/orders/:code` (`HOME_KITCHEN` address & QR privacy rules)
 *   - Seamless HTTP polling fallback `GET /v1/orders/:code/live` with `ETag` `304 Not Modified`
 *   - Full 14-state actor-guarded lifecycle transitions (`accept`, `reject`, `preparing`, `ready`,
 *     `arrived-vendor`, `pickup-verify`, `picked-up`, `arrived-customer`, `delivered`,
 *     `failed-delivery`, and window-guarded `cancel`).
 */

import {
  computePickupQrTokenHex,
  haversineMeters,
  notifyRealtimeDispatch,
  requireIdempotencyKey,
} from '../domain-errors.ts';
import { CORS_HEADERS, jsonErr, jsonOk } from '../http.ts';
import type { ApiDbAdapter, ApiWorkerEnv, AuthPrincipal, OrderAccessContext } from '../types.ts';

function isVendorOperatorCtx(ctx: OrderAccessContext, userId: string): boolean {
  return ctx.vendor.owner_profile_id === userId || ctx.staffRole !== null;
}

function isParticipantCtx(ctx: OrderAccessContext, p: AuthPrincipal): boolean {
  return (
    p.role === 'admin' ||
    ctx.order.customer_id === p.sub ||
    isVendorOperatorCtx(ctx, p.sub) ||
    ctx.riderProfileId === p.sub
  );
}

async function sanitizeOrderForViewer(
  ctx: OrderAccessContext,
  viewer: AuthPrincipal,
  qrSecret: string | undefined,
): Promise<Record<string, unknown>> {
  const { order, vendor } = ctx;
  const status = String(order.status ?? '');
  const fulfilment = String(order.fulfilment ?? 'delivery');
  const isAdmin = viewer.role === 'admin';
  const isVendor = isVendorOperatorCtx(ctx, viewer.sub);
  const isAssignedRider = ctx.riderProfileId === viewer.sub;
  const isCustomer = order.customer_id === viewer.sub;

  const { pickup_qr_nonce: nonceRaw, pickup_code_4: code4Raw, ...safeOrder } = order;
  const nonce = typeof nonceRaw === 'string' ? nonceRaw : '';

  const showHandoverSecret =
    isAdmin ||
    (fulfilment === 'delivery' && isVendor) ||
    (fulfilment === 'pickup' && isCustomer);

  const pickupQrToken =
    showHandoverSecret && qrSecret && nonce
      ? await computePickupQrTokenHex(String(order.id), nonce, qrSecret)
      : null;

  const canSeeHomeKitchenExactPin =
    vendor.type !== 'HOME_KITCHEN' ||
    isAdmin ||
    isVendor ||
    (isAssignedRider && ['RIDER_ASSIGNED', 'RIDER_AT_VENDOR', 'PICKED_UP'].includes(status)) ||
    (isCustomer && fulfilment === 'pickup' && ['VENDOR_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'DELIVERED'].includes(status));

  return {
    ...safeOrder,
    pickup_qr_token: pickupQrToken,
    pickup_code_4: showHandoverSecret ? code4Raw : null,
    vendor_location: canSeeHomeKitchenExactPin
      ? {
          public_area_label: vendor.public_area_label,
          address_text: vendor.address_text_private,
          lat: vendor.lat,
          lng: vendor.lng,
          counter_phone: isAssignedRider || isVendor || isAdmin ? vendor.counter_phone : null,
        }
      : {
          public_area_label: vendor.public_area_label,
          address_text: null,
          lat: null,
          lng: null,
          counter_phone: null,
        },
  };
}

/** Handles all `/v1/orders*` endpoints on `W1 undal-api`. */
export async function handleOrdersRoute(
  request: Request,
  url: URL,
  env: ApiWorkerEnv,
  db: ApiDbAdapter,
  principal: AuthPrincipal | null,
  requestId: string,
): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith('/v1/orders')) return null;
  if (!principal) return jsonErr('SESSION_EXPIRED', requestId);

  if (path === '/v1/orders' && request.method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '25') || 25, 1), 100);
    const orders = await db.listActorOrders(principal.sub, principal.role, limit);
    const sanitized = orders.map(({ pickup_qr_nonce: _n, pickup_code_4: _c, ...rest }) => rest);
    return jsonOk({ orders: sanitized }, requestId, 200, { 'Cache-Control': 'private, no-store' });
  }

  if (path === '/v1/orders' && request.method === 'POST') {
    const idemKey = requireIdempotencyKey(request);
    if (!idemKey) return jsonErr('IDEMPOTENCY_KEY_REQUIRED', requestId);

    const body = (await request.json().catch(() => ({}))) as {
      readonly expected_cod_poisha?: number | null;
      readonly delivery_fee_poisha?: number;
      readonly platform_fee_poisha?: number;
      readonly is_priority?: boolean;
      readonly turnstile_token?: string;
    };

    if (env.TURNSTILE_SECRET_KEY) {
      if (!body.turnstile_token) return jsonErr('VALIDATION_FAILED', requestId, { field: 'turnstile_token' });
      const fetcher = env.__fetchImpl ?? fetch;
      const tsRes = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: body.turnstile_token }),
      });
      const tsJson = (await tsRes.json().catch(() => null)) as { success?: boolean } | null;
      if (!tsJson?.success) return jsonErr('VALIDATION_FAILED', requestId, { reason: 'TURNSTILE_REJECTED' });
    }

    const placed = await db.placeOrder({
      customerId: principal.sub,
      idempotencyKey: idemKey,
      expectedCodPoisha: typeof body.expected_cod_poisha === 'number' ? body.expected_cod_poisha : null,
      deliveryFeePoisha: typeof body.delivery_fee_poisha === 'number' ? body.delivery_fee_poisha : 4000,
      platformFeePoisha: typeof body.platform_fee_poisha === 'number' ? body.platform_fee_poisha : 500,
      isPriority: Boolean(body.is_priority),
    });

    let dispatchNotified = false;
    if (placed.idempotent_replay !== true && typeof placed.order_id === 'string') {
      dispatchNotified = await notifyRealtimeDispatch(env, '/v1/dispatch/order-placed', {
        order_id: placed.order_id,
        public_code: placed.public_code,
        cod_collect_poisha: placed.cod_collect_poisha,
      });
    }

    return jsonOk(
      { ...placed, dispatch_notified: dispatchNotified },
      requestId,
      placed.idempotent_replay === true ? 200 : 201,
    );
  }

  const liveMatch = /^\/v1\/orders\/([A-Za-z0-9-]+)\/live$/.exec(path);
  if (liveMatch && request.method === 'GET') {
    const ctx = await db.getOrderAccessContext(liveMatch[1]!, principal.sub);
    if (!ctx) return jsonErr('VALIDATION_FAILED', requestId, { domain_reason: 'ORDER_NOT_FOUND' }, undefined, 404);
    if (!isParticipantCtx(ctx, principal)) return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);

    const etag = `W/"${String(ctx.order.id)}:${String(ctx.order.status)}:${String(ctx.order.updated_at)}"`;
    if (request.headers.get('If-None-Match') === etag) {
      return new Response(null, { status: 304, headers: { ...CORS_HEADERS, ETag: etag } });
    }
    const view = await sanitizeOrderForViewer(ctx, principal, env.QR_SIGNING_SECRET);
    const { events } = await db.getOrderItemsAndEvents(String(ctx.order.id));
    return jsonOk({ order: view, events }, requestId, 200, { ETag: etag, 'Cache-Control': 'private, no-cache' });
  }

  const detailMatch = /^\/v1\/orders\/([A-Za-z0-9-]+)$/.exec(path);
  if (detailMatch && request.method === 'GET') {
    const ctx = await db.getOrderAccessContext(detailMatch[1]!, principal.sub);
    if (!ctx) return jsonErr('VALIDATION_FAILED', requestId, { domain_reason: 'ORDER_NOT_FOUND' }, undefined, 404);
    if (!isParticipantCtx(ctx, principal)) return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);

    const [view, details] = await Promise.all([
      sanitizeOrderForViewer(ctx, principal, env.QR_SIGNING_SECRET),
      db.getOrderItemsAndEvents(String(ctx.order.id)),
    ]);
    return jsonOk({ order: view, items: details.items, events: details.events }, requestId, 200, {
      'Cache-Control': 'private, no-store',
    });
  }

  const ORDER_LIFECYCLE_ACTIONS = new Set([
    'accept', 'reject', 'preparing', 'ready', 'arrived-vendor',
    'pickup-verify', 'picked-up', 'arrived-customer', 'delivered',
    'failed-delivery', 'cancel',
  ]);
  const actionMatch = /^\/v1\/orders\/([0-9a-f-]{36})\/([a-z-]+)$/i.exec(path);
  if (!actionMatch || request.method !== 'POST' || !ORDER_LIFECYCLE_ACTIONS.has(actionMatch[2]!)) {
    return null;
  }

  const orderId = actionMatch[1]!;
  const action = actionMatch[2]!;
  if (!requireIdempotencyKey(request)) {
    return jsonErr('IDEMPOTENCY_KEY_REQUIRED', requestId);
  }

  const ctx = await db.getOrderAccessContext(orderId, principal.sub);
  if (!ctx) return jsonErr('VALIDATION_FAILED', requestId, { domain_reason: 'ORDER_NOT_FOUND' }, undefined, 404);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const isVendor = isVendorOperatorCtx(ctx, principal.sub);
  const isAssignedRider = ctx.riderProfileId === principal.sub;
  const isCustomer = ctx.order.customer_id === principal.sub;

  if (action === 'accept') {
    if (!isVendor) return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);
    const prepMinutes = Number(body.prep_minutes ?? 20);
    if (!Number.isInteger(prepMinutes) || prepMinutes < 3 || prepMinutes > 240) {
      return jsonErr('VALIDATION_FAILED', requestId, { field: 'prep_minutes' });
    }
    const updated = await db.transitionOrder({
      orderId,
      actorId: principal.sub,
      actorKind: 'vendor',
      toStatus: 'VENDOR_ACCEPTED',
      meta: { prep_minutes_committed: prepMinutes },
    });
    await notifyRealtimeDispatch(env, '/v1/dispatch/vendor-accepted', { order_id: orderId, prep_minutes: prepMinutes });
    return jsonOk({ order: updated }, requestId);
  }

  if (action === 'reject') {
    if (!isVendor) return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);
    const reasonKey = typeof body.cancel_reason_key === 'string' ? body.cancel_reason_key.trim() : '';
    if (!reasonKey) return jsonErr('VALIDATION_FAILED', requestId, { field: 'cancel_reason_key' });
    const snoozeIds = Array.isArray(body.snooze_item_ids)
      ? body.snooze_item_ids.filter((x): x is string => typeof x === 'string')
      : [];
    const snoozedCount = await db.snoozeMenuItems(ctx.vendor.id, snoozeIds, 120);
    const updated = await db.transitionOrder({
      orderId,
      actorId: principal.sub,
      actorKind: 'vendor',
      toStatus: 'CANCELLED_VENDOR',
      meta: { cancel_reason_key: reasonKey, snoozed_count: snoozedCount },
    });
    return jsonOk({ order: updated, snoozed_count: snoozedCount }, requestId);
  }

  if (action === 'preparing' || action === 'ready') {
    if (!isVendor) return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);
    const updated = await db.transitionOrder({
      orderId,
      actorId: principal.sub,
      actorKind: 'vendor',
      toStatus: action === 'ready' ? 'READY_FOR_PICKUP' : 'PREPARING',
      meta: {},
    });
    return jsonOk({ order: updated }, requestId);
  }

  if (action === 'arrived-vendor') {
    if (!isAssignedRider) return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);
    if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
      return jsonErr('LOCATION_REQUIRED', requestId);
    }
    const distM = haversineMeters(body.lat, body.lng, ctx.vendor.lat, ctx.vendor.lng);
    if (distM > 150) {
      return jsonErr('GPS_INACCURATE', requestId, { distance_m: Math.round(distM), max_allowed_m: 150 });
    }
    const updated = await db.transitionOrder({
      orderId,
      actorId: principal.sub,
      actorKind: 'rider',
      toStatus: 'RIDER_AT_VENDOR',
      meta: { distance_m: Math.round(distM) },
    });
    return jsonOk({ order: updated, distance_m: Math.round(distM) }, requestId);
  }

  if (action === 'pickup-verify') {
    if (!env.QR_SIGNING_SECRET) return jsonErr('SERVER_BUSY', requestId);
    const updated = await db.verifyPickupHandover({
      orderId,
      actorProfileId: principal.sub,
      secret: env.QR_SIGNING_SECRET,
      qrToken: typeof body.qr_token === 'string' ? body.qr_token.trim() : null,
      code4: typeof body.code_4 === 'string' ? body.code_4.trim() : null,
      feedbackRating: typeof body.pickup_feedback_rating === 'number' ? body.pickup_feedback_rating : null,
      feedbackTags: Array.isArray(body.pickup_feedback_tags)
        ? body.pickup_feedback_tags.filter((x): x is string => typeof x === 'string')
        : [],
    });
    return jsonOk({ order: updated }, requestId);
  }

  if (action === 'picked-up') {
    if (!isAssignedRider) return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);
    const rating = Number(body.pickup_feedback_rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return jsonErr('VALIDATION_FAILED', requestId, { field: 'pickup_feedback_rating' });
    }
    const tags = Array.isArray(body.pickup_feedback_tags)
      ? body.pickup_feedback_tags.filter((x): x is string => typeof x === 'string')
      : [];
    const updated = await db.recordRiderPickupFeedback(orderId, rating, tags);
    return jsonOk({ order: updated }, requestId);
  }

  if (action === 'arrived-customer') {
    if (!isAssignedRider) return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);
    if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
      return jsonErr('LOCATION_REQUIRED', requestId);
    }
    const snap = ctx.order.address_snapshot as { lat?: number; lng?: number } | null;
    if (snap && typeof snap.lat === 'number' && typeof snap.lng === 'number') {
      const distM = haversineMeters(body.lat, body.lng, snap.lat, snap.lng);
      if (distM > 200) {
        return jsonErr('GPS_INACCURATE', requestId, { distance_m: Math.round(distM), max_allowed_m: 200 });
      }
    }
    const updated = await db.transitionOrder({
      orderId,
      actorId: principal.sub,
      actorKind: 'rider',
      toStatus: 'RIDER_AT_CUSTOMER',
      meta: {},
    });
    return jsonOk({ order: updated }, requestId);
  }

  if (action === 'delivered') {
    if (!isAssignedRider) return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);
    const updated = await db.transitionOrder({
      orderId,
      actorId: principal.sub,
      actorKind: 'rider',
      toStatus: 'DELIVERED',
      meta: { cod_collected_confirmed: true },
    });
    const cashGate = await db.getRiderCashGateByProfile(principal.sub);
    return jsonOk({ order: updated, cash_gate: cashGate }, requestId);
  }

  if (action === 'failed-delivery') {
    if (!isAssignedRider) return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);
    const waitMinutes = Number(body.wait_minutes ?? 0);
    const callAttempts = Number(body.call_attempts ?? 0);
    const proofPublicId = typeof body.proof_public_id === 'string' ? body.proof_public_id.trim() : '';
    if (!proofPublicId.startsWith('undal/private/dispute_evidence/')) {
      return jsonErr('VALIDATION_FAILED', requestId, {
        field: 'proof_public_id',
        hint: 'Doorstep proof must be uploaded to Cloudinary Private Vault (undal/private/dispute_evidence/*).',
      });
    }
    const updated = await db.transitionOrder({
      orderId,
      actorId: principal.sub,
      actorKind: 'rider',
      toStatus: 'FAILED_DELIVERY',
      meta: { wait_minutes: waitMinutes, call_attempts: callAttempts, proof_public_id: proofPublicId },
    });
    return jsonOk({ order: updated }, requestId);
  }

  if (action === 'cancel') {
    const reasonKey = typeof body.cancel_reason_key === 'string' ? body.cancel_reason_key.trim() : '';
    if (!reasonKey) return jsonErr('VALIDATION_FAILED', requestId, { field: 'cancel_reason_key' });
    if (isCustomer) {
      if (ctx.order.status !== 'PLACED') {
        return jsonErr('ORDER_STATE_ILLEGAL', requestId, { domain_reason: 'CUSTOMER_CANCEL_WINDOW_CLOSED' });
      }
      const updated = await db.transitionOrder({
        orderId,
        actorId: principal.sub,
        actorKind: 'customer',
        toStatus: 'CANCELLED_CUSTOMER',
        meta: { cancel_reason_key: reasonKey },
      });
      return jsonOk({ order: updated }, requestId);
    }
    if (isVendor) {
      const updated = await db.transitionOrder({
        orderId,
        actorId: principal.sub,
        actorKind: 'vendor',
        toStatus: 'CANCELLED_VENDOR',
        meta: { cancel_reason_key: reasonKey },
      });
      return jsonOk({ order: updated }, requestId);
    }
    return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId);
  }

  return null;
}
