/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Where a zone ends, in metres (`11 §7` filter 7, D119).
 *
 * `zones.polygon` is a GeoJSON ring of `[lon_e7, lat_e7]` pairs — TiDB has no spatial types, so the shape is JSON
 * and every question about it is answered here rather than by the database (`002_geography.sql`). The one question
 * dispatch asks is filter 7's: *how far outside the rider's own zone is this rider?* The answer is zero for a
 * rider inside the zone and a distance for one outside it, and at T+112 s the fallback admits riders up to 3 000 m
 * outside the boundary — so this number is not decoration, it is the difference between a rider being asked and an
 * order expiring into a refund.
 *
 * The arithmetic is planar and local on purpose. A zone is a few kilometres across, so the equirectangular
 * projection scaled by `cos(lat)` is accurate to centimetres at this scale, and it can be reasoned about without a
 * geometry library. What it must *not* do is pretend to work everywhere: the projection has a singularity at the
 * poles and the ring convention breaks across the antimeridian. Both are named below rather than left to be
 * discovered by a deployment in a city that is not Sylhet.
 */

import type { PointE7 } from "@undal/contracts";
import { haversineMeters } from "@undal/contracts";

/**
 * A closed ring of E7 vertices, as `zones.polygon` stores it.
 *
 * Always at least four entries and always closed — `parseZoneRing` normalises an open ring rather than trusting the
 * writer, because a ring that is silently open makes point-in-polygon answer "outside" for points on the segment
 * that was never drawn.
 */
export type ZoneRing = readonly PointE7[];

/** Mean Earth radius, metres (IUGG). Matches the haversine in `@undal/contracts`. */
const EARTH_RADIUS_M = 6_371_008.8;

/**
 * Parse a stored polygon into a closed ring of E7 points, or `null` if it is not a shape.
 *
 * Accepts exactly the storage format — an array of `[lonE7, latE7]` pairs, integers within range — and refuses
 * everything else. Refusing rather than repairing is deliberate: a zone whose polygon is malformed is a data error,
 * and a dispatch that quietly treated it as empty would refuse every rider in that zone with no way to tell why.
 */
export function parseZoneRing(node: unknown): ZoneRing | null {
  if (!Array.isArray(node) || node.length < 3) return null;
  const points: PointE7[] = [];
  for (const vertex of node) {
    if (!Array.isArray(vertex) || vertex.length !== 2) return null;
    const [lonE7, latE7] = vertex as [unknown, unknown];
    if (typeof lonE7 !== "number" || typeof latE7 !== "number") return null;
    if (!Number.isInteger(lonE7) || !Number.isInteger(latE7)) return null;
    if (latE7 < -900_000_000 || latE7 > 900_000_000) return null;
    if (lonE7 < -1_800_000_000 || lonE7 > 1_800_000_000) return null;
    points.push({ latE7, lonE7 });
  }
  const first = points[0] as PointE7;
  const last = points[points.length - 1] as PointE7;
  const closed =
    first.latE7 === last.latE7 && first.lonE7 === last.lonE7
      ? points
      : // An open ring is closed here, once, so every reader can assume it is closed.
        [...points, first];
  if (closed.length < 4) return null;
  if (signedAreaE7(closed) === 0) return null;
  return closed;
}

/**
 * Twice the ring's signed area, in E7² units (shoelace).
 *
 * Only its being zero or not is interesting here: a ring whose vertices are collinear — three points on a line,
 * or four copies of the same point — has no interior, so it can contain no rider, and every question about it has
 * no true answer. Refusing such a ring at the point it is read is the only way that stays true at every caller.
 */
function signedAreaE7(ring: ZoneRing): number {
  let sum = 0;
  for (let i = 1; i < ring.length; i += 1) {
    const a = ring[i - 1] as PointE7;
    const b = ring[i] as PointE7;
    sum += a.lonE7 * b.latE7 - b.lonE7 * a.latE7;
  }
  return sum;
}

