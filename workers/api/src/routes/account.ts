/**
 * @file workers/api/src/routes/account.ts
 * @description Authenticated user profile (`/v1/me`), saved delivery addresses (`/v1/addresses`),
 * favourite kitchens (`/v1/favourites`), FCM native alarm device registration (`/v1/devices/token`),
 * and bilingual inbox notifications (`/v1/notifications`) for `W1 undal-api` (`Build Responses 6–7`).
 */

import { jsonErr, jsonOk } from '../http.ts';
import type { ApiDbAdapter, AuthPrincipal } from '../types.ts';

function publicProfileMedia(profile: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!profile) return null;
  const avatar = profile.avatar_url;
  return {
    ...profile,
    avatar_url: typeof avatar === 'string' && avatar.startsWith('https://i.ibb.co/') ? avatar : null,
  };
}

/** Handles `/v1/me`, `/v1/addresses*`, `/v1/favourites*`, `/v1/devices/token`, and `/v1/notifications*`. */
export async function handleAccountRoute(
  request: Request,
  url: URL,
  db: ApiDbAdapter,
  principal: AuthPrincipal | null,
  requestId: string,
): Promise<Response | null> {
  const path = url.pathname;
  const addrIdMatch = /^\/v1\/(?:me\/)?addresses\/([0-9a-f-]{36})$/i.exec(path);
  const favMatch = /^\/v1\/favourites\/([0-9a-f-]{36})$/i.exec(path);
  const isAddressesRoot = path === '/v1/addresses' || path === '/v1/me/addresses';

  const matchesAccountRoute =
    path === '/v1/me' ||
    path === '/v1/auth/logout' ||
    path === '/v1/devices/token' ||
    path === '/v1/notifications' ||
    path === '/v1/notifications/read' ||
    path === '/v1/favourites' ||
    isAddressesRoot ||
    Boolean(addrIdMatch) ||
    Boolean(favMatch);

  if (!matchesAccountRoute) return null;
  if (!principal) return jsonErr('SESSION_EXPIRED', requestId);

  if (path === '/v1/auth/logout' && request.method === 'POST') {
    return jsonOk({ logged_out: true }, requestId);
  }

  if (path === '/v1/me') {
    if (request.method === 'GET') {
      const profile = publicProfileMedia(await db.getOwnProfile(principal.sub));
      return jsonOk({ profile }, requestId, 200, { 'Cache-Control': 'private, no-store' });
    }
    if (request.method === 'PATCH') {
      const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!raw || typeof raw !== 'object') {
        return jsonErr('VALIDATION_FAILED', requestId);
      }
      if ('role' in raw || 'trust_score' in raw || 'status' in raw) {
        return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId, { reason: 'IMMUTABLE_SECURITY_FIELD' });
      }
      const patch: { full_name?: string; language?: 'en' | 'bn'; avatar_url?: string | null } = {};
      if (typeof raw.full_name === 'string') {
        const trimmed = raw.full_name.trim();
        if (trimmed.length < 1 || trimmed.length > 120) {
          return jsonErr('VALIDATION_FAILED', requestId, { field: 'full_name' });
        }
        patch.full_name = trimmed;
      }
      if (raw.language !== undefined) {
        if (raw.language !== 'en' && raw.language !== 'bn') {
          return jsonErr('VALIDATION_FAILED', requestId, { field: 'language' });
        }
        patch.language = raw.language;
      }
      if (raw.avatar_url !== undefined) {
        if (raw.avatar_url !== null && (typeof raw.avatar_url !== 'string' || !raw.avatar_url.startsWith('https://i.ibb.co/'))) {
          return jsonErr('VALIDATION_FAILED', requestId, {
            field: 'avatar_url',
            hint: 'Public profile avatars must use Unlimited ImgBB CDN URLs returned by POST /v1/images/public.',
          });
        }
        patch.avatar_url = raw.avatar_url;
      }
      const updated = await db.updateOwnProfile(principal.sub, patch);
      return jsonOk({ profile: publicProfileMedia(updated) }, requestId);
    }
    return null;
  }

  if (isAddressesRoot && request.method === 'GET') {
    const addresses = await db.listCustomerAddresses(principal.sub);
    return jsonOk({ addresses }, requestId, 200, { 'Cache-Control': 'private, no-store' });
  }

  if ((isAddressesRoot && request.method === 'POST') || (addrIdMatch && request.method === 'PATCH')) {
    const body = (await request.json().catch(() => null)) as {
      readonly label?: string;
      readonly lat?: number;
      readonly lng?: number;
      readonly address_text?: string;
      readonly delivery_instructions?: string | null;
      readonly is_default?: boolean;
    } | null;
    if (
      !body ||
      typeof body.lat !== 'number' || !Number.isFinite(body.lat) || body.lat < -90 || body.lat > 90 ||
      typeof body.lng !== 'number' || !Number.isFinite(body.lng) || body.lng < -180 || body.lng > 180 ||
      typeof body.address_text !== 'string' || body.address_text.trim().length < 3 || body.address_text.trim().length > 400
    ) {
      return jsonErr('VALIDATION_FAILED', requestId, { required: ['lat', 'lng', 'address_text'] });
    }
    const saved = await db.saveCustomerAddress({
      profileId: principal.sub,
      addressId: addrIdMatch ? addrIdMatch[1]! : null,
      label: typeof body.label === 'string' && body.label.trim().length > 0 ? body.label.trim().slice(0, 60) : 'Home',
      lat: body.lat,
      lng: body.lng,
      addressText: body.address_text.trim(),
      deliveryInstructions: typeof body.delivery_instructions === 'string' ? body.delivery_instructions.trim().slice(0, 300) : null,
      isDefault: Boolean(body.is_default),
    });
    return jsonOk({ address: saved }, requestId, addrIdMatch ? 200 : 201);
  }

  if (addrIdMatch && request.method === 'DELETE') {
    const deleted = await db.deleteCustomerAddress(principal.sub, addrIdMatch[1]!);
    return jsonOk({ deleted }, requestId);
  }

  if (path === '/v1/favourites' && request.method === 'GET') {
    const favourites = await db.listFavourites(principal.sub);
    return jsonOk({ favourites }, requestId, 200, { 'Cache-Control': 'private, no-store' });
  }

  if (favMatch && request.method === 'POST') {
    const toggled = await db.toggleFavourite(principal.sub, favMatch[1]!);
    return jsonOk(toggled, requestId);
  }

  if (path === '/v1/devices/token' && request.method === 'POST') {
    const body = (await request.json().catch(() => null)) as {
      readonly fcm_token?: string;
      readonly app_flavor?: 'customer' | 'partner' | 'rider';
      readonly platform?: 'android' | 'web';
      readonly app_version?: string;
      readonly oem_brand?: string;
      readonly alarm_ready?: boolean;
    } | null;

    if (
      !body?.fcm_token ||
      body.fcm_token.trim().length < 16 ||
      (body.app_flavor !== 'customer' && body.app_flavor !== 'partner' && body.app_flavor !== 'rider')
    ) {
      return jsonErr('VALIDATION_FAILED', requestId, { required: ['fcm_token', 'app_flavor'] });
    }
    const platform = body.platform === 'web' ? 'web' : 'android';
    const tokenRow = await db.upsertDeviceToken({
      profileId: principal.sub,
      fcmToken: body.fcm_token.trim(),
      appFlavor: body.app_flavor,
      platform,
      appVersion: body.app_version?.trim() ?? null,
      oemBrand: body.oem_brand?.trim() ?? null,
      alarmReady: Boolean(body.alarm_ready),
    });
    return jsonOk({ device: tokenRow }, requestId, 201);
  }

  if (path === '/v1/notifications' && request.method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '30') || 30, 1), 100);
    const unreadOnly = url.searchParams.get('unread_only') === 'true';
    const notifications = await db.listNotifications(principal.sub, limit, unreadOnly);
    return jsonOk({ notifications }, requestId, 200, { 'Cache-Control': 'private, no-store' });
  }

  if (path === '/v1/notifications/read' && request.method === 'PATCH') {
    const body = (await request.json().catch(() => ({}))) as { readonly ids?: readonly string[] };
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : null;
    const markedCount = await db.markNotificationsRead(principal.sub, ids);
    return jsonOk({ marked_count: markedCount }, requestId);
  }

  return null;
}
