/**
 * @file workers/api/src/routes/cart.ts
 * @description Single-vendor customer cart session, line-item mutations, promo voucher binding,
 * and server-authoritative `price_order()` integer-poisha waterfall validation (`Build Response 7`).
 */

import { requireIdempotencyKey } from '../domain-errors.ts';
import { jsonErr, jsonOk } from '../http.ts';
import type { ApiDbAdapter, AuthPrincipal } from '../types.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isNonNegativeInt(val: unknown, max = 10_000_000): val is number {
  return typeof val === 'number' && Number.isInteger(val) && val >= 0 && val <= max;
}

/** Handles `/v1/cart`, `/v1/cart/items`, `/v1/cart/voucher`, and `/v1/cart/validate`. */
export async function handleCartRoute(
  request: Request,
  url: URL,
  db: ApiDbAdapter,
  principal: AuthPrincipal | null,
  requestId: string,
): Promise<Response | null> {
  const path = url.pathname;
  if (!path.startsWith('/v1/cart')) return null;
  if (!principal) return jsonErr('SESSION_EXPIRED', requestId);

  if (path === '/v1/cart' && request.method === 'GET') {
    const state = await db.getCartWithItems(principal.sub);
    return jsonOk(state, requestId, 200, { 'Cache-Control': 'private, no-store' });
  }

  if (path === '/v1/cart' && request.method === 'POST') {
    if (!requireIdempotencyKey(request)) {
      return jsonErr('IDEMPOTENCY_KEY_REQUIRED', requestId);
    }
    const body = (await request.json().catch(() => null)) as {
      readonly vendor_id?: string;
      readonly address_id?: string | null;
      readonly fulfilment?: 'delivery' | 'pickup';
      readonly tip_poisha?: number;
      readonly cutlery_requested?: boolean;
      readonly customer_note?: string | null;
      readonly change_for_poisha?: number | null;
      readonly confirm_clear?: boolean;
    } | null;

    if (!body?.vendor_id || !UUID_RE.test(body.vendor_id)) {
      return jsonErr('VALIDATION_FAILED', requestId, { field: 'vendor_id' });
    }
    const fulfilment = body.fulfilment === 'pickup' ? 'pickup' : 'delivery';
    const tipPoisha = fulfilment === 'pickup' ? 0 : (body.tip_poisha ?? 0);
    if (!isNonNegativeInt(tipPoisha, 100_000)) {
      return jsonErr('VALIDATION_FAILED', requestId, { field: 'tip_poisha' });
    }
    if (body.change_for_poisha !== undefined && body.change_for_poisha !== null && !isNonNegativeInt(body.change_for_poisha)) {
      return jsonErr('VALIDATION_FAILED', requestId, { field: 'change_for_poisha' });
    }
    if (body.address_id && !UUID_RE.test(body.address_id)) {
      return jsonErr('VALIDATION_FAILED', requestId, { field: 'address_id' });
    }

    const res = await db.upsertCartSession({
      customerId: principal.sub,
      vendorId: body.vendor_id,
      addressId: body.address_id ?? null,
      fulfilment,
      tipPoisha,
      cutleryRequested: Boolean(body.cutlery_requested),
      customerNote: typeof body.customer_note === 'string' ? body.customer_note.trim().slice(0, 300) : null,
      changeForPoisha: body.change_for_poisha ?? null,
      confirmClear: Boolean(body.confirm_clear),
    });
    return jsonOk(res, requestId);
  }

  if (path === '/v1/cart/items' && request.method === 'PATCH') {
    if (!requireIdempotencyKey(request)) {
      return jsonErr('IDEMPOTENCY_KEY_REQUIRED', requestId);
    }
    const body = (await request.json().catch(() => null)) as {
      readonly menu_item_id?: string;
      readonly variant_id?: string | null;
      readonly qty?: number;
      readonly selections?: readonly unknown[];
      readonly note?: string | null;
    } | null;

    if (
      !body?.menu_item_id ||
      !UUID_RE.test(body.menu_item_id) ||
      typeof body.qty !== 'number' ||
      !Number.isInteger(body.qty) ||
      body.qty < 0 ||
      body.qty > 50 ||
      (body.variant_id && !UUID_RE.test(body.variant_id))
    ) {
      return jsonErr('VALIDATION_FAILED', requestId, { required: ['menu_item_id', 'qty(0..50)'] });
    }

    const updated = await db.mutateCartItem({
      customerId: principal.sub,
      menuItemId: body.menu_item_id,
      variantId: body.variant_id ?? null,
      qty: body.qty,
      selections: Array.isArray(body.selections) ? body.selections : [],
      note: typeof body.note === 'string' ? body.note.trim().slice(0, 200) : null,
    });
    return jsonOk(updated, requestId);
  }

  if (path === '/v1/cart/voucher') {
    if (request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as { readonly code?: string } | null;
      if (!body?.code || typeof body.code !== 'string' || body.code.trim().length < 3 || body.code.trim().length > 32) {
        return jsonErr('VOUCHER_INVALID', requestId);
      }
      const cart = await db.setCartVoucher(principal.sub, body.code.trim().toUpperCase());
      return jsonOk({ cart }, requestId);
    }
    if (request.method === 'DELETE') {
      const cart = await db.setCartVoucher(principal.sub, null);
      return jsonOk({ cart }, requestId);
    }
    return null;
  }

  if (path === '/v1/cart/validate' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as {
      readonly delivery_fee_poisha?: number;
      readonly platform_fee_poisha?: number;
      readonly is_priority?: boolean;
    };
    const deliveryFee = body.delivery_fee_poisha ?? 4000;
    const platformFee = body.platform_fee_poisha ?? 500;
    if (!isNonNegativeInt(deliveryFee) || !isNonNegativeInt(platformFee)) {
      return jsonErr('VALIDATION_FAILED', requestId);
    }
    const quote = await db.validateCartPricing(
      principal.sub,
      deliveryFee,
      platformFee,
      Boolean(body.is_priority),
    );
    return jsonOk({ quote }, requestId);
  }

  return null;
}