/** A point in the ring's local plane: metres east and north of the ring's first vertex. */
function project(origin: PointE7, point: PointE7): { readonly x: number; readonly y: number } {
  const radians = Math.PI / 180;
  const lat0 = origin.latE7 / 1e7;
  const dLon = (point.lonE7 - origin.lonE7) / 1e7;
  const dLat = (point.latE7 - origin.latE7) / 1e7;
  return {
    x: dLon * radians * EARTH_RADIUS_M * Math.cos(lat0 * radians),
    y: dLat * radians * EARTH_RADIUS_M,
  };
}

/** Squared distance from a point to a segment, in the projected plane. */
function squaredDistanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

/**
 * Even-odd ray casting in the projected plane.
 *
 * `>=` on the upward comparison and a strict `<` on the downward one is what makes a point exactly on a vertex or
 * on a horizontal edge count once rather than twice; the degenerate cases are covered by the tests, because this
 * is the kind of predicate that is right for every point except the ones users stand on.
 */
function insideRing(ring: ZoneRing, origin: PointE7, point: PointE7): boolean {
  const { x: px, y: py } = project(origin, point);
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = project(origin, ring[i] as PointE7);
    const b = project(origin, ring[j] as PointE7);
    if (a.y > py !== b.y > py) {
      const crossingX = a.x + ((py - a.y) / (b.y - a.y)) * (b.x - a.x);
      if (px < crossingX) inside = !inside;
    }
  }
  return inside;
}

/** Whether a point is inside a zone, boundary included. */
export function insideZone(ring: ZoneRing, point: PointE7): boolean {
  if (ring.length < 4) return false;
  return insideRing(ring, ring[0] as PointE7, point);
}

/**
 * Filter 7's number: how far outside the zone a point is, zero for a point inside it.
 *
 * Inside-ness is decided first and the boundary counts as inside, because a rider standing on their zone's edge is
 * available, not 0 m away from being available. Outside, the distance is to the nearest point of the ring — a
 * planar segment distance in the ring's local frame, then rounded to whole metres. The result is monotone in the
 * projection: it never claims a rider is further out than they are, which matters because the fallback's 3 000 m
 * allowance is the last thing standing between a slow order and a refund.
 *
 * A ring with fewer than four vertices (after closure) has no interior and throws: a shape that cannot contain a
 * rider cannot answer this question, and a `0` here would silently make every rider eligible.
 */
export function distanceOutsideZoneM(ring: ZoneRing, point: PointE7): number {
  if (ring.length < 4 || signedAreaE7(ring) === 0) {
    throw new RangeError("a zone ring needs an interior: three distinct vertices and a closing vertex");
  }
  const origin = ring[0] as PointE7;
  if (insideRing(ring, origin, point)) return 0;
  const { x: px, y: py } = project(origin, point);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < ring.length; i += 1) {
    const a = project(origin, ring[i - 1] as PointE7);
    const b = project(origin, ring[i] as PointE7);
    const squared = squaredDistanceToSegment(px, py, a.x, a.y, b.x, b.y);
    if (squared < best) best = squared;
  }
  // Cross-check against the great-circle distance to the nearest vertex for long edges: the planar frame is exact
  // enough at zone scale, but a vertex is a point and needs no projection at all.
  let nearestVertex = Number.POSITIVE_INFINITY;
  for (const vertex of ring) {
    const metres = haversineMeters(point, vertex);
    if (metres < nearestVertex) nearestVertex = metres;
  }
  return Math.min(Math.round(Math.sqrt(best)), Math.round(nearestVertex));
}

/**
 * Whether a ring is small enough for the planar frame to be honest.
 *
 * The projection's error grows with the ring's extent; a zone is a few kilometres across by design. This is a
 * guard for the writer, not a runtime check on every dispatch: a 200 km "zone" means the polygon was drawn wrong,
 * and saying so once when it is stored beats a distance that is subtly off on every order.
 */
export function ringExtentM(ring: ZoneRing): number {
  const origin = ring[0] as PointE7;
  let extent = 0;
  for (const vertex of ring) {
    const metres = haversineMeters(origin, vertex);
    if (metres > extent) extent = metres;
  }
  return Math.round(extent);
}

/** How wide a ring may be before the planar frame stops being trustworthy. */
export const MAX_PLANAR_RING_M = 50_000;
