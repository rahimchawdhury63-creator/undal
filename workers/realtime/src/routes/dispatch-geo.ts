/**
 * @file workers/realtime/src/routes/dispatch-geo.ts
 * @description Dispatch trigger (`POST /v1/dispatch/order-placed`), atomic offer accept/reject
 * (`POST /v1/offers/:id/accept`, `POST /v1/offers/:id/reject`), Zone SDR & hotspot snapshot
 * (`GET /v1/zone/:id/sdr`), and Nominatim/OSRM geo proxies (`POST /v1/geo/*`) on `W2 undal-realtime`.
 */

import { calculateRiderFare, DEFAULT_FARE_POLICY, errEnvelope, okEnvelope } from '@undal/shared-ts';
import { maxConcurrentCapacity } from '../assignment.ts';
import {
  encodeGeohash,
  forwardGeocode,
  isValidCoord,
  resolvePointZone,
  resolveZoneWeather,
  reverseGeocode,
  routeBetweenPoints,
} from '../geo.ts';
import {
  checkRateLimit,
  executeIdempotent,
  jsonErr,
  jsonOk,
  verifyInternalHmacRequest,
} from '../http.ts';
import { classifyPresence } from '../presence.ts';
import type {
  AuthPrincipal,
  DurableNamespaceLike,
  GeoPoint,
  RealtimeDbAdapter,
  RealtimeWorkerEnv,
  ZoneSdrSnapshot,
} from '../types.ts';

const SDR_CACHE = new Map<string, { expiresAtMs: number; snapshot: ZoneSdrSnapshot }>();

/** Clears cached zone SDR snapshots for deterministic tests. */
export function resetZoneSdrCache(): void {
  SDR_CACHE.clear();
}

