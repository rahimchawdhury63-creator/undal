/**
 * @file workers/realtime/src/db-postgrest-dispatch.ts
 * @description Dispatch, weather cache, geocode cache, batch/offer persistence, `ORD-02` unreachable
 * timeout, and idempotency methods for `W2 undal-realtime`'s PostgREST adapter (`< 300` lines).
 */

import { DEFAULT_FARE_POLICY, type RiderVehicleType, type WeatherCondition } from '@undal/shared-ts';
import { islegalAssignTransition } from './db-helpers.ts';
import type {
  DispatchOrderSnapshot,
  GeoPoint,
  OfferRecord,
  RealtimeDbAdapter,
  RiderCandidate,
  ZonePolygonRecord,
} from './types.ts';

export interface PostgrestTransport {
  restGet<T>(pathAndQuery: string): Promise<T>;
  restWrite<T>(method: 'POST' | 'PATCH' | 'DELETE', pathAndQuery: string, body?: unknown, prefer?: string): Promise<T>;
}

export function createPostgrestDispatchMethods(t: PostgrestTransport): Pick<
  RealtimeDbAdapter,
  | 'getDispatchOrder'
  | 'listUnassignedZoneOrders'
  | 'listZoneRiderCandidates'
  | 'getZoneWeather'
  | 'upsertZoneWeather'
  | 'getFarePolicy'
  | 'listZones'
  | 'getGeocodeCache'
  | 'putGeocodeCache'
  | 'persistBatchAndOffer'
  | 'persistOfferDecision'
  | 'markVendorUnreachable'
  | 'getIdempotencyRecord'
  | 'saveIdempotencyRecord'
  | 'getActiveRtdbLeaseCount'
