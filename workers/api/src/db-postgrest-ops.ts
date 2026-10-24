/**
 * @file workers/api/src/db-postgrest-ops.ts
 * @description Part 2 Supabase PostgREST + RPC HTTP methods for `W1 undal-api` (`Build Responses 7/14`):
 * customer addresses, favourites, carts & eligible voucher wallet, and core order lifecycle RPCs.
 */

import { createPostgrestOnboardingMethods } from './db-postgrest-onboarding.ts';
import { createPostgrestSocialOpsMethods } from './db-postgrest-social-ops.ts';
import type { ApiDbAdapter } from './types.ts';

export interface PostgrestTransport {
  getJson<T>(pathAndQuery: string): Promise<T>;
  sendJson<T>(method: 'POST' | 'PATCH' | 'DELETE', pathAndQuery: string, body?: unknown, prefer?: string): Promise<T>;
  callRpc<T>(fnName: string, args: Record<string, unknown>): Promise<T>;
  resolveZone(lat: number, lng: number): Promise<Record<string, unknown>>;
}

interface OrderVendorRow {
  readonly id: string;
  readonly slug?: string;
  readonly owner_profile_id: string;
  readonly type: string;
  readonly lat: number;
  readonly lng: number;
  readonly public_area_label: string;
  readonly address_text_private: string;
  readonly counter_phone: string;
  readonly pickup_point_label: string | null;
}

/** Parses exact non-negative PostgREST money/count fields without accepting unsafe numbers. */
function nonNegativeBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