/** Handles all `/v1/dispatch/*`, `/v1/offers/*`, `/v1/zone/*`, and `/v1/geo/*` routes on `W2`. */
export async function handleDispatchAndGeoRoutes(params: {
  readonly request: Request;
  readonly pathname: string;
  readonly requestId: string;
  readonly principal: AuthPrincipal | null;
  readonly env: RealtimeWorkerEnv;
  readonly db: RealtimeDbAdapter;
  readonly zoneDispatchNs: DurableNamespaceLike;
  readonly nowMs: number;
}): Promise<Response | null> {
  const { request, pathname, requestId, principal, env, db, zoneDispatchNs, nowMs } = params;
  const fetchFn = env.fetchImpl ?? fetch;

  // 1. Cross-Worker HMAC-authenticated order-placed dispatch trigger (`W1 -> W2`)
  if (request.method === 'POST' && pathname === '/v1/dispatch/order-placed') {
    const rawBody = await request.text();
    const validHmac = await verifyInternalHmacRequest(
      rawBody,
      request.headers,
      env.INTERNAL_HMAC_SECRET,
      nowMs,
    );
    if (!validHmac) {
      return jsonErr('AUTH_FORBIDDEN_PERMISSION', requestId, { reason: 'invalid_internal_hmac' }, undefined, 401);
    }

    let body: { order_id?: string; zone_id?: string; vendor_profile_id?: string };
    try {
      body = JSON.parse(rawBody) as { order_id?: string; zone_id?: string; vendor_profile_id?: string };
    } catch {
      return jsonErr('VALIDATION_FAILED', requestId);
    }
    if (!body.order_id || !body.zone_id) {
      return jsonErr('VALIDATION_FAILED', requestId, { required: ['order_id', 'zone_id'] });
    }

    const stub = zoneDispatchNs.get(zoneDispatchNs.idFromName(body.zone_id));
    const doRes = await stub.fetch('https://zone-dispatch/dispatch/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: body.order_id, vendorProfileId: body.vendor_profile_id }),
    });
    const payload = (await doRes.json()) as Record<string, unknown>;
    if (!doRes.ok) return jsonErr('ORDER_STATE_ILLEGAL', requestId, payload);
    return jsonOk(payload, requestId);
  }

  // 2. Atomic Rider Offer Accept / Reject (`POST /v1/offers/:id/accept|reject`)
  const offerMatch = /^\/v1\/offers\/([^/]+)\/(accept|reject)$/.exec(pathname);
  if (request.method === 'POST' && offerMatch) {
    if (!principal) return jsonErr('SESSION_EXPIRED', requestId);
    if (principal.role !== 'rider') return jsonErr('AUTH_ROLE_MISMATCH', requestId);

    const offerId = decodeURIComponent(offerMatch[1]!);
    const action = offerMatch[2] as 'accept' | 'reject';
    const rawBody = await request.text();

    return executeIdempotent({
      request,
      rawBody,
      actorId: principal.sub,
      endpoint: pathname,
      requestId,
      db,
      nowMs,
      handler: async () => {
        const identity = await db.getOperatorIdentity(principal.sub, 'rider');
        if (!identity) return errEnvelope('AUTH_ROLE_MISMATCH', requestId);

        let parsed: Record<string, unknown> = {};
        if (rawBody.trim().length > 0) {
          try {
            parsed = JSON.parse(rawBody) as Record<string, unknown>;
          } catch {
            return errEnvelope('VALIDATION_FAILED', requestId);
          }
        }
        const zoneId = typeof parsed['zone_id'] === 'string' && parsed['zone_id'] ? parsed['zone_id'] : identity.zoneId;
        const stub = zoneDispatchNs.get(zoneDispatchNs.idFromName(zoneId));

        if (action === 'accept') {
          const doRes = await stub.fetch('https://zone-dispatch/offers/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ offerId, riderId: identity.refId }),
          });
          const data = (await doRes.json()) as Record<string, unknown>;
          if (!doRes.ok) return errEnvelope('OFFER_EXPIRED', requestId, data);
          return { status: 200, body: okEnvelope(data, requestId) };
        }

        const reason = typeof parsed['reason'] === 'string' && parsed['reason'].trim() ? parsed['reason'].trim() : 'other';
        const requestReassign = Boolean(parsed['request_reassign']);
        const doRes = await stub.fetch('https://zone-dispatch/offers/reject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offerId, riderId: identity.refId, reason, requestReassign }),
        });
        const data = (await doRes.json()) as Record<string, unknown>;
        if (doRes.status === 409) {
          return errEnvelope('OFFER_NOT_REJECTABLE', requestId, data);
        }
        if (!doRes.ok) {
          return errEnvelope('OFFER_EXPIRED', requestId, data);
        }
        return { status: 200, body: okEnvelope(data, requestId) };
      },
    });
  }

  // 3. Cached `60s` Zone Supply/Demand Ratio & Hotspot Heatmap (`GET /v1/zone/:id/sdr`)
  const sdrMatch = /^\/v1\/zone\/([^/]+)\/sdr$/.exec(pathname);
  if (request.method === 'GET' && sdrMatch) {
    const internalOk = await verifyInternalHmacRequest('', request.headers, env.INTERNAL_HMAC_SECRET, nowMs);
    if (!internalOk) {
      if (!principal) return jsonErr('SESSION_EXPIRED', requestId);
      if (principal.role !== 'rider' && principal.role !== 'admin') {
        return jsonErr('AUTH_ROLE_MISMATCH', requestId);
      }
    }
    const zoneId = decodeURIComponent(sdrMatch[1]!);
    const cached = SDR_CACHE.get(zoneId);
    if (cached && cached.expiresAtMs > nowMs) {
      return jsonOk(cached.snapshot, requestId, 200, { 'X-Cache': 'HIT' });
    }

    const [orders, candidates, zones] = await Promise.all([
      db.listUnassignedZoneOrders(zoneId),
      db.listZoneRiderCandidates(zoneId, nowMs),
      db.listZones(),
    ]);
    const zone = zones.find((z) => z.id === zoneId);
    const center: GeoPoint = zone?.ring[0] ?? { lat: 24.8949, lng: 91.8687 };
    const weatherCondition = await resolveZoneWeather({
      zoneId,
      center,
      db,
      fetchImpl: fetchFn,
      metNorwayBaseUrl: env.MET_NORWAY_BASE_URL ?? 'https://api.met.no',
      openMeteoBaseUrl: env.OPEN_METEO_BASE_URL ?? 'https://api.open-meteo.com',
      contactEmail: env.NOMINATIM_CONTACT_EMAIL ?? 'ops@undal.app',
      nowMs,
    });

    const activeRiders = candidates.filter(
      (c) =>
        classifyPresence(c.lastSeenAtMs, nowMs) === 'LIVE' &&
        c.isActive &&
        c.isOnline &&
        c.kycStatus === 'approved' &&
        !c.cashGateBlocked &&
        c.capacityUsed < maxConcurrentCapacity(c.vehicleType),
    ).length;

    const activeOrders = orders.length;
    const sampleBike = calculateRiderFare(
      {
        travelDistanceKm: 3.0,
        toVendorKm: 1.0,
        trafficDelayMinutes: 0,
        activeOrdersInZone: Math.max(1, activeOrders),
        activeRidersInZone: activeRiders,
        weatherCondition,
        vehicleType: 'motorbike',
        batchPosition: 1,
        orderFoodPayablePoisha: 30_000,
        isPriority: false,
      },
      DEFAULT_FARE_POLICY,
    );
    const sampleCycle = calculateRiderFare(
      {
        travelDistanceKm: 2.0,
        toVendorKm: 0.5,
        trafficDelayMinutes: 0,
        activeOrdersInZone: Math.max(1, activeOrders),
        activeRidersInZone: activeRiders,
        weatherCondition,
        vehicleType: 'bicycle',
        batchPosition: 1,
        orderFoodPayablePoisha: 30_000,
        isPriority: false,
      },
      DEFAULT_FARE_POLICY,
    );

    const hotspotBuckets = new Map<string, { count: number; latSum: number; lngSum: number }>();
    for (const o of orders) {
      const gh = encodeGeohash(o.vendorPoint.lat, o.vendorPoint.lng, 6);
      const cur = hotspotBuckets.get(gh) ?? { count: 0, latSum: 0, lngSum: 0 };
      cur.count += 1;
      cur.latSum += o.vendorPoint.lat;
      cur.lngSum += o.vendorPoint.lng;
      hotspotBuckets.set(gh, cur);
    }

    const snapshot: ZoneSdrSnapshot = {
      zoneId,
      activeOrders,
      activeRiders,
      sdr: sampleBike.sdr,
      surgeMotorbike: sampleBike.surgeMultiplier,
      surgeBicycle: sampleCycle.surgeMultiplier,
      weatherCondition,
      hotspots: Array.from(hotspotBuckets.entries()).map(([geohash6, info]) => ({
        geohash6,
        openOrders: info.count,
        center: {
          lat: Number((info.latSum / info.count).toFixed(5)),
          lng: Number((info.lngSum / info.count).toFixed(5)),
        },
      })),
      computedAtIso: new Date(nowMs).toISOString(),
    };
    SDR_CACHE.set(zoneId, { expiresAtMs: nowMs + 60_000, snapshot });
    return jsonOk(snapshot, requestId, 200, { 'X-Cache': 'MISS' });
  }

  // 4. Geo Proxies (`POST /v1/geo/geocode`, `/v1/geo/reverse`, `/v1/geo/route`)
  if (request.method === 'POST' && pathname.startsWith('/v1/geo/')) {
    if (!principal) return jsonErr('SESSION_EXPIRED', requestId);
    const isRoute = pathname === '/v1/geo/route';
    const rl = checkRateLimit(`geo:${pathname}:${principal.sub}`, isRoute ? 60 : 30, 60_000, nowMs);
    if (!rl.allowed) {
      return jsonErr('RATE_LIMITED', requestId, undefined, { 'Retry-After': String(rl.retryAfterSeconds) });
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return jsonErr('VALIDATION_FAILED', requestId);
    }
    const lang: 'en' | 'bn' = body['lang'] === 'bn' ? 'bn' : 'en';

    if (pathname === '/v1/geo/geocode') {
      const q = typeof body['query'] === 'string' ? body['query'].trim() : '';
      if (q.length < 2 || q.length > 140) return jsonErr('VALIDATION_FAILED', requestId, { field: 'query' });
      const zones = await db.listZones();
      const places = await forwardGeocode({
        query: q,
        lang,
        db,
        fetchImpl: fetchFn,
        baseUrl: env.NOMINATIM_BASE_URL ?? 'https://nominatim.openstreetmap.org',
        contactEmail: env.NOMINATIM_CONTACT_EMAIL ?? 'ops@undal.app',
        nowMs,
      });
      const enriched = places.map((p) => {
        const verdict = resolvePointZone({ lat: p.lat, lng: p.lng }, zones);
        return {
          ...p,
          serviceable: verdict.serviceable,
          zone_id: verdict.matchedZone?.id ?? null,
          zone_slug: verdict.matchedZone?.slug ?? null,
          nearest_zone: verdict.nearestZone,
        };
      });
      return jsonOk({ places: enriched }, requestId);
    }

    if (pathname === '/v1/geo/reverse') {
      if (!isValidCoord(body['lat'], body['lng'])) return jsonErr('VALIDATION_FAILED', requestId, { field: 'lat/lng' });
      const point = { lat: Number(body['lat']), lng: Number(body['lng']) };
      const [place, zones] = await Promise.all([
        reverseGeocode({
          point,
          lang,
          db,
          fetchImpl: fetchFn,
          baseUrl: env.NOMINATIM_BASE_URL ?? 'https://nominatim.openstreetmap.org',
          contactEmail: env.NOMINATIM_CONTACT_EMAIL ?? 'ops@undal.app',
          nowMs,
        }),
        db.listZones(),
      ]);
      const verdict = resolvePointZone(point, zones);
      return jsonOk(
        {
          place,
          serviceable: verdict.serviceable,
          zone_id: verdict.matchedZone?.id ?? null,
          zone_slug: verdict.matchedZone?.slug ?? null,
          nearest_zone: verdict.nearestZone,
        },
        requestId,
      );
    }

    if (pathname === '/v1/geo/route') {
      const oLat = body['origin_lat'];
      const oLng = body['origin_lng'];
      const dLat = body['dest_lat'];
      const dLng = body['dest_lng'];
      if (!isValidCoord(oLat, oLng) || !isValidCoord(dLat, dLng)) {
        return jsonErr('VALIDATION_FAILED', requestId, { field: 'origin/dest' });
      }
      const vehicleType = body['vehicle_type'] === 'bicycle' ? 'bicycle' : 'motorbike';
      const leg = await routeBetweenPoints({
        origin: { lat: Number(oLat), lng: Number(oLng) },
        dest: { lat: Number(dLat), lng: Number(dLng) },
        vehicleType,
        db,
        fetchImpl: fetchFn,
        osrmBaseUrl: env.OSRM_BASE_URL ?? 'https://router.project-osrm.org',
        nowMs,
      });
      return jsonOk(leg, requestId);
    }
  }

  return null;
}
