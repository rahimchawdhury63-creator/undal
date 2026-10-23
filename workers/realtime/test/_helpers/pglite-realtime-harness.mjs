/**
 * @file workers/realtime/test/_helpers/pglite-realtime-harness.mjs
 * @description Real PostgreSQL 16 (`PGlite` WASM) harness applying all `16 / 16` migrations and
 * implementing `RealtimeDbAdapter` directly over live SQL tables & views (`0` fake SQL mocks!).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { DEFAULT_FARE_POLICY } from '@undal/shared-ts';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
export const EXAMPLE_JWT_SECRET = 'example-undal-w2-jwt-hmac-secret-32-chars!!';
export const EXAMPLE_INTERNAL_HMAC_SECRET = 'example-undal-w2-internal-hmac-32-chars!!';

function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** Signs a valid `HS256` JWT for `W2 undal-realtime` integration tests. */
export async function mintRealtimeJwt(sub, nowMs = Date.now(), expOffsetSec = 3_600) {
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = b64urlJson({ sub, exp: Math.floor(nowMs / 1_000) + expOffsetSec });
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(EXAMPLE_JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${Buffer.from(sig).toString('base64url')}`;
}

/** Boots a fresh PostgreSQL 16 (`PGlite`) instance with all `16 / 16` production migrations. */
export async function bootRealRealtimePostgres() {
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

/** Wraps real PostgreSQL 16 (`PGlite`) as `RealtimeDbAdapter` for `W2 undal-realtime` tests. */
export function createPgliteRealtimeAdapter(db) {
  const mapOrder = (r) => {
    const addr = r.address_snapshot ?? {};
    const vend = r.vendor_snapshot ?? {};
    const placedAtMs = new Date(r.placed_at).getTime();
    const prepMin = Number(r.prep_minutes_committed ?? 20);
    return {
      orderId: r.id,
      publicCode: r.public_code,
      zoneId: r.zone_id,
      vendorId: r.vendor_id,
      customerId: r.customer_id,
      fulfilment: r.fulfilment,
      status: r.status,
      vendorPoint: { lat: Number(vend.lat ?? 24.8949), lng: Number(vend.lng ?? 91.8687) },
      customerPoint: { lat: Number(addr.lat ?? 24.901), lng: Number(addr.lng ?? 91.872) },
      itemsPoisha: Number(r.items_poisha),
      foodPayablePoisha: Number(r.items_poisha) - Number(r.discount_total_poisha),
      codCollectPoisha: Number(r.cod_collect_poisha),
      isPriority: Boolean(r.is_priority),
      prepReadyAtMs: placedAtMs + prepMin * 60_000,
      placedAtMs,
      bagUnits: 1,
    };
  };

  return {
    async ping() {
      return (await db.query('SELECT 1 AS ok')).rows.length === 1;
    },
    async getProfileAuthState(userId) {
      const r = (await db.query('SELECT id, role, status, email, phone FROM public.profiles WHERE id = $1 LIMIT 1', [userId])).rows[0];
      return r ? { sub: r.id, role: r.role, status: r.status, email: r.email, phone: r.phone } : null;
    },
    async getOperatorIdentity(profileId, role) {
      if (role === 'rider') {
        const r = (await db.query('SELECT id, home_zone_id FROM public.riders WHERE profile_id = $1 AND deleted_at IS NULL LIMIT 1', [profileId])).rows[0];
        return r ? { kind: 'rider', refId: r.id, zoneId: r.home_zone_id } : null;
      }
      if (role === 'vendor_owner' || role === 'vendor_staff') {
        const v = (
          await db.query(
            `SELECT id, zone_id FROM public.vendors
             WHERE deleted_at IS NULL AND (
               owner_profile_id = $1
               OR id IN (SELECT vendor_id FROM public.vendor_staff_members WHERE profile_id = $1)
             ) LIMIT 1`,
            [profileId],
          )
        ).rows[0];
        return v ? { kind: 'vendor', refId: v.id, zoneId: v.zone_id } : null;
      }
      return null;
    },
    async upsertPresence(profileId, kind, refId, zoneId, input, nowMs) {
      await db.query(
        'SELECT public.upsert_presence_heartbeat($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          profileId,
          kind,
          refId,
          zoneId,
          input.lat ?? null,
          input.lng ?? null,
          input.heading ?? null,
          input.speedMps ?? null,
          input.capacityUsed ?? 0,
          input.appState ?? 'fg',
          input.batteryPct ?? null,
          new Date(nowMs).toISOString(),
        ],
      );
      return this.getPresence(profileId);
    },
    async getPresence(profileId) {
      const r = (await db.query('SELECT * FROM public.presence_live WHERE profile_id = $1 LIMIT 1', [profileId])).rows[0];
      if (!r) return null;
      return {
        profileId: r.profile_id,
        kind: r.kind,
        refId: r.ref_id,
        zoneId: r.zone_id,
        lat: r.lat !== null ? Number(r.lat) : null,
        lng: r.lng !== null ? Number(r.lng) : null,
        geohash: r.geohash,
        heading: r.heading !== null ? Number(r.heading) : null,
        speedMps: r.speed_mps !== null ? Number(r.speed_mps) : null,
        capacityUsed: Number(r.capacity_used),
        appState: r.app_state,
        batteryPct: r.battery_pct !== null ? Number(r.battery_pct) : null,
        lastSeenAtMs: new Date(r.last_seen_at).getTime(),
      };
    },
    async getRiderPreFlight(profileId) {
      const r0 = (await db.query('SELECT * FROM public.riders WHERE profile_id = $1 AND deleted_at IS NULL LIMIT 1', [profileId])).rows[0];
      if (!r0) return null;
      const bal = (await db.query('SELECT * FROM public.rider_cash_balance_v WHERE rider_id = $1 LIMIT 1', [r0.id])).rows[0];
      if (bal?.at_or_above_ceiling && !r0.cash_gate_blocked) {
        await db.query('UPDATE public.riders SET cash_gate_blocked = true WHERE id = $1', [r0.id]);
      }
      const r = (await db.query('SELECT * FROM public.riders WHERE id = $1', [r0.id])).rows[0];
      const docs = (await db.query('SELECT doc_type, review_status, expires_on FROM public.rider_documents WHERE rider_id = $1', [r.id])).rows;
      const hasValidDrivingLicense = docs.some(
        (d) => d.doc_type === 'driving_license' && d.review_status === 'approved',
      );
      return {
        riderId: r.id,
        profileId,
        vehicleType: r.vehicle_type,
        dateOfBirthIso: String(r.date_of_birth),
        kycStatus: r.kyc_status,
        isActive: Boolean(r.is_active),
        isOnline: Boolean(r.is_online),
        cashGateBlocked: Boolean(r.cash_gate_blocked),
        homeZoneId: r.home_zone_id,
        hasValidDrivingLicense,
        unremittedCashPoisha: Number(bal?.unremitted_cash_poisha ?? 0),
        cashCeilingPoisha: Number(bal?.ceiling_poisha ?? 500_000),
        warn80Pct: Boolean(bal?.warn_80pct ?? false),
      };
    },
    async hasFreshShiftSelfie(profileId, storagePath) {
      const r = await db.query(
        `SELECT id FROM public.media_assets
         WHERE owner_profile_id = $1 AND category = 'rider_shift_selfie' AND cloudinary_public_id = $2 LIMIT 1`,
        [profileId, storagePath],
      );
      return r.rows.length > 0;
    },
    async startRiderShift(params) {
      const nowIso = new Date(params.nowMs).toISOString();
      await db.query(`UPDATE public.rider_shifts SET ended_at = $2, end_reason = 'normal' WHERE rider_id = $1 AND ended_at IS NULL`, [
        params.riderId,
        nowIso,
      ]);
      const ins = (
        await db.query(
          `INSERT INTO public.rider_shifts (rider_id, zone_id, started_at, vehicle_confirmed, start_selfie_path)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, started_at`,
          [params.riderId, params.zoneId, nowIso, params.vehicleType, params.selfiePath],
        )
      ).rows[0];
      await db.query('UPDATE public.riders SET is_online = true WHERE id = $1', [params.riderId]);
      await this.upsertPresence(
        params.profileId,
        'rider',
        params.riderId,
        params.zoneId,
        { kind: 'rider', lat: params.lat, lng: params.lng, capacityUsed: 0, appState: 'fg' },
        params.nowMs,
      );
      return { shiftId: ins.id, startedAtIso: new Date(ins.started_at).toISOString() };
    },
    async endRiderShift(params) {
      const nowIso = new Date(params.nowMs).toISOString();
      const upd = await db.query(
        'UPDATE public.rider_shifts SET ended_at = $2, end_reason = $3 WHERE rider_id = $1 AND ended_at IS NULL RETURNING id',
        [params.riderId, nowIso, params.endReason],
      );
      const bal = (await db.query('SELECT * FROM public.rider_cash_balance_v WHERE rider_id = $1 LIMIT 1', [params.riderId])).rows[0];
      const unremitted = Number(bal?.unremitted_cash_poisha ?? 0);
      const ceiling = Number(bal?.ceiling_poisha ?? 500_000);
      const shouldBlock = unremitted > 0;
      await db.query('UPDATE public.riders SET is_online = false, cash_gate_blocked = $2 WHERE id = $1', [
        params.riderId,
        shouldBlock,
      ]);
      return {
        shiftEnded: upd.rows.length > 0,
        unremittedCashPoisha: unremitted,
        cashCeilingPoisha: ceiling,
        cashGateBlocked: shouldBlock,
      };
    },
    async getDispatchOrder(orderId) {
      const r = (await db.query('SELECT * FROM public.orders WHERE id = $1 LIMIT 1', [orderId])).rows[0];
      return r ? mapOrder(r) : null;
    },
    async listUnassignedZoneOrders(zoneId) {
      const rows = (
        await db.query(
          `SELECT * FROM public.orders
           WHERE zone_id = $1 AND fulfilment = 'delivery' AND rider_id IS NULL
             AND status IN ('PLACED','VENDOR_ACCEPTED','PREPARING','READY_FOR_PICKUP')`,
          [zoneId],
        )
      ).rows;
      return rows.map(mapOrder);
    },
    async listZoneRiderCandidates(zoneId) {
      const rows = (
        await db.query(
          `SELECT r.*, pl.lat, pl.lng, pl.capacity_used, pl.battery_pct, pl.last_seen_at,
                  coalesce(bal.unremitted_cash_poisha, 0) AS unremitted_cash_poisha,
                  coalesce(bal.ceiling_poisha, 500000) AS ceiling_poisha
           FROM public.presence_live pl
           JOIN public.riders r ON r.id = pl.ref_id
           LEFT JOIN public.rider_cash_balance_v bal ON bal.rider_id = r.id
           WHERE pl.zone_id = $1 AND pl.kind = 'rider' AND r.deleted_at IS NULL`,
          [zoneId],
        )
      ).rows;
      return rows.map((r) => ({
        riderId: r.id,
        profileId: r.profile_id,
        vehicleType: r.vehicle_type,
        lat: Number(r.lat),
        lng: Number(r.lng),
        accuracyM: 12,
        capacityUsed: Number(r.capacity_used ?? 0),
        ratingAvg90d: Number(r.rating_avg ?? 0),
        ratingCount: Number(r.rating_count ?? 0),
        completionRate30d: Number(r.completion_rate ?? 100),
        acceptanceHealth: Number(r.acceptance_rate ?? 100) / 100,
        batteryPct: r.battery_pct !== null ? Number(r.battery_pct) : null,
        lastSeenAtMs: new Date(r.last_seen_at).getTime(),
        idleMinutes: 12,
        cashInHandPoisha: Number(r.unremitted_cash_poisha),
        cashCeilingPoisha: Number(r.ceiling_poisha),
        cashGateBlocked: Boolean(r.cash_gate_blocked),
        kycStatus: r.kyc_status,
        isActive: Boolean(r.is_active),
        isOnline: Boolean(r.is_online),
        hasFailedDeliveryHold: false,
        headingVendorId: null,
        headingDropPoint: null,
      }));
    },
    async getZoneWeather(zoneId) {
      const r = (await db.query('SELECT * FROM public.weather_cache WHERE zone_id = $1 LIMIT 1', [zoneId])).rows[0];
      if (!r) return null;
      return {
        condition: r.condition,
        source: r.source,
        expiresAtMs: new Date(r.expires_at).getTime(),
      };
    },
    async upsertZoneWeather(zoneId, condition, tempC, precipMm, source, ttlSeconds, nowMs) {
      await db.query(
        `INSERT INTO public.weather_cache (zone_id, condition, temp_c, precip_mm, source, fetched_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (zone_id) DO UPDATE SET
           condition = EXCLUDED.condition, temp_c = EXCLUDED.temp_c, precip_mm = EXCLUDED.precip_mm,
           source = EXCLUDED.source, fetched_at = EXCLUDED.fetched_at, expires_at = EXCLUDED.expires_at`,
        [
          zoneId,
          condition,
          tempC,
          precipMm,
          source,
          new Date(nowMs).toISOString(),
          new Date(nowMs + ttlSeconds * 1_000).toISOString(),
        ],
      );
    },
    async getFarePolicy() {
      return DEFAULT_FARE_POLICY;
    },
    async listZones() {
      const rows = (await db.query('SELECT id, slug, name_en, is_active, polygon, road_factor FROM public.zones')).rows;
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        nameEn: r.name_en,
        isActive: Boolean(r.is_active),
        ring: (Array.isArray(r.polygon) ? r.polygon : []).map((p) => ({ lat: Number(p[1]), lng: Number(p[0]) })),
        roadFactor: Number(r.road_factor ?? 1.35),
      }));
    },
    async getGeocodeCache(cacheKey, nowMs) {
      const r = (await db.query('SELECT payload, expires_at FROM public.geocode_cache WHERE cache_key = $1 LIMIT 1', [cacheKey])).rows[0];
      if (!r || new Date(r.expires_at).getTime() <= nowMs) return null;
      return r.payload;
    },
    async putGeocodeCache(cacheKey, kind, payload, ttlSeconds, nowMs) {
      await db.query(
        `INSERT INTO public.geocode_cache (cache_key, kind, payload, fetched_at, expires_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (cache_key) DO UPDATE SET
           payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at, expires_at = EXCLUDED.expires_at`,
        [
          cacheKey,
          kind,
          JSON.stringify(payload),
          new Date(nowMs).toISOString(),
          new Date(nowMs + ttlSeconds * 1_000).toISOString(),
        ],
      );
    },
    async persistBatchAndOffer(offer) {
      if (offer.batchId) {
        await db.query(
          `INSERT INTO public.order_batches (id, zone_id, sequence, state) VALUES ($1,$2,$3,'offered')`,
          [offer.batchId, offer.zoneId, JSON.stringify(offer.batchOrderIds)],
        );
      }
      await db.query(
        `INSERT INTO public.order_offers (
           id, order_id, batch_id, rider_id, fare_poisha, fare_inputs, score, score_factors,
           solo_rider, response, offered_at, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          offer.id,
          offer.orderId,
          offer.batchId,
          offer.riderId,
          offer.farePoisha,
          JSON.stringify(offer.fareBreakdown),
          offer.score,
          JSON.stringify(offer.scoreFactors),
          offer.soloRider,
          offer.response,
          new Date(offer.offeredAtMs).toISOString(),
          new Date(offer.expiresAtMs).toISOString(),
        ],
      );
    },
    async persistOfferDecision(offer) {
      await db.query(
        'UPDATE public.order_offers SET response = $2, reject_reason = $3, responded_at = $4 WHERE id = $1',
        [offer.id, offer.response, offer.rejectReason, offer.respondedAtMs ? new Date(offer.respondedAtMs).toISOString() : null],
      );
      if (offer.response === 'accepted') {
        if (offer.batchId) {
          await db.query(`UPDATE public.order_batches SET rider_id = $2, state = 'active' WHERE id = $1`, [
            offer.batchId,
            offer.riderId,
          ]);
        }
        for (const ordId of offer.batchOrderIds) {
          const cur = (await db.query('SELECT status FROM public.orders WHERE id = $1', [ordId])).rows[0];
          const nextStatus =
            cur && ['VENDOR_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'].includes(cur.status)
              ? 'RIDER_ASSIGNED'
              : cur.status;
          await db.query(
            'UPDATE public.orders SET rider_id = $2, batch_id = $3, rider_fare_poisha = $4, status = $5 WHERE id = $1',
            [ordId, offer.riderId, offer.batchId, offer.farePoisha, nextStatus],
          );
        }
      }
    },
    async markVendorUnreachable(orderId, nowMs) {
      const cur = (await db.query('SELECT status FROM public.orders WHERE id = $1', [orderId])).rows[0];
      if (!cur || cur.status !== 'PLACED') return false;
      await db.query(
        `UPDATE public.orders SET status = 'CANCELLED_TIMEOUT', cancelled_at = $2, cancel_reason_key = 'system_vendor_accept_timeout' WHERE id = $1`,
        [orderId, new Date(nowMs).toISOString()],
      );
      await db.query(
        `INSERT INTO public.order_events (order_id, actor_kind, from_status, to_status, meta)
         VALUES ($1, 'system', 'PLACED', 'CANCELLED_TIMEOUT', '{"code":"VENDOR_UNREACHABLE"}'::jsonb)`,
        [orderId],
      );
      return true;
    },
    async getIdempotencyRecord(key, actorId, nowMs) {
      const r = (
        await db.query('SELECT * FROM public.idempotency_keys WHERE key = $1 AND actor_id = $2 LIMIT 1', [key, actorId])
      ).rows[0];
      if (!r || new Date(r.expires_at).getTime() <= nowMs) return null;
      return { requestHash: r.request_hash, status: Number(r.status_code), body: r.response_body };
    },
    async saveIdempotencyRecord(key, actorId, endpoint, requestHash, status, body, nowMs) {
      await db.query(
        `INSERT INTO public.idempotency_keys (key, actor_id, route, request_hash, status_code, response_body, created_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (actor_id, key) DO UPDATE SET
           request_hash = EXCLUDED.request_hash, status_code = EXCLUDED.status_code, response_body = EXCLUDED.response_body`,
        [
          key,
          actorId,
          endpoint,
          requestHash,
          status,
          JSON.stringify(body),
          new Date(nowMs).toISOString(),
          new Date(nowMs + 24 * 3600_000).toISOString(),
        ],
      );
    },
    async getActiveRtdbLeaseCount() {
      return 12;
    },
  };
}
