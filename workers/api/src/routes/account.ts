/**
 * @file workers/api/src/routes/account.ts
 * @description Authenticated user profile (`/v1/me`), FCM native alarm device registration
 * (`/v1/devices/token`), and bilingual inbox notifications (`/v1/notifications`) for `W1 undal-api`.
 */

import { jsonErr, jsonOk } from '../http.ts';
import type { ApiDbAdapter, AuthPrincipal } from '../types.ts';

/** Handles `/v1/me`, `/v1/devices/token`, and `/v1/notifications*` on `W1 undal-api`. */
export async function handleAccountRoute(
  request: Request,
  url: URL,
  db: ApiDbAdapter,
  principal: AuthPrincipal | null,
  requestId: string,
): Promise<Response | null> {
  const path = url.pathname;
  const matchesAccountRoute =
    path === '/v1/me' ||
    path === '/v1/devices/token' ||
    path === '/v1/notifications' ||
    path === '/v1/notifications/read';

  if (!matchesAccountRoute) return null;
  if (!principal) return jsonErr('SESSION_EXPIRED', requestId);

  if (path === '/v1/me') {
    if (request.method === 'GET') {
      const profile = await db.getOwnProfile(principal.sub);
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
      return jsonOk({ profile: updated }, requestId);
    }
    return null;
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
