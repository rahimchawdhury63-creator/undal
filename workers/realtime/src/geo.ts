/**
 * @file workers/realtime/src/geo.ts
 * @description OpenStreetMap / Nominatim (`<= 1 req/s` throttled + 30d cached + Plus-Code fallback),
 * OSRM routing proxy (`5m` cache + Haversine x road-factor fallback), ray-casting zone polygon resolver,
 * and `api.met.no` (CC BY 4.0 primary) + `Open-Meteo` fallback weather resolver (`File 14`, `RSK-04`).
 */

import type { RiderVehicleType, WeatherCondition } from '@undal/shared-ts';
import type {
  GeocodePlace,
  GeoPoint,
  RealtimeDbAdapter,
  RouteLegEstimate,
  ZonePolygonRecord,
} from './types.ts';

const EARTH_RADIUS_KM = 6_371.0088;
const PLUS_ALPHABET = '23456789CFGHJMPQRVWX';
const GEOCODE_TTL_SECONDS = 30 * 24 * 3600;
const ROUTE_TTL_SECONDS = 300;
const WEATHER_TTL_SECONDS = 900;

let nextNominatimSlotMs = 0;

/** Resets in-memory Nominatim rate-gate state for deterministic tests. */
export function resetNominatimGate(): void {
  nextNominatimSlotMs = 0;
}