/** Builds Part 2 transactional/operator PostgREST adapter methods without any third-party SDK. */
export function createPostgrestOpsMethods(t: PostgrestTransport) {
  const socialOps = createPostgrestSocialOpsMethods(t);
  const onboardingOps = createPostgrestOnboardingMethods(t);

  return {
    ...socialOps,
    ...onboardingOps,

    async listCustomerAddresses(profileId: string) {
      return await t.getJson<Record<string, unknown>[]>(
        `customer_addresses?profile_id=eq.${encodeURIComponent(profileId)}&order=is_default.desc,created_at.desc`,
      );
    },

    async saveCustomerAddress(input: Parameters<ApiDbAdapter['saveCustomerAddress']>[0]) {
      const zone = await t.resolveZone(input.lat, input.lng);
      const zoneId = zone.in_service_area === true && typeof zone.zone_id === 'string' ? zone.zone_id : null;
      if (input.isDefault) {
        await t.sendJson('PATCH', `customer_addresses?profile_id=eq.${encodeURIComponent(input.profileId)}&is_default=eq.true`, { is_default: false });
      }
      const payload = {
        profile_id: input.profileId,
        label: input.label,
        lat: input.lat,
        lng: input.lng,
        geohash: '',
        address_text: input.addressText,
        delivery_instructions: input.deliveryInstructions,
        zone_id: zoneId,
        is_default: input.isDefault,
      };
      const rows = input.addressId
        ? await t.sendJson<Record<string, unknown>[]>(
            'PATCH',
            `customer_addresses?id=eq.${encodeURIComponent(input.addressId)}&profile_id=eq.${encodeURIComponent(input.profileId)}`,
            payload,
          )
        : await t.sendJson<Record<string, unknown>[]>('POST', 'customer_addresses', payload);
      return rows[0] ?? {};
    },

    async deleteCustomerAddress(profileId: string, addressId: string) {
      const rows = await t.sendJson<unknown[]>(
        'DELETE',
        `customer_addresses?id=eq.${encodeURIComponent(addressId)}&profile_id=eq.${encodeURIComponent(profileId)}`,
      );
      return rows.length > 0;
    },

    async listFavourites(customerId: string) {
      const favourites = await t.getJson<Record<string, unknown>[]>(
        `favourites?customer_id=eq.${encodeURIComponent(customerId)}&order=created_at.desc&limit=1000`,
      );
      const vendorIds = [...new Set(favourites.map((row) => row.vendor_id).filter((id): id is string => typeof id === 'string'))];
      if (vendorIds.length === 0) return [];
      const cards = await t.getJson<Record<string, unknown>[]>(
        `public_vendor_cards?id=in.(${vendorIds.map(encodeURIComponent).join(',')})&select=id,brand_name,brand_name_bn,slug,public_area_label,logo_url,cover_url,rating_avg,rating_count`,
      );
      const byId = new Map(cards.map((row) => [String(row.id), row]));
      return favourites.map((row) => {
        const vendorId = typeof row.vendor_id === 'string' ? row.vendor_id : '';
        const vendor = byId.get(vendorId) ?? { id: vendorId };
        return { vendor_id: vendorId, vendor };
      }).filter((row) => row.vendor_id.length > 0);
    },

    async toggleFavourite(customerId: string, vendorId: string) {
      const existing = await t.getJson<unknown[]>(
        `favourites?customer_id=eq.${encodeURIComponent(customerId)}&vendor_id=eq.${encodeURIComponent(vendorId)}`,
      );
      if (existing.length > 0) {
        await t.sendJson('DELETE', `favourites?customer_id=eq.${encodeURIComponent(customerId)}&vendor_id=eq.${encodeURIComponent(vendorId)}`);
        return { is_favourite: false };
      }
      await t.sendJson('POST', 'favourites', { customer_id: customerId, vendor_id: vendorId });
      return { is_favourite: true };
    },

    /** Lists only current offers allowed by server-side time, use, budget, and first-order rules. */
    async listAvailableVouchers(customerId: string) {
      const now = encodeURIComponent(new Date().toISOString());
      const active = await t.getJson<Array<Record<string, unknown>>>(
        `vouchers?is_active=eq.true&starts_at=lte.${now}&ends_at=gt.${now}&select=id,code,title_en,title_bn,kind,value_num,cap_poisha,min_order_poisha,max_uses_per_user,first_order_only,budget_cap_poisha,budget_spent_poisha,ends_at&order=ends_at.asc&limit=50`,
      );
      const voucherIds = active.map((row) => row.id).filter((id): id is string => typeof id === 'string');
      if (voucherIds.length === 0) return [];
      const idFilter = voucherIds.join(',');
      const [redemptions, priorOrders] = await Promise.all([
        t.getJson<Array<{ voucher_id: string }>>(
          `voucher_redemptions?customer_id=eq.${encodeURIComponent(customerId)}&voucher_id=in.(${idFilter})&select=voucher_id&limit=5000`,
        ),
        t.getJson<Array<{ id: string }>>(
          `orders?customer_id=eq.${encodeURIComponent(customerId)}&select=id&limit=1`,
        ),
      ]);
      const redemptionCounts = new Map<string, number>();
      for (const row of redemptions) redemptionCounts.set(row.voucher_id, (redemptionCounts.get(row.voucher_id) ?? 0) + 1);
      const hasPriorOrder = priorOrders.length > 0;
      return active.filter((row) => {
        const id = typeof row.id === 'string' ? row.id : '';
        const maximum = nonNegativeBigInt(row.max_uses_per_user);
        const budget = nonNegativeBigInt(row.budget_cap_poisha);
        const spent = nonNegativeBigInt(row.budget_spent_poisha);
        return id.length > 0 && maximum !== null && BigInt(redemptionCounts.get(id) ?? 0) < maximum &&
          budget !== null && spent !== null && spent < budget && !(row.first_order_only === true && hasPriorOrder);
      }).map(({ id, code, title_en, title_bn, kind, value_num, cap_poisha, min_order_poisha, ends_at }) => ({
        id, code, title_en, title_bn, kind, value_num, cap_poisha, min_order_poisha, ends_at,
      }));
    },

    async getCartWithItems(customerId: string) {
      const carts = await t.getJson<Record<string, unknown>[]>(`carts?customer_id=eq.${encodeURIComponent(customerId)}&limit=1`);
      const cart = carts[0] ?? null;
      if (!cart || typeof cart.id !== 'string') return { cart: null, items: [] };
      const items = await t.getJson<Record<string, unknown>[]>(`cart_items?cart_id=eq.${encodeURIComponent(cart.id)}&order=created_at.asc`);
      return { cart, items };
    },

    async upsertCartSession(input: Parameters<ApiDbAdapter['upsertCartSession']>[0]) {
      const existing = await this.getCartWithItems(input.customerId);
      let clearedPrevious = false;
      if (existing.cart && existing.cart.vendor_id !== input.vendorId) {
        if (!input.confirmClear && existing.items.length > 0) {
          throw new Error('CART_VENDOR_CONFLICT: basket already contains items from another kitchen');
        }
        await t.sendJson('DELETE', `carts?customer_id=eq.${encodeURIComponent(input.customerId)}`);
        clearedPrevious = true;
      }
      const rows = await t.sendJson<Record<string, unknown>[]>(
        'POST',
        'carts?on_conflict=customer_id',
        {
          customer_id: input.customerId,
          vendor_id: input.vendorId,
          address_id: input.addressId,
          fulfilment: input.fulfilment,
          tip_poisha: input.tipPoisha,
          cutlery_requested: input.cutleryRequested,
          customer_note: input.customerNote,
          change_for_poisha: input.changeForPoisha,
        },
        'resolution=merge-duplicates,return=representation',
      );
      return { cart: rows[0] ?? {}, clearedPrevious };
    },

    async mutateCartItem(input: Parameters<ApiDbAdapter['mutateCartItem']>[0]) {
      const state = await this.getCartWithItems(input.customerId);
      if (!state.cart || typeof state.cart.id !== 'string') throw new Error('CART_EMPTY: initialize cart first');
      const cartId = state.cart.id;
      const variantFilter = input.variantId ? `&variant_id=eq.${encodeURIComponent(input.variantId)}` : '&variant_id=is.null';
      if (input.qty <= 0) {
        await t.sendJson('DELETE', `cart_items?cart_id=eq.${encodeURIComponent(cartId)}&menu_item_id=eq.${encodeURIComponent(input.menuItemId)}${variantFilter}`);
      } else {
        const menuRows = await t.getJson<Array<{ price_poisha: number }>>(`menu_items?id=eq.${encodeURIComponent(input.menuItemId)}&select=price_poisha&limit=1`);
        if (!menuRows[0]) throw new Error('ITEM_UNAVAILABLE: menu item missing');
        await t.sendJson('DELETE', `cart_items?cart_id=eq.${encodeURIComponent(cartId)}&menu_item_id=eq.${encodeURIComponent(input.menuItemId)}${variantFilter}`);
        await t.sendJson('POST', 'cart_items', {
          cart_id: cartId,
          menu_item_id: input.menuItemId,
          variant_id: input.variantId,
          qty: input.qty,
          selections: input.selections,
          unit_snapshot_poisha: menuRows[0].price_poisha,
          note: input.note,
        });
      }
      const next = await this.getCartWithItems(input.customerId);
      return { cart: next.cart!, items: next.items };
    },

    async setCartVoucher(customerId: string, voucherCode: string | null) {
      const normalized = voucherCode ? voucherCode.trim().toUpperCase() : null;
      if (normalized) {
        const vRows = await t.getJson<Record<string, unknown>[]>(`vouchers?code=eq.${encodeURIComponent(normalized)}&is_active=eq.true&limit=1`);
        if (!vRows[0]) throw new Error('VOUCHER_INVALID: code inactive or unknown');
      }
      const rows = await t.sendJson<Record<string, unknown>[]>(
        'PATCH',
        `carts?customer_id=eq.${encodeURIComponent(customerId)}`,
        { voucher_code: normalized },
      );
      if (!rows[0]) throw new Error('CART_EMPTY: no active cart');
      return rows[0];
    },

    async validateCartPricing(customerId: string, isPriority: boolean) {
      return await t.callRpc<Record<string, unknown>>('quote_customer_cart', {
        p_customer_id: customerId,
        p_is_priority: isPriority,
      });
    },

    async placeOrder(input: Parameters<ApiDbAdapter['placeOrder']>[0]) {
      return await t.callRpc<Record<string, unknown>>('place_order', {
        p_customer_id: input.customerId,
        p_idempotency_key: input.idempotencyKey,
        p_expected_cod_poisha: input.expectedCodPoisha,
        p_is_priority: input.isPriority,
      });
    },

    async listActorOrders(profileId: string, role: Parameters<ApiDbAdapter['listActorOrders']>[1], limit: number) {
      if (role === 'admin') {
        return await t.getJson<Record<string, unknown>[]>(`orders?order=placed_at.desc&limit=${limit}`);
      }
      if (role === 'vendor_owner' || role === 'vendor_staff') {
        const op = await socialOps.getOperatorVendor(profileId);
        if (!op) return [];
        return await t.getJson<Record<string, unknown>[]>(
          `orders?vendor_id=eq.${encodeURIComponent(String(op.vendor.id))}&order=placed_at.desc&limit=${limit}`,
        );
      }
      if (role === 'rider') {
        const rRows = await t.getJson<Array<{ id: string }>>(`riders?profile_id=eq.${encodeURIComponent(profileId)}&select=id&limit=1`);
        if (!rRows[0]) return [];
        return await t.getJson<Record<string, unknown>[]>(`orders?rider_id=eq.${encodeURIComponent(rRows[0].id)}&order=placed_at.desc&limit=${limit}`);
      }
      return await t.getJson<Record<string, unknown>[]>(`orders?customer_id=eq.${encodeURIComponent(profileId)}&order=placed_at.desc&limit=${limit}`);
    },

    async getOrderAccessContext(idOrCode: string, viewerProfileId: string) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode);
      const filter = isUuid ? `id=eq.${encodeURIComponent(idOrCode)}` : `public_code=eq.${encodeURIComponent(idOrCode)}`;
      const orders = await t.getJson<Record<string, unknown>[]>(`orders?${filter}&limit=1`);
      const order = orders[0];
      if (!order) return null;
      const vendors = await t.getJson<Array<OrderVendorRow>>(`vendors?id=eq.${encodeURIComponent(String(order.vendor_id))}&limit=1`);
      const vendor = vendors[0]!;
      const riderRows = order.rider_id
        ? await t.getJson<Array<{ profile_id: string }>>(`riders?id=eq.${encodeURIComponent(String(order.rider_id))}&select=profile_id&limit=1`)
        : [];
      const staffRows = await t.getJson<Array<{ role: string }>>(
        `vendor_staff_members?vendor_id=eq.${encodeURIComponent(vendor.id)}&profile_id=eq.${encodeURIComponent(viewerProfileId)}&is_active=eq.true&select=role&limit=1`,
      );
      return {
        order,
        vendor,
        riderProfileId: riderRows[0]?.profile_id ?? null,
        staffRole: staffRows[0]?.role ?? null,
      };
    },

    async getOrderItemsAndEvents(orderId: string) {
      const [items, events] = await Promise.all([
        t.getJson<Record<string, unknown>[]>(`order_items?order_id=eq.${encodeURIComponent(orderId)}`),
        t.getJson<Record<string, unknown>[]>(`order_events?order_id=eq.${encodeURIComponent(orderId)}&order=created_at.asc`),
      ]);
      return { items, events };
    },

    async transitionOrder(input: Parameters<ApiDbAdapter['transitionOrder']>[0]) {
      return await t.callRpc<Record<string, unknown>>('transition_order', {
        p_order_id: input.orderId,
        p_actor_id: input.actorId,
        p_actor_kind: input.actorKind,
        p_to_status: input.toStatus,
        p_meta: input.meta,
      });
    },

    async snoozeMenuItems(vendorId: string, itemIds: readonly string[], minutes: number) {
      if (itemIds.length === 0) return 0;
      const untilIso = new Date(Date.now() + minutes * 60_000).toISOString();
      const csv = itemIds.map((x) => `"${x}"`).join(',');
      const rows = await t.sendJson<unknown[]>(
        'PATCH',
        `menu_items?vendor_id=eq.${encodeURIComponent(vendorId)}&id=in.(${csv})`,
        { unavailable_until: untilIso },
      );
      return rows.length;
    },

    async verifyPickupHandover(input: Parameters<ApiDbAdapter['verifyPickupHandover']>[0]) {
      return await t.callRpc<Record<string, unknown>>('verify_pickup_handover', {
        p_order_id: input.orderId,
        p_actor_profile_id: input.actorProfileId,
        p_secret: input.secret,
        p_qr_token: input.qrToken,
        p_code_4: input.code4,
        p_feedback_rating: input.feedbackRating,
        p_feedback_tags: input.feedbackTags,
      });
    },

    async recordRiderPickupFeedback(orderId: string, rating: number, tags: readonly string[]) {
      const rows = await t.sendJson<Record<string, unknown>[]>(
        'PATCH',
        `orders?id=eq.${encodeURIComponent(orderId)}`,
        { pickup_feedback_rating: rating, pickup_feedback_tags: tags },
      );
      return rows[0] ?? {};
    },
  };
}
