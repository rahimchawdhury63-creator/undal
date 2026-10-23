/**
 * @file workers/admin/src/geo-polygon.ts
 * @description Geofencing geometry utilities for Super Admin Domain 3 (`C41–C44`):
 *   - `C42`: 1-click N-point circle polygon generator (`[lng, lat]` GeoJSON-order vertices matching `public.zones.polygon`)
 *   - `C44`: Deterministic segment self-intersection detector + cross-zone overlap detector + planar km² area
 */

export type LngLatPair = readonly [number, number];

const DEG_TO_RAD = Math.PI / 180;

/**
 * Generates an N-point regular geographic polygon (`[lng, lat]` ring) from `(centerLat, centerLng, radiusKm)`
 * (`C42` — allows launching a new town like Kulaura in 1 tap before hand-refining vertices).
 */
export function generateCirclePolygon(params: {
  readonly centerLat: number;
  readonly centerLng: number;
  readonly radiusKm: number;
  readonly vertices?: number;
}): readonly LngLatPair[] {
  const count = Math.min(96, Math.max(6, Math.round(params.vertices ?? 24)));
  const latDeltaDeg = params.radiusKm / 110.574;
  const cosLat = Math.max(0.01, Math.cos(params.centerLat * DEG_TO_RAD));
  const lngDeltaDeg = params.radiusKm / (111.32 * cosLat);

  const ring: LngLatPair[] = [];
  for (let i = 0; i < count; i += 1) {
    const theta = (2 * Math.PI * i) / count;
    const lng = Number((params.centerLng + lngDeltaDeg * Math.cos(theta)).toFixed(6));
    const lat = Number((params.centerLat + latDeltaDeg * Math.sin(theta)).toFixed(6));
    ring.push([lng, lat]);
  }
  return ring;
}

/** Computes planar shoelace area in `km²` matching SQL `public.polygon_area_km2`. */
export function computePolygonAreaKm2(ring: readonly LngLatPair[]): number {
  if (ring.length < 3) return 0;
  const meanLatRad =
    (ring.reduce((acc, p) => acc + p[1], 0) / ring.length) * DEG_TO_RAD;
  const kmPerDegLng = 111.32 * Math.cos(meanLatRad);
  const kmPerDegLat = 110.574;

  let twiceArea = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    twiceArea += x1 * kmPerDegLng * (y2 * kmPerDegLat) - x2 * kmPerDegLng * (y1 * kmPerDegLat);
  }
  return Math.abs(twiceArea) / 2;
}

/** Ray-casting point-in-polygon check for `[lng, lat]` ring. */
export function isPointInRing(lng: number, lat: number, ring: readonly LngLatPair[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function ccw(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (cy - ay) * (bx - ax) - (by - ay) * (cx - ax);
}

function segmentsProperlyIntersect(a: LngLatPair, b: LngLatPair, c: LngLatPair, d: LngLatPair): boolean {
  const d1 = ccw(a[0], a[1], b[0], b[1], c[0], c[1]);
  const d2 = ccw(a[0], a[1], b[0], b[1], d[0], d[1]);
  const d3 = ccw(c[0], c[1], d[0], d[1], a[0], a[1]);
  const d4 = ccw(c[0], c[1], d[0], d[1], b[0], b[1]);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function ringsOverlap(r1: readonly LngLatPair[], r2: readonly LngLatPair[]): boolean {
  for (const [lng, lat] of r1) {
    if (isPointInRing(lng, lat, r2)) return true;
  }
  for (const [lng, lat] of r2) {
    if (isPointInRing(lng, lat, r1)) return true;
  }
  for (let i = 0; i < r1.length; i += 1) {
    const a1 = r1[i]!;
    const a2 = r1[(i + 1) % r1.length]!;
    for (let j = 0; j < r2.length; j += 1) {
      const b1 = r2[j]!;
      const b2 = r2[(j + 1) % r2.length]!;
      if (segmentsProperlyIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/**
 * Validates polygon vertex count (`>= 3`), coordinate bounds, non-self-intersection,
 * positive km² area, and non-overlap against existing active/draft zones (`C44`).
 */
export function validateZonePolygon(params: {
  readonly polygon: readonly LngLatPair[];
  readonly existingZones: readonly {
    readonly id: string;
    readonly slug: string;
    readonly polygon: readonly LngLatPair[];
  }[];
  readonly excludeZoneId?: string | undefined;
}): {
  readonly valid: boolean;
  readonly areaKm2: number;
  readonly selfIntersecting: boolean;
  readonly overlappingSlugs: readonly string[];
  readonly reason: string | null;
} {
  const ring =
    params.polygon.length >= 4 &&
    params.polygon[0]![0] === params.polygon.at(-1)![0] &&
    params.polygon[0]![1] === params.polygon.at(-1)![1]
      ? params.polygon.slice(0, -1)
      : params.polygon;

  if (ring.length < 3) {
    return { valid: false, areaKm2: 0, selfIntersecting: false, overlappingSlugs: [], reason: 'min_3_vertices' };
  }
  for (const [lng, lat] of ring) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return { valid: false, areaKm2: 0, selfIntersecting: false, overlappingSlugs: [], reason: 'coords_out_of_bounds' };
    }
  }

  let selfIntersecting = false;
  for (let i = 0; i < ring.length && !selfIntersecting; i += 1) {
    const a1 = ring[i]!;
    const a2 = ring[(i + 1) % ring.length]!;
    for (let j = i + 2; j < ring.length; j += 1) {
      if (i === 0 && j === ring.length - 1) continue; // adjacent wraparound edge
      const b1 = ring[j]!;
      const b2 = ring[(j + 1) % ring.length]!;
      if (segmentsProperlyIntersect(a1, a2, b1, b2)) {
        selfIntersecting = true;
        break;
      }
    }
  }

  const areaKm2 = Number(computePolygonAreaKm2(ring).toFixed(4));
  const overlappingSlugs: string[] = [];
  for (const z of params.existingZones) {
    if (params.excludeZoneId && z.id === params.excludeZoneId) continue;
    if (z.polygon.length >= 3 && ringsOverlap(ring, z.polygon)) {
      overlappingSlugs.push(z.slug);
    }
  }

  if (selfIntersecting) {
    return { valid: false, areaKm2, selfIntersecting: true, overlappingSlugs, reason: 'self_intersection' };
  }
  if (areaKm2 <= 0.01 || areaKm2 >= 25_000) {
    return { valid: false, areaKm2, selfIntersecting: false, overlappingSlugs, reason: 'invalid_area_km2' };
  }
  return {
    valid: overlappingSlugs.length === 0,
    areaKm2,
    selfIntersecting: false,
    overlappingSlugs,
    reason: overlappingSlugs.length > 0 ? 'zone_overlap' : null,
  };
}