/** Validates finite WGS-84 coordinates. */
export function isValidCoord(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** Computes exact great-circle distance in kilometres using WGS-84 mean Earth radius. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Encodes a 10-character Open Location Code (`Plus Code`, e.g. `7MQGWR2R+22`) locally without network (`File 14 §14.2`). */
export function encodePlusCode(lat: number, lng: number): string {
  const clampedLat = Math.min(89.999999, Math.max(-90, lat)) + 90;
  const wrappedLng = ((((lng + 180) % 360) + 360) % 360);
  let latRem = clampedLat;
  let lngRem = wrappedLng;
  const stepSizes = [20, 1, 0.05, 0.0025, 0.000125];
  let out = '';
  for (let i = 0; i < stepSizes.length; i += 1) {
    const step = stepSizes[i]!;
    const latDigit = Math.min(19, Math.floor(latRem / step));
    const lngDigit = Math.min(19, Math.floor(lngRem / step));
    latRem -= latDigit * step;
    lngRem -= lngDigit * step;
    out += PLUS_ALPHABET[latDigit]! + PLUS_ALPHABET[lngDigit]!;
    if (i === 3) out += '+';
  }
  return out;
}

/** Encodes an `n`-character base32 geohash for hotspot aggregation (`r-07`). */
export function encodeGeohash(lat: number, lng: number, precision: number = 6): string {
  const base32 = '0123456789bcdefghjkmnpqrstuvwxyz';
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  let hash = '';
  let bit = 0;
  let ch = 0;
  let even = true;

  while (hash.length < precision) {
    if (even) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) {
        ch = (ch << 1) | 1;
        minLng = mid;
      } else {
        ch <<= 1;
        maxLng = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) {
        ch = (ch << 1) | 1;
        minLat = mid;
      } else {
        ch <<= 1;
        maxLat = mid;
      }
    }
    even = !even;
    bit += 1;
    if (bit === 5) {
      hash += base32[ch]!;
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

/** Ray-casting point-in-polygon check (`File 14 §14.4`). */
export function pointInPolygon(point: GeoPoint, ring: readonly GeoPoint[]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i]!.lng;
    const yi = ring[i]!.lat;
    const xj = ring[j]!.lng;
    const yj = ring[j]!.lat;
    const intersect =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonApproxAreaSqKm(ring: readonly GeoPoint[]): number {
  if (ring.length < 3) return Number.POSITIVE_INFINITY;
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    area += (ring[j]!.lng + ring[i]!.lng) * (ring[j]!.lat - ring[i]!.lat);
  }
  return Math.abs(area / 2) * 111.32 * 102.47;
}

function polygonCentroid(ring: readonly GeoPoint[]): GeoPoint {
  if (ring.length === 0) return { lat: 0, lng: 0 };
  let sumLat = 0;
  let sumLng = 0;
  for (const pt of ring) {
    sumLat += pt.lat;
    sumLng += pt.lng;
  }
  return { lat: sumLat / ring.length, lng: sumLng / ring.length };
}

/**
 * Resolves a coordinate against active zones (`File 14 §14.4`):
 * - Smallest containing polygon wins on overlaps.
 * - Returns nearest active zone distance when outside all polygons.
 */
export function resolvePointZone(
  point: GeoPoint,
  zones: readonly ZonePolygonRecord[],
): {
  readonly serviceable: boolean;
  readonly matchedZone: ZonePolygonRecord | null;
  readonly nearestZone: { slug: string; nameEn: string; distanceKm: number } | null;
} {
  const active = zones.filter((z) => z.isActive && z.ring.length >= 3);
  const matching = active
    .filter((z) => pointInPolygon(point, z.ring))
    .sort((a, b) => polygonApproxAreaSqKm(a.ring) - polygonApproxAreaSqKm(b.ring));

  if (matching.length > 0) {
    return { serviceable: true, matchedZone: matching[0]!, nearestZone: null };
  }

  let best: { slug: string; nameEn: string; distanceKm: number } | null = null;
  for (const zone of active) {
    let minKm = haversineKm(point, polygonCentroid(zone.ring));
    for (const vertex of zone.ring) {
      minKm = Math.min(minKm, haversineKm(point, vertex));
    }
    const rounded = Math.round(minKm * 100) / 100;
    if (!best || rounded < best.distanceKm) {
      best = { slug: zone.slug, nameEn: zone.nameEn, distanceKm: rounded };
    }
  }
  return { serviceable: false, matchedZone: null, nearestZone: best };
}

/** Deterministic urban road-leg estimate (`File 14 §14.3`: Haversine x `1.35` road factor). */
export function estimateRoadLegFallback(
  origin: GeoPoint,
  dest: GeoPoint,
  vehicleType: RiderVehicleType = 'motorbike',
  roadFactor: number = 1.35,
): RouteLegEstimate {
  const straightKm = haversineKm(origin, dest);
  const distanceKm = Math.round(straightKm * roadFactor * 1_000) / 1_000;
  const speedKmh = vehicleType === 'bicycle' ? 14 : 26;
  const durationMinutes = Math.max(1, Math.round(((distanceKm / speedKmh) * 60) * 100) / 100);
  return {
    distanceKm,
    durationMinutes,
    trafficDelayMinutes: 0,
    geometry: null,
    source: 'haversine_fallback',
  };
}

/** Enforces OSM Nominatim's strict `<= 1 req/s` policy across requests in an isolate. */
async function acquireNominatimSlot(nowFn: () => number): Promise<void> {
  const now = nowFn();
  if (now < nextNominatimSlotMs) {
    const waitMs = nextNominatimSlotMs - now;
    nextNominatimSlotMs += 1_000;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return;
  }
  nextNominatimSlotMs = now + 1_000;
}

/** Forward geocodes a Bangladesh address query with `30d` cache + `<= 1 req/s` Nominatim throttle. */
export async function forwardGeocode(params: {
  readonly query: string;
  readonly lang: 'en' | 'bn';
  readonly db: RealtimeDbAdapter;
  readonly fetchImpl: typeof fetch;
  readonly baseUrl: string;
  readonly contactEmail: string;
  readonly nowMs: number;
  readonly nowFn?: () => number;
}): Promise<readonly GeocodePlace[]> {
  const norm = params.query.trim().toLowerCase().replace(/\s+/g, ' ');
  const cacheKey = `fwd:${params.lang}:${norm.slice(0, 140)}`;
  const cached = await params.db.getGeocodeCache(cacheKey, params.nowMs);
  if (cached && Array.isArray(cached['places'])) {
    return (cached['places'] as GeocodePlace[]).map((p) => ({ ...p, source: 'cache' }));
  }

  await acquireNominatimSlot(params.nowFn ?? Date.now);
  const url = `${params.baseUrl.replace(/\/$/, '')}/search?format=jsonv2&countrycodes=bd&limit=5&q=${encodeURIComponent(norm)}`;
  const res = await params.fetchImpl(url, {
    headers: {
      'User-Agent': `UndalFoodDelivery/1.0 (${params.contactEmail})`,
      'Accept-Language': params.lang === 'bn' ? 'bn,en' : 'en,bn',
    },
    signal: AbortSignal.timeout(2_500),
  });
  if (!res.ok) return [];
  const raw = (await res.json()) as readonly { display_name?: string; lat?: string; lon?: string }[];
  const places: GeocodePlace[] = [];
  for (const item of raw) {
    const lat = Number(item.lat);
    const lng = Number(item.lon);
    if (!isValidCoord(lat, lng)) continue;
    places.push({
      displayName: String(item.display_name ?? norm),
      lat,
      lng,
      plusCode: encodePlusCode(lat, lng),
      source: 'nominatim',
    });
  }

  await params.db.putGeocodeCache(cacheKey, 'forward', { places }, GEOCODE_TTL_SECONDS, params.nowMs);
  return places;
}

/** Reverse-geocodes `lat,lng` with `5 dp` cache key and offline Plus-Code resilience (`File 14 §14.2`). */
export async function reverseGeocode(params: {
  readonly point: GeoPoint;
  readonly lang: 'en' | 'bn';
  readonly db: RealtimeDbAdapter;
  readonly fetchImpl: typeof fetch;
  readonly baseUrl: string;
  readonly contactEmail: string;
  readonly nowMs: number;
  readonly nowFn?: () => number;
}): Promise<GeocodePlace> {
  const lat5 = params.point.lat.toFixed(5);
  const lng5 = params.point.lng.toFixed(5);
  const plusCode = encodePlusCode(params.point.lat, params.point.lng);
  const cacheKey = `rev:${params.lang}:${lat5},${lng5}`;
  const cached = await params.db.getGeocodeCache(cacheKey, params.nowMs);
  if (cached && typeof cached['displayName'] === 'string') {
    return {
      displayName: cached['displayName'],
      lat: params.point.lat,
      lng: params.point.lng,
      plusCode,
      source: 'cache',
    };
  }

  try {
    await acquireNominatimSlot(params.nowFn ?? Date.now);
    const url = `${params.baseUrl.replace(/\/$/, '')}/reverse?format=jsonv2&lat=${lat5}&lon=${lng5}`;
    const res = await params.fetchImpl(url, {
      headers: {
        'User-Agent': `UndalFoodDelivery/1.0 (${params.contactEmail})`,
        'Accept-Language': params.lang === 'bn' ? 'bn,en' : 'en,bn',
      },
      signal: AbortSignal.timeout(2_500),
    });
    if (res.ok) {
      const json = (await res.json()) as { display_name?: string };
      const displayName = json.display_name?.trim() || `${plusCode}, Bangladesh`;
      await params.db.putGeocodeCache(cacheKey, 'reverse', { displayName }, GEOCODE_TTL_SECONDS, params.nowMs);
      return { displayName, lat: params.point.lat, lng: params.point.lng, plusCode, source: 'nominatim' };
    }
  } catch {
    // Graceful Plus-Code fallback on upstream timeout/network fault (File 14 §14.2).
  }
  return {
    displayName: `${plusCode}, Bangladesh`,
    lat: params.point.lat,
    lng: params.point.lng,
    plusCode,
    source: 'plus_code_fallback',
  };
}

/** Routes `origin -> dest` via `geocode_cache` -> `OSRM` (`2.5s` timeout) -> Haversine fallback (`File 14 §14.3`). */
export async function routeBetweenPoints(params: {
  readonly origin: GeoPoint;
  readonly dest: GeoPoint;
  readonly vehicleType: RiderVehicleType;
  readonly roadFactor?: number;
  readonly db: RealtimeDbAdapter;
  readonly fetchImpl: typeof fetch;
  readonly osrmBaseUrl: string;
  readonly nowMs: number;
}): Promise<RouteLegEstimate> {
  const key = `osrm:${params.vehicleType}:${params.origin.lat.toFixed(4)},${params.origin.lng.toFixed(4)}->${params.dest.lat.toFixed(4)},${params.dest.lng.toFixed(4)}`;
  const cached = await params.db.getGeocodeCache(key, params.nowMs);
  if (cached && typeof cached['distanceKm'] === 'number' && typeof cached['durationMinutes'] === 'number') {
    return {
      distanceKm: cached['distanceKm'],
      durationMinutes: cached['durationMinutes'],
      trafficDelayMinutes: Number(cached['trafficDelayMinutes'] ?? 0),
      geometry: typeof cached['geometry'] === 'string' ? cached['geometry'] : null,
      source: 'cache',
    };
  }

  const profile = params.vehicleType === 'bicycle' ? 'cycling' : 'driving';
  try {
    const url = `${params.osrmBaseUrl.replace(/\/$/, '')}/route/v1/${profile}/${params.origin.lng},${params.origin.lat};${params.dest.lng},${params.dest.lat}?overview=simplified`;
    const res = await params.fetchImpl(url, { signal: AbortSignal.timeout(2_500) });
    if (res.ok) {
      const data = (await res.json()) as {
        routes?: readonly { distance?: number; duration?: number; geometry?: string }[];
      };
      const first = data.routes?.[0];
      if (first && typeof first.distance === 'number' && typeof first.duration === 'number') {
        const distanceKm = Math.round((first.distance / 1_000) * 1_000) / 1_000;
        const durationMinutes = Math.max(1, Math.round((first.duration / 60) * 100) / 100);
        const freeflowMin = (distanceKm / (params.vehicleType === 'bicycle' ? 15 : 30)) * 60;
        const trafficDelayMinutes = Math.max(0, Math.round((durationMinutes - freeflowMin) * 100) / 100);
        const built: RouteLegEstimate = {
          distanceKm,
          durationMinutes,
          trafficDelayMinutes,
          geometry: first.geometry ?? null,
          source: 'osrm',
        };
        await params.db.putGeocodeCache(key, 'route_osrm', { ...built }, ROUTE_TTL_SECONDS, params.nowMs);
        return built;
      }
    }
  } catch {
    // Upstream demo server unreachable — fall through cleanly to deterministic road-factor estimate.
  }
  return estimateRoadLegFallback(params.origin, params.dest, params.vehicleType, params.roadFactor ?? 1.35);
}

/** Resolves per-zone weather using `admin_override` -> `api.met.no` (CC BY 4.0) -> `Open-Meteo` -> `'clear'` (`RSK-04`). */
export async function resolveZoneWeather(params: {
  readonly zoneId: string;
  readonly center: GeoPoint;
  readonly db: RealtimeDbAdapter;
  readonly fetchImpl: typeof fetch;
  readonly metNorwayBaseUrl: string;
  readonly openMeteoBaseUrl: string;
  readonly contactEmail: string;
  readonly nowMs: number;
}): Promise<WeatherCondition> {
  const existing = await params.db.getZoneWeather(params.zoneId, params.nowMs);
  if (existing && existing.expiresAtMs > params.nowMs) {
    return existing.condition;
  }

  const classify = (tempC: number, precipMm: number): WeatherCondition => {
    if (precipMm >= 7.5) return 'storm';
    if (precipMm >= 0.6) return 'rain';
    if (tempC >= 37) return 'extreme_heat';
    return 'clear';
  };

  try {
    const metUrl = `${params.metNorwayBaseUrl.replace(/\/$/, '')}/weatherapi/locationforecast/2.0/compact?lat=${params.center.lat.toFixed(4)}&lon=${params.center.lng.toFixed(4)}`;
    const res = await params.fetchImpl(metUrl, {
      headers: { 'User-Agent': `UndalFoodDelivery/1.0 (${params.contactEmail})` },
      signal: AbortSignal.timeout(2_500),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        properties?: {
          timeseries?: readonly {
            data?: {
              instant?: { details?: { air_temperature?: number } };
              next_1_hours?: { details?: { precipitation_amount?: number } };
            };
          }[];
        };
      };
      const entry = json.properties?.timeseries?.[0]?.data;
      const tempC = Number(entry?.instant?.details?.air_temperature ?? 28);
      const precipMm = Number(entry?.next_1_hours?.details?.precipitation_amount ?? 0);
      const condition = classify(tempC, precipMm);
      await params.db.upsertZoneWeather(params.zoneId, condition, tempC, precipMm, 'met_norway', WEATHER_TTL_SECONDS, params.nowMs);
      return condition;
    }
  } catch {
    // Fall back to Open-Meteo or 'clear'.
  }

  try {
    const omUrl = `${params.openMeteoBaseUrl.replace(/\/$/, '')}/v1/forecast?latitude=${params.center.lat.toFixed(4)}&longitude=${params.center.lng.toFixed(4)}&current=temperature_2m,precipitation`;
    const res = await params.fetchImpl(omUrl, { signal: AbortSignal.timeout(2_500) });
    if (res.ok) {
      const json = (await res.json()) as { current?: { temperature_2m?: number; precipitation?: number } };
      const tempC = Number(json.current?.temperature_2m ?? 28);
      const precipMm = Number(json.current?.precipitation ?? 0);
      const condition = classify(tempC, precipMm);
      await params.db.upsertZoneWeather(params.zoneId, condition, tempC, precipMm, 'open_meteo', WEATHER_TTL_SECONDS, params.nowMs);
      return condition;
    }
  } catch {
    // Upstream offline -> safe neutral 'clear' condition.
  }

  return 'clear';
}