> {
  return {
    async getDispatchOrder(orderId: string): Promise<DispatchOrderSnapshot | null> {
      const rows = await t.restGet<readonly Record<string, unknown>[]>(
        `orders?select=*&id=eq.${encodeURIComponent(orderId)}&limit=1`,
      );
      return rows[0] ? mapOrderRow(rows[0]) : null;
    },

    async listUnassignedZoneOrders(zoneId: string): Promise<readonly DispatchOrderSnapshot[]> {
      const rows = await t.restGet<readonly Record<string, unknown>[]>(
        `orders?select=*&zone_id=eq.${encodeURIComponent(zoneId)}&fulfilment=eq.delivery&rider_id=is.null&status=in.(PLACED,VENDOR_ACCEPTED,PREPARING,READY_FOR_PICKUP)`,
      );
      return rows.map(mapOrderRow);
    },

    async listZoneRiderCandidates(zoneId: string): Promise<readonly RiderCandidate[]> {
      const [presRows, riderRows, balRows] = await Promise.all([
        t.restGet<readonly Record<string, unknown>[]>(`presence_live?select=*&zone_id=eq.${encodeURIComponent(zoneId)}&kind=eq.rider`),
        t.restGet<readonly Record<string, unknown>[]>(`riders?select=*&home_zone_id=eq.${encodeURIComponent(zoneId)}&deleted_at=is.null`),
        t.restGet<readonly Record<string, unknown>[]>('rider_cash_balance_v?select=*'),
      ]);
      const riderById = new Map(riderRows.map((r) => [String(r['id']), r]));
      const balById = new Map(balRows.map((b) => [String(b['rider_id']), b]));
      const out: RiderCandidate[] = [];
      for (const pl of presRows) {
        const riderId = String(pl['ref_id']);
        const r = riderById.get(riderId);
        if (!r || pl['lat'] === null || pl['lng'] === null) continue;
        const bal = balById.get(riderId);
        out.push({
          riderId,
          profileId: String(r['profile_id']),
          vehicleType: r['vehicle_type'] as RiderVehicleType,
          lat: Number(pl['lat']),
          lng: Number(pl['lng']),
          accuracyM: 15,
          capacityUsed: Number(pl['capacity_used'] ?? 0),
          ratingAvg90d: Number(r['rating_avg'] ?? 0),
          ratingCount: Number(r['rating_count'] ?? 0),
          completionRate30d: Number(r['completion_rate'] ?? 100),
          acceptanceHealth: Number(r['acceptance_rate'] ?? 100) / 100,
          batteryPct: pl['battery_pct'] !== null && pl['battery_pct'] !== undefined ? Number(pl['battery_pct']) : null,
          lastSeenAtMs: new Date(String(pl['last_seen_at'])).getTime(),
          idleMinutes: 10,
          cashInHandPoisha: Number(bal?.['unremitted_cash_poisha'] ?? 0),
          cashCeilingPoisha: Number(bal?.['ceiling_poisha'] ?? 500_000),
          cashGateBlocked: Boolean(r['cash_gate_blocked']),
          kycStatus: String(r['kyc_status']),
          isActive: Boolean(r['is_active']),
          isOnline: Boolean(r['is_online']),
          hasFailedDeliveryHold: false,
          headingVendorId: null,
          headingDropPoint: null,
        });
      }
      return out;
    },

    async getZoneWeather(zoneId: string) {
      const rows = await t.restGet<readonly Record<string, unknown>[]>(
        `weather_cache?select=*&zone_id=eq.${encodeURIComponent(zoneId)}&limit=1`,
      );
      const r = rows[0];
      if (!r) return null;
      return {
        condition: r['condition'] as WeatherCondition,
        source: r['source'] as 'open_meteo' | 'met_norway' | 'admin_override',
        expiresAtMs: new Date(String(r['expires_at'])).getTime(),
      };
    },

    async upsertZoneWeather(zoneId, condition, tempC, precipMm, source, ttlSeconds, nowMs) {
      await t.restWrite(
        'POST',
        'weather_cache?on_conflict=zone_id',
        {
          zone_id: zoneId,
          condition,
          temp_c: tempC,
          precip_mm: precipMm,
          source,
          fetched_at: new Date(nowMs).toISOString(),
          expires_at: new Date(nowMs + ttlSeconds * 1_000).toISOString(),
        },
        'resolution=merge-duplicates,return=minimal',
      );
    },

    async getFarePolicy() {
      return DEFAULT_FARE_POLICY;
    },

    async listZones(): Promise<readonly ZonePolygonRecord[]> {
      const rows = await t.restGet<readonly Record<string, unknown>[]>(
        'zones?select=id,slug,name_en,is_active,polygon,road_factor',
      );
      return rows.map((r) => ({
        id: String(r['id']),
        slug: String(r['slug']),
        nameEn: String(r['name_en']),
        isActive: Boolean(r['is_active']),
        ring: extractPolygonRing(r['polygon']),
        roadFactor: Number(r['road_factor'] ?? 1.35),
      }));
    },

    async getGeocodeCache(cacheKey: string, nowMs: number) {
      const rows = await t.restGet<readonly Record<string, unknown>[]>(
        `geocode_cache?select=payload,expires_at&cache_key=eq.${encodeURIComponent(cacheKey)}&limit=1`,
      );
      const r = rows[0];
      if (!r || new Date(String(r['expires_at'])).getTime() <= nowMs) return null;
      return r['payload'] as Record<string, unknown>;
    },

    async putGeocodeCache(cacheKey, kind, payload, ttlSeconds, nowMs) {
      await t.restWrite(
        'POST',
        'geocode_cache?on_conflict=cache_key',
        {
          cache_key: cacheKey,
          kind,
          payload,
          fetched_at: new Date(nowMs).toISOString(),
          expires_at: new Date(nowMs + ttlSeconds * 1_000).toISOString(),
        },
        'resolution=merge-duplicates,return=minimal',
      );
    },

    async persistBatchAndOffer(offer: OfferRecord): Promise<void> {
      if (offer.batchId) {
        await t.restWrite('POST', 'order_batches', {
          id: offer.batchId,
          zone_id: offer.zoneId,
          sequence: offer.batchOrderIds,
          state: 'offered',
        });
      }
      await t.restWrite('POST', 'order_offers', {
        id: offer.id,
        order_id: offer.orderId,
        batch_id: offer.batchId,
        rider_id: offer.riderId,
        fare_poisha: offer.farePoisha,
        fare_inputs: offer.fareBreakdown,
        score: offer.score,
        score_factors: offer.scoreFactors,
        solo_rider: offer.soloRider,
        response: offer.response,
        offered_at: new Date(offer.offeredAtMs).toISOString(),
        expires_at: new Date(offer.expiresAtMs).toISOString(),
      });
    },

    async persistOfferDecision(offer: OfferRecord): Promise<void> {
      await t.restWrite('PATCH', `order_offers?id=eq.${encodeURIComponent(offer.id)}`, {
        response: offer.response,
        reject_reason: offer.rejectReason,
        responded_at: offer.respondedAtMs ? new Date(offer.respondedAtMs).toISOString() : null,
      });
      if (offer.response === 'accepted') {
        if (offer.batchId) {
          await t.restWrite('PATCH', `order_batches?id=eq.${encodeURIComponent(offer.batchId)}`, {
            rider_id: offer.riderId,
            state: 'active',
          });
        }
        for (const ordId of offer.batchOrderIds) {
          const cur = await this.getDispatchOrder(ordId);
          if (!cur) continue;
          const nextStatus = islegalAssignTransition(cur.status) ? 'RIDER_ASSIGNED' : cur.status;
          await t.restWrite('PATCH', `orders?id=eq.${encodeURIComponent(ordId)}`, {
            rider_id: offer.riderId,
            batch_id: offer.batchId,
            rider_fare_poisha: offer.farePoisha,
            status: nextStatus,
          });
        }
      }
    },

    async markVendorUnreachable(orderId: string, nowMs: number): Promise<boolean> {
      const cur = await this.getDispatchOrder(orderId);
      if (!cur || cur.status !== 'PLACED') return false;
      await t.restWrite('PATCH', `orders?id=eq.${encodeURIComponent(orderId)}`, {
        status: 'CANCELLED_TIMEOUT',
        cancelled_at: new Date(nowMs).toISOString(),
        cancel_reason_key: 'system_vendor_accept_timeout',
      });
      await t.restWrite('POST', 'order_events', {
        order_id: orderId,
        actor_kind: 'system',
        from_status: 'PLACED',
        to_status: 'CANCELLED_TIMEOUT',
        meta: { code: 'VENDOR_UNREACHABLE' },
      });
      return true;
    },

    async getIdempotencyRecord(key, actorId, nowMs) {
      const rows = await t.restGet<readonly Record<string, unknown>[]>(
        `idempotency_keys?select=*&key=eq.${encodeURIComponent(key)}&actor_id=eq.${encodeURIComponent(actorId)}&limit=1`,
      );
      const r = rows[0];
      if (!r || new Date(String(r['expires_at'])).getTime() <= nowMs) return null;
      return {
        requestHash: String(r['request_hash']),
        status: Number(r['status_code']),
        body: r['response_body'] as Record<string, unknown>,
      };
    },

    async saveIdempotencyRecord(key, actorId, endpoint, requestHash, status, body, nowMs) {
      await t.restWrite(
        'POST',
        'idempotency_keys?on_conflict=actor_id,key',
        {
          key,
          actor_id: actorId,
          route: endpoint,
          request_hash: requestHash,
          status_code: status,
          response_body: body,
          created_at: new Date(nowMs).toISOString(),
          expires_at: new Date(nowMs + 24 * 3600_000).toISOString(),
        },
        'resolution=merge-duplicates,return=minimal',
      );
    },

    async getActiveRtdbLeaseCount(): Promise<number> {
      return 0;
    },
  };
}

