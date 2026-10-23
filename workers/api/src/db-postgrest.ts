/**
 * @file workers/api/src/db-postgrest.ts
 * @description Zero-dependency Cloudflare Edge Supabase PostgREST + RPC HTTP adapter (`< 1ms` CPU).
 * Calls hosted Supabase `/rest/v1/*` and `/rest/v1/rpc/*` using native Worker `fetch()`.
 */

import type { ApiDbAdapter, ApiWorkerEnv, AuthPrincipal, StoredMediaAssetRow } from './types.ts';

export function createPostgrestDbAdapter(env: ApiWorkerEnv): ApiDbAdapter {
  const fetcher = env.__fetchImpl ?? fetch;
  const baseUrl = (env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_ANON_KEY ?? '';

  function restHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(extra ?? {}),
    };
  }

  async function getJson<T>(pathAndQuery: string): Promise<T> {
    const res = await fetcher(`${baseUrl}/rest/v1/${pathAndQuery}`, { headers: restHeaders() });
    if (!res.ok) throw new Error(`Supabase GET ${pathAndQuery} failed (${res.status})`);
    return (await res.json()) as T;
  }

  async function callRpc<T>(fnName: string, args: Record<string, unknown>): Promise<T> {
    const res = await fetcher(`${baseUrl}/rest/v1/rpc/${fnName}`, {
      method: 'POST',
      headers: restHeaders(),
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`Supabase RPC ${fnName} failed (${res.status})`);
    return (await res.json()) as T;
  }

  return {
    async ping() {
      if (!baseUrl || !serviceKey) return false;
      const rows = await getJson<unknown[]>('zones?select=slug&limit=1');
      return Array.isArray(rows);
    },

    async getProfileAuthState(userId) {
      const rows = await getJson<
        Array<{ id: string; role: AuthPrincipal['role']; status: AuthPrincipal['status']; email: string | null; phone: string | null }>
      >(`profiles?id=eq.${encodeURIComponent(userId)}&select=id,role,status,email,phone&limit=1`);
      const row = rows[0];
      return row ? { sub: row.id, role: row.role, status: row.status, email: row.email, phone: row.phone } : null;
    },

    async getPublicSettings() {
      const rows = await getJson<Array<{ key: string; value: unknown }>>(
        'platform_settings?is_public_readable=eq.true&select=key,value',
      );
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },

    async resolveZone(lat, lng) {
      const rows = await callRpc<Record<string, unknown>[]>('resolve_zone', { p_lat: lat, p_lng: lng });
      return rows[0] ?? { in_service_area: false };
    },

    async getHomeFeed(params) {
      const feed = await callRpc<Record<string, unknown>>('get_home_feed', {
        p_lat: params.lat,
        p_lng: params.lng,
        p_fulfilment: params.fulfilment,
        p_cuisine: params.cuisine,
        p_sort: params.sort,
        p_limit: params.limit,
        p_offset: params.offset,
      });
      const zoneId = typeof feed.zone_id === 'string' ? feed.zone_id : null;
      const banners = zoneId
        ? await getJson<Record<string, unknown>[]>(
            `banners?is_active=eq.true&or=(zone_id.is.null,zone_id.eq.${encodeURIComponent(zoneId)})&order=sort.asc`,
          )
        : [];
      const flashCampaigns = await getJson<Record<string, unknown>[]>(
        'campaigns?is_active=eq.true&kind=eq.flash_box&select=id,slug,title_en,title_bn,flat_poisha,pct_bps,ends_at',
      );
      return { feed, banners, flashCampaigns };
    },

    async getVendorHeader(slug) {
      const rows = await getJson<Record<string, unknown>[]>(
        `public_vendor_cards?slug=eq.${encodeURIComponent(slug)}&limit=1`,
      );
      return rows[0] ?? null;
    },

    async getVendorMenuDetail(slug) {
      return await callRpc<Record<string, unknown> | null>('get_vendor_storefront', { p_slug: slug });
    },

    async getVendorReviews(slug, limit, cursorCreatedAt) {
      const card = await this.getVendorHeader(slug);
      if (!card || typeof card.id !== 'string') return [];
      const cursorClause = cursorCreatedAt ? `&created_at=lt.${encodeURIComponent(cursorCreatedAt)}` : '';
      return await getJson<Record<string, unknown>[]>(
        `reviews?vendor_id=eq.${encodeURIComponent(card.id)}&direction=eq.customer_to_vendor&moderation_status=eq.visible${cursorClause}&order=created_at.desc&limit=${limit}&select=id,rating,aspect_tags,comment,photo_urls,vendor_reply,vendor_replied_at,created_at`,
      );
    },

    async searchCatalog(params) {
      const results = await callRpc<Record<string, unknown>[]>('search_catalog', {
        p_query: params.query,
        p_lat: params.lat,
        p_lng: params.lng,
        p_fulfilment: params.fulfilment,
        p_limit: params.limit,
      });
      const zone = await this.resolveZone(params.lat, params.lng);
      await fetcher(`${baseUrl}/rest/v1/search_queries`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({
          zone_id: typeof zone.zone_id === 'string' ? zone.zone_id : null,
          query_norm: params.query.trim().toLowerCase().slice(0, 120),
          results_count: results.length,
        }),
      });
      return results;
    },

    async getSeoSitemapData() {
      const [zones, cuisines, vendors] = await Promise.all([
        getJson<Record<string, unknown>[]>('zones?is_active=eq.true&select=slug,name_en,name_bn,updated_at'),
        getJson<Record<string, unknown>[]>('cuisine_taxonomy?is_active=eq.true&select=key,name_en,name_bn&order=sort.asc'),
        getJson<Record<string, unknown>[]>('public_vendor_cards?select=slug,brand_name,brand_name_bn,public_area_label,cuisines'),
      ]);
      return { zones, cuisines, vendors };
    },

    async getOwnProfile(userId) {
      const rows = await getJson<Record<string, unknown>[]>(
        `profiles?id=eq.${encodeURIComponent(userId)}&select=id,role,full_name,phone,email,avatar_url,language,trust_score,created_at&limit=1`,
      );
      return rows[0] ?? null;
    },

    async updateOwnProfile(userId, patch) {
      const res = await fetcher(`${baseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`Profile update failed (${res.status})`);
      const rows = (await res.json()) as Record<string, unknown>[];
      return rows[0] ?? {};
    },

    async upsertDeviceToken(params) {
      const res = await fetcher(`${baseUrl}/rest/v1/device_tokens?on_conflict=fcm_token`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'resolution=merge-duplicates,return=representation' }),
        body: JSON.stringify({
          profile_id: params.profileId,
          fcm_token: params.fcmToken,
          app_flavor: params.appFlavor,
          platform: params.platform,
          app_version: params.appVersion,
          oem_brand: params.oemBrand,
          alarm_ready: params.alarmReady,
          last_seen_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error(`Device token upsert failed (${res.status})`);
      const rows = (await res.json()) as Record<string, unknown>[];
      return rows[0] ?? {};
    },

    async listNotifications(profileId, limit, unreadOnly) {
      const unread = unreadOnly ? '&read_at=is.null' : '';
      return await getJson<Record<string, unknown>[]>(
        `notifications?recipient_id=eq.${encodeURIComponent(profileId)}${unread}&order=created_at.desc&limit=${limit}`,
      );
    },

    async markNotificationsRead(profileId, ids) {
      const idFilter = ids && ids.length > 0 ? `&id=in.(${ids.map((i) => `"${i}"`).join(',')})` : '';
      const res = await fetcher(
        `${baseUrl}/rest/v1/notifications?recipient_id=eq.${encodeURIComponent(profileId)}&read_at=is.null${idFilter}`,
        {
          method: 'PATCH',
          headers: restHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify({ read_at: new Date().toISOString() }),
        },
      );
      if (!res.ok) throw new Error(`Mark notifications failed (${res.status})`);
      return ((await res.json()) as unknown[]).length;
    },

    async countUserPublicUploadsToday(ownerProfileId) {
      const startIso = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
      const rows = await getJson<Array<{ id: string }>>(
        `media_assets?owner_profile_id=eq.${encodeURIComponent(ownerProfileId)}&provider=eq.imgbb&created_at=gte.${encodeURIComponent(startIso)}&select=id`,
      );
      return rows.length;
    },

    async insertMediaAsset(input) {
      const res = await fetcher(`${baseUrl}/rest/v1/media_assets`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify({
          owner_profile_id: input.ownerProfileId,
          provider: input.provider,
          category: input.category,
          delivery_type: input.deliveryType,
          cloudinary_public_id: input.cloudinaryPublicId,
          public_cdn_url: input.publicCdnUrl,
          medium_url: input.mediumUrl,
          thumb_url: input.thumbUrl,
          imgbb_delete_url: input.imgbbDeleteUrl,
          bytes: input.bytes,
          width: input.width,
          height: input.height,
          format: input.format,
          exif_stripped: true,
        }),
      });
      if (!res.ok) throw new Error(`media_assets insert failed (${res.status})`);
      const rows = (await res.json()) as StoredMediaAssetRow[];
      return rows[0]!;
    },

    async getMediaAssetById(assetId) {
      const rows = await getJson<StoredMediaAssetRow[]>(
        `media_assets?id=eq.${encodeURIComponent(assetId)}&select=id,owner_profile_id,provider,category,delivery_type,cloudinary_public_id,public_cdn_url,medium_url,thumb_url,bytes,width,height,format&limit=1`,
      );
      return rows[0] ?? null;
    },

    async hasAdminPermission(profileId, permissionKey) {
      const roleLinks = await getJson<Array<{ role_id: string }>>(
        `admin_user_roles?profile_id=eq.${encodeURIComponent(profileId)}&select=role_id`,
      );
      if (roleLinks.length === 0) return false;
      const roleIdsCsv = roleLinks.map((r) => `"${r.role_id}"`).join(',');
      const [superCheck, permCheck] = await Promise.all([
        getJson<Array<{ id: string }>>(`admin_roles?id=in.(${roleIdsCsv})&key=eq.super_admin&select=id&limit=1`),
        getJson<Array<{ permission: string }>>(
          `admin_permissions?role_id=in.(${roleIdsCsv})&permission=in.("${permissionKey}","*")&select=permission&limit=1`,
        ),
      ]);
      return superCheck.length > 0 || permCheck.length > 0;
    },

    async insertAuditLog(entry) {
      const res = await fetcher(`${baseUrl}/rest/v1/audit_logs`, {
        method: 'POST',
        headers: restHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({
          actor_id: entry.actorId,
          actor_role: entry.actorRole,
          action: entry.action,
          entity_type: entry.entityType,
          entity_id: entry.entityId,
          diff: entry.diff,
          request_id: entry.requestId,
        }),
      });
      if (!res.ok) throw new Error(`audit_logs insert failed (${res.status})`);
    },
  };
}
