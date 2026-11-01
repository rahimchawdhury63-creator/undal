/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/** A coordinate in the storage form: degrees x 10^7, as an integer. */
export interface PointE7 {
  readonly latE7: number;
  readonly lonE7: number;
}

/** An integer bounding box, the shape every polygon stores beside its ring. */
export interface BboxE7 {
  readonly minLatE7: number;
  readonly minLonE7: number;
  readonly maxLatE7: number;
  readonly maxLonE7: number;
}

const EARTH_RADIUS_M = 6_371_008.8;

/**
 * Great-circle distance in whole metres between two storage coordinates.
 *
 * Whole metres, not float metres, because the fare engine consumes integers and
 * because a distance that differs in the last float digit between the Worker and
 * the Brain is a fare that differs by a paisa. Rounding happens here, once, at
 * the boundary the money law names.
 */
export function haversineMeters(from: PointE7, to: PointE7): number {
  const lat1 = (from.latE7 / 1e7) * (Math.PI / 180);
  const lat2 = (to.latE7 / 1e7) * (Math.PI / 180);
  const deltaLat = lat2 - lat1;
  const deltaLon = ((to.lonE7 - from.lonE7) / 1e7) * (Math.PI / 180);

  const a =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return Math.round(EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** The integer bounding box of a ring, used to reject a polygon in one comparison. */
export function bboxOf(ring: readonly PointE7[]): BboxE7 {
  if (ring.length < 3) {
    throw new RangeError("a ring needs at least three corners");
  }
  let minLatE7 = ring[0]!.latE7;
  let maxLatE7 = minLatE7;
  let minLonE7 = ring[0]!.lonE7;
  let maxLonE7 = minLonE7;
  for (const point of ring) {
    minLatE7 = Math.min(minLatE7, point.latE7);
    maxLatE7 = Math.max(maxLatE7, point.latE7);
    minLonE7 = Math.min(minLonE7, point.lonE7);
    maxLonE7 = Math.max(maxLonE7, point.lonE7);
  }
  return { minLatE7, minLonE7, maxLatE7, maxLonE7 };
}

/** True when the point lies inside the box, edges included. */
export function inBbox(point: PointE7, box: BboxE7): boolean {
  return (
    point.latE7 >= box.minLatE7 &&
    point.latE7 <= box.maxLatE7 &&
    point.lonE7 >= box.minLonE7 &&
    point.lonE7 <= box.maxLonE7
  );
}

/**
 * Ray casting point-in-polygon on integers.
 *
 * The comparison is done with 64-bit-safe multiplications rather than slopes, so
 * a point that sits exactly on a vertex is decided the same way in the Worker,
 * the Brain and the parity script — three implementations that cannot be allowed
 * to disagree about which zone a delivery address is in, because that answer
 * changes the fare.
 */
export function pointInRing(point: PointE7, ring: readonly PointE7[]): boolean {
  if (ring.length < 3) {
    throw new RangeError("a ring needs at least three corners");
  }

  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const current = ring[index]!;
    const before = ring[previous]!;
    if (isOnSegment(point, before, current)) {
      return true;
    }
    const straddles = current.latE7 > point.latE7 !== before.latE7 > point.latE7;
    if (straddles) {
      // Compare the point against the edge using cross-multiplication: no division,
      // so no rounding decides the answer.
      const cross =
        (before.lonE7 - current.lonE7) * (point.latE7 - current.latE7) -
        (before.latE7 - current.latE7) * (point.lonE7 - current.lonE7);
      if (cross === 0) {
        return true;
      }
      if (before.latE7 > current.latE7 ? cross < 0 : cross > 0) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** True when the point lies exactly on the segment, endpoints included. */
export function isOnSegment(point: PointE7, from: PointE7, to: PointE7): boolean {
  const cross =
    (to.lonE7 - from.lonE7) * (point.latE7 - from.latE7) -
    (to.latE7 - from.latE7) * (point.lonE7 - from.lonE7);
  if (cross !== 0) {
    return false;
  }
  return (
    point.latE7 >= Math.min(from.latE7, to.latE7) &&
    point.latE7 <= Math.max(from.latE7, to.latE7) &&
    point.lonE7 >= Math.min(from.lonE7, to.lonE7) &&
    point.lonE7 <= Math.max(from.lonE7, to.lonE7)
  );
}
