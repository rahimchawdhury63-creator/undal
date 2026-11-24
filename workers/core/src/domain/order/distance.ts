/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { haversineMeters, type PointE7 } from "@undal/contracts";

/**
 * How far the food travels, and how honestly we know it.
 *
 * A routed distance comes from OSRM, which lives behind the dispatch worker; until that binding is in
 * place the platform measures the straight line and says so. The provenance is part of the answer
 * rather than a comment, because a delivery fee is priced on this number and a customer is entitled
 * to see whether ৳62 bought 3.8 km of road or 2.9 km of map (`D67`).
 *
 * This is deliberately *not* in `pricing/`: rounding metres is geography, not money, and keeping the
 * two apart is what lets the money rule refuse every float in the pricing path without an exception.
 */

/** Where a distance came from. `ESTIMATED` is a straight line; `OSRM` is a road. */
export type DistanceSource = "OSRM" | "ESTIMATED";

/** The average speed an ETA is estimated at: 18 km/h, Sylhet traffic, motorbike. */
export const ESTIMATED_SPEED_MPS = 5;

/** A distance and where it came from. */
export interface RouteEstimate {
  readonly distanceM: number;
  readonly durationS: number;
  readonly source: DistanceSource;
}

/**
 * A point as the client sends it (floating degrees) and as the platform stores it (E7 integers).
 *
 * Rounding to E7 is a coordinate conversion, not an arithmetic one: 24.8981 becomes 248 981 000, and
 * every comparison downstream is an integer comparison (`06 §2`).
 */
export function parsePointE7(node: unknown): PointE7 | null {
  if (typeof node !== "object" || node === null) return null;
  const { lat, lon } = node as { lat?: unknown; lon?: unknown };
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { latE7: Math.round(lat * 1e7), lonE7: Math.round(lon * 1e7) };
}

/** The straight-line estimate between two points, in whole metres and whole seconds. */
export function estimateRoute(from: PointE7, to: PointE7): RouteEstimate {
  const distanceM = Math.round(haversineMeters(from, to));
  return { distanceM, durationS: Math.round(distanceM / ESTIMATED_SPEED_MPS), source: "ESTIMATED" };
}