function mapOrderRow(r: Record<string, unknown>): DispatchOrderSnapshot {
  const addr = (r['address_snapshot'] as Record<string, unknown> | null) ?? {};
  const vend = (r['vendor_snapshot'] as Record<string, unknown> | null) ?? {};
  const placedAtMs = new Date(String(r['placed_at'])).getTime();
  const prepMin = Number(r['prep_minutes_committed'] ?? 20);
  return {
    orderId: String(r['id']),
    publicCode: String(r['public_code']),
    zoneId: String(r['zone_id']),
    vendorId: String(r['vendor_id']),
    customerId: String(r['customer_id']),
    fulfilment: r['fulfilment'] as 'delivery' | 'pickup',
    status: String(r['status']),
    vendorPoint: { lat: Number(vend['lat'] ?? 24.8949), lng: Number(vend['lng'] ?? 91.8687) },
    customerPoint: { lat: Number(addr['lat'] ?? 24.901), lng: Number(addr['lng'] ?? 91.872) },
    itemsPoisha: Number(r['items_poisha'] ?? 0),
    foodPayablePoisha: Number(r['items_poisha'] ?? 0) - Number(r['discount_total_poisha'] ?? 0),
    codCollectPoisha: Number(r['cod_collect_poisha'] ?? 0),
    isPriority: Boolean(r['is_priority'] ?? false),
    prepReadyAtMs: placedAtMs + prepMin * 60_000,
    placedAtMs,
    bagUnits: 1,
  };
}

function extractPolygonRing(polygon: unknown): readonly GeoPoint[] {
  if (Array.isArray(polygon)) {
    return (polygon as readonly (readonly number[])[]).map((pair) => ({
      lat: Number(pair[1] ?? 0),
      lng: Number(pair[0] ?? 0),
    }));
  }
  const obj = polygon as { coordinates?: readonly (readonly (readonly number[])[])[] } | null;
  const coords = obj?.coordinates?.[0] ?? [];
  return coords.map((pair) => ({ lat: Number(pair[1] ?? 0), lng: Number(pair[0] ?? 0) }));
}
