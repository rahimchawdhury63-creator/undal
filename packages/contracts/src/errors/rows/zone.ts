/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Delivery-zone geometry failures. Zones are integer-bbox polygons drawn in the admin map, and these are the eight ways a polygon can be refused before it can strand an order.
 */
import type { ErrorRow } from "../types.ts";

/**
 * 7 definitions. One row is one code: `[code, status, en, bn, retryable, details]`.
 * The tuple is short on purpose — six fields across 7 codes in an object literal would
 * push this file past the 700-line cap and bury the copy that translators edit.
 */
export const ZONE_ROWS = [
  ["ZONE_SELF_INTERSECTING", 422, "The area outline crosses itself.", "এলাকার সীমানা নিজেকে ছেদ করেছে।", false, "{}"],
  ["ZONE_OVERLAPS", 409, "That area overlaps an existing zone.", "এই এলাকা বিদ্যমান জোনের সাথে মিলে যাচ্ছে।", false, "{ other_zone_id: string }"],
  ["ZONE_HAS_ACTIVE_ORDERS", 409, "This zone still has live orders.", "এই জোনে এখনও চলমান অর্ডার আছে।", false, "{ active_orders: number }"],
  ["ZONE_NOT_FOUND", 404, "That zone does not exist.", "এই জোনটি নেই।", false, "{ zone_id: string }"],
  ["ZONE_POLYGON_TOO_LARGE", 422, "That area covers too much ground.", "এই এলাকা অনেক বড়।", false, "{ max_area_km2: number }"],
  ["ZONE_TOO_FEW_POINTS", 422, "An area outline needs at least three corners.", "এলাকার সীমানায় কমপক্ষে তিনটি কোণা দরকার।", false, "{ min_points: number }"],
  ["ZONE_INACTIVE", 409, "That zone is switched off.", "এই জোনটি বন্ধ আছে।", false, "{ zone_id: string }"],
] as const satisfies readonly ErrorRow[];
