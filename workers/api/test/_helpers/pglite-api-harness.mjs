/**
 * @file workers/api/test/_helpers/pglite-api-harness.mjs
 * @description Shared real PostgreSQL 16 (`PGlite` WASM) database harness + JWT helper
 * backing `W1 undal-api` integration tests across `Build Responses 6–7` (`0` fake SQL mocks!).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { createPgliteOpsMethods } from './pglite-api-ops.mjs';
import { createPglitePartnerMethods } from './pglite-api-onboarding.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
export const TEST_JWT_SECRET = 'undal-test-jwt-hmac-secret-32-chars-minimum!!';

function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** Signs a valid HS256 JWT matching `authenticateRequest()` in `workers/api/src/http.ts`. */
export async function mintTestJwt(sub, expOffsetSec = 3600, secret = TEST_JWT_SECRET) {
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = b64urlJson({ sub, exp: Math.floor(Date.now() / 1000) + expOffsetSec });
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${Buffer.from(sig).toString('base64url')}`;
}

/** Boots a fresh PostgreSQL 16 (`PGlite`) instance with all sorted migrations, including Partner response 16, applied. */
export async function bootRealApiPostgres() {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(fs.readFileSync(path.join(REPO_ROOT, 'supabase/tests/_bootstrap_supabase_local.sql'), 'utf8'));
  const files = fs
    .readdirSync(path.join(REPO_ROOT, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    await db.exec(fs.readFileSync(path.join(REPO_ROOT, 'supabase/migrations', file), 'utf8'));
  }
  return db;
}

/** Wraps real PostgreSQL 16 (`PGlite`) as `ApiDbAdapter` for `W1 undal-api`. */
export function createPgliteAdapter(db) {
  const resolveZone = async (lat, lng) => (await db.query('SELECT * FROM public.resolve_zone($1, $2)', [lat, lng])).rows[0];
  return {
    ...createPgliteOpsMethods(db, resolveZone),
    ...createPglitePartnerMethods(db),
    async ping() {
      return (await db.query('SELECT 1 AS ok')).rows.length === 1;
    },
    async getProfileAuthState(userId) {
      const r = await db.query('SELECT id, role, status, email, phone FROM public.profiles WHERE id = $1 LIMIT 1', [userId]);
      const row = r.rows[0];
      return row ? { sub: row.id, role: row.role, status: row.status, email: row.email, phone: row.phone } : null;
    },
    async getPublicSettings() {
      const r = await db.query('SELECT key, value FROM public.platform_settings WHERE is_public_readable = true');
      return Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
    },
    async resolveZone(lat, lng) {
      return (await db.query('SELECT * FROM public.resolve_zone($1, $2)', [lat, lng])).rows[0];
    },
    async createPartnerZoneWaitlist(input) {
      return (
        await db.query(
          `INSERT INTO public.partner_zone_waitlist (profile_id, idempotency_key, vendor_type, lat, lng, public_area_label)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (profile_id, idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
           RETURNING id, created_at`,
          [input.profileId, input.idempotencyKey, input.vendorType, input.lat, input.lng, input.publicAreaLabel],
        )
      ).rows[0];
    },
    async getHomeFeed(params) {
      const feed = (
        await db.query('SELECT public.get_home_feed($1, $2, $3, $4, $5, $6, $7) AS data', [
          params.lat,
          params.lng,
          params.fulfilment,
          params.cuisine,
          params.sort,
          params.limit,
          params.offset,
        ])
      ).rows[0].data;
      const banners = (await db.query('SELECT * FROM public.banners WHERE is_active = true ORDER BY sort ASC')).rows;
      const flashCampaigns = (
        await db.query(`SELECT id, slug, title_en, flat_poisha FROM public.campaigns WHERE is_active = true AND kind = 'flash_box'`)
      ).rows;
      return { feed, banners, flashCampaigns };
    },
    async getVendorHeader(slug) {
      return (await db.query('SELECT * FROM public.public_vendor_cards WHERE slug = $1 LIMIT 1', [slug])).rows[0] ?? null;
    },
    async getVendorMenuDetail(slug) {
      return (await db.query('SELECT public.get_vendor_storefront($1) AS data', [slug])).rows[0]?.data ?? null;
    },
    async getVendorReviews(slug, limit) {
      const card = await this.getVendorHeader(slug);
      if (!card) return [];
      return (
        await db.query(
          `SELECT id, rating, comment, created_at FROM public.reviews
           WHERE vendor_id = $1 AND direction = 'customer_to_vendor' AND moderation_status = 'visible'
           ORDER BY created_at DESC LIMIT $2`,
          [card.id, limit],
        )
      ).rows;
    },
    async searchCatalog(params) {
      const rows = (
        await db.query('SELECT public.search_catalog($1, $2, $3, $4, $5) AS data', [
          params.query,
          params.lat,
          params.lng,
          params.fulfilment,
          params.limit,
        ])
      ).rows[0].data;
      const zone = await this.resolveZone(params.lat, params.lng);
      await db.query('INSERT INTO public.search_queries (zone_id, query_norm, results_count) VALUES ($1, $2, $3)', [
        zone.zone_id ?? null,
        params.query.trim().toLowerCase(),
        rows.length,
      ]);
      return rows;
    },
    async getSeoSitemapData() {
      const [zones, cuisines, vendors] = await Promise.all([
        db.query('SELECT slug, name_en, name_bn FROM public.zones WHERE is_active = true'),
        db.query('SELECT key, name_en, name_bn FROM public.cuisine_taxonomy WHERE is_active = true ORDER BY sort ASC'),
        db.query('SELECT slug, brand_name FROM public.public_vendor_cards'),
      ]);
      return { zones: zones.rows, cuisines: cuisines.rows, vendors: vendors.rows };
    },
    async getOwnProfile(userId) {
      return (await db.query('SELECT id, role, full_name, language, avatar_url, trust_score FROM public.profiles WHERE id = $1', [userId])).rows[0] ?? null;
    },
    async updateOwnProfile(userId, patch) {
      return (
        await db.query(
          `UPDATE public.profiles SET
             full_name = coalesce($2, full_name),
             language = coalesce($3, language),
             avatar_url = CASE WHEN $4::boolean THEN $5 ELSE avatar_url END
           WHERE id = $1
           RETURNING id, role, full_name, language, avatar_url`,
          [userId, patch.full_name ?? null, patch.language ?? null, 'avatar_url' in patch, patch.avatar_url ?? null],
        )
      ).rows[0];
    },
    async upsertDeviceToken(params) {
      return (
        await db.query(
          `INSERT INTO public.device_tokens (profile_id, fcm_token, app_flavor, platform, app_version, oem_brand, alarm_ready)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (fcm_token) DO UPDATE SET oem_brand = EXCLUDED.oem_brand, alarm_ready = EXCLUDED.alarm_ready
           RETURNING id, app_flavor, oem_brand, alarm_ready`,
          [params.profileId, params.fcmToken, params.appFlavor, params.platform, params.appVersion, params.oemBrand, params.alarmReady],
        )
      ).rows[0];
    },
    async listNotifications(profileId, limit, unreadOnly) {
      return (
        await db.query(
          `SELECT id, kind, title_en, title_bn, read_at FROM public.notifications
           WHERE recipient_id = $1 AND ($2::boolean = false OR read_at IS NULL)
           ORDER BY created_at DESC LIMIT $3`,
          [profileId, unreadOnly, limit],
        )
      ).rows;
    },
    async markNotificationsRead(profileId) {
      return (
        await db.query(
          `UPDATE public.notifications SET read_at = clock_timestamp() WHERE recipient_id = $1 AND read_at IS NULL RETURNING id`,
          [profileId],
        )
      ).rows.length;
    },
    async countUserPublicUploadsToday(ownerProfileId) {
      return (await db.query(`SELECT count(*)::int AS cnt FROM public.media_assets WHERE owner_profile_id = $1 AND provider = 'imgbb'`, [ownerProfileId])).rows[0].cnt;
    },
    async insertMediaAsset(input) {
      return (
        await db.query(
          `INSERT INTO public.media_assets (
             owner_profile_id, provider, category, delivery_type, cloudinary_public_id,
             public_cdn_url, medium_url, thumb_url, imgbb_delete_url, bytes, width, height, format
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING *`,
          [
            input.ownerProfileId,
            input.provider,
            input.category,
            input.deliveryType,
            input.cloudinaryPublicId,
            input.publicCdnUrl,
            input.mediumUrl,
            input.thumbUrl,
            input.imgbbDeleteUrl,
            input.bytes,
            input.width,
            input.height,
            input.format,
          ],
        )
      ).rows[0];
    },
    async getMediaAssetById(assetId) {
      return (await db.query('SELECT * FROM public.media_assets WHERE id = $1 LIMIT 1', [assetId])).rows[0] ?? null;
    },
    async hasAdminPermission(profileId, permissionKey) {
      const r = await db.query(
        `SELECT EXISTS (
           SELECT 1 FROM public.admin_user_roles aur
           JOIN public.admin_roles ar ON ar.id = aur.role_id
           LEFT JOIN public.admin_permissions ap ON ap.role_id = ar.id
           WHERE aur.profile_id = $1 AND (ar.key = 'super_admin' OR ap.permission IN ($2, '*'))
         ) AS ok`,
        [profileId, permissionKey],
      );
      return Boolean(r.rows[0]?.ok);
    },
    async insertAuditLog(entry) {
      await db.query(
        `INSERT INTO public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, diff, request_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [entry.actorId, entry.actorRole, entry.action, entry.entityType, entry.entityId, JSON.stringify(entry.diff), entry.requestId],
      );
    },
  };
}
