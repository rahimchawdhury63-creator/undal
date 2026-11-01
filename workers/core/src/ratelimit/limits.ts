/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Every rate limit in the platform, as data.
 *
 * The numbers come from `08 §12`, which tabulates ten route groups against five actor
 * classes. Counted cell by cell the table carries 27 limits, not the 38 its surrounding
 * prose implies — the prose counts the auth pair and the SSE caps twice (D49). The 27
 * that exist are implemented here; a limit that is not in this table does not exist,
 * which is what makes "no route is unthrottled" a checkable statement.
 */

/** Who is being limited. Anonymous requests are limited by IP and phone, not by user. */
export type ActorClass = "ANONYMOUS" | "CUSTOMER" | "PARTNER" | "RIDER" | "ADMIN";

/** The ten groups `08 §12` names. */
export type RouteGroup =
  | "AUTH"
  | "CATALOGUE"
  | "SEARCH"
  | "QUOTE"
  | "ORDER_WRITE"
  | "PRESENCE"
  | "LOCATION_BATCH"
  | "MEDIA"
  | "ADMIN_WRITE"
  | "SSE";

/** One bucket: how many requests, over how long, charged to whom. */
export interface Limit {
  readonly group: RouteGroup;
  readonly actor: ActorClass;
  /** Requests allowed per window. */
  readonly perWindow: number;
  /** Window length in seconds. */
  readonly windowSeconds: number;
  /**
   * How the bucket is keyed. `ACTOR` limits the logged-in user, `IP` and `PHONE` limit
   * the anonymous caller, and `SESSION` counts concurrent connections rather than calls.
   */
  readonly keyedBy: "ACTOR" | "IP" | "PHONE" | "SESSION";
}

const MINUTE = 60;
const FIFTEEN_MINUTES = 900;

/** The table, transcribed. A missing cell is a deliberate absence, not an oversight. */
export const LIMITS: readonly Limit[] = [
  { group: "AUTH", actor: "ANONYMOUS", perWindow: 5, windowSeconds: MINUTE, keyedBy: "IP" },
  { group: "AUTH", actor: "ANONYMOUS", perWindow: 5, windowSeconds: FIFTEEN_MINUTES, keyedBy: "PHONE" },
  { group: "CATALOGUE", actor: "ANONYMOUS", perWindow: 60, windowSeconds: MINUTE, keyedBy: "IP" },
  { group: "CATALOGUE", actor: "CUSTOMER", perWindow: 120, windowSeconds: MINUTE, keyedBy: "ACTOR" },
  { group: "CATALOGUE", actor: "ADMIN", perWindow: 300, windowSeconds: MINUTE, keyedBy: "ACTOR" },
  { group: "SEARCH", actor: "ANONYMOUS", perWindow: 20, windowSeconds: MINUTE, keyedBy: "IP" },
  { group: "SEARCH", actor: "CUSTOMER", perWindow: 40, windowSeconds: MINUTE, keyedBy: "ACTOR" },
  { group: "SEARCH", actor: "ADMIN", perWindow: 120, windowSeconds: MINUTE, keyedBy: "ACTOR" },
  { group: "QUOTE", actor: "ANONYMOUS", perWindow: 10, windowSeconds: MINUTE, keyedBy: "IP" },
  { group: "QUOTE", actor: "CUSTOMER", perWindow: 30, windowSeconds: MINUTE, keyedBy: "ACTOR" },
  { group: "ORDER_WRITE", actor: "CUSTOMER", perWindow: 6, windowSeconds: MINUTE, keyedBy: "ACTOR" },
  { group: "ORDER_WRITE", actor: "PARTNER", perWindow: 60, windowSeconds: MINUTE, keyedBy: "ACTOR" },
  { group: "ORDER_WRITE", actor: "RIDER", perWindow: 60, windowSeconds: MINUTE, keyedBy: "ACTOR" },
  { group: "ORDER_WRITE", actor: "ADMIN", perWindow: 120, windowSeconds: MINUTE, keyedBy: "ACTOR" },
  { group: "PRESENCE", actor: "PARTNER", perWindow: 90, windowSeconds: MINUTE, keyedBy: "ACTOR" },
  { group: "PRESENCE", actor: "RIDER", perWindow: 90, windowSeconds: MINUTE, keyedBy: "ACTOR" },
  { group: "LOCATION_BATCH", actor: "RIDER", perWindow: 30, windowSeconds: MINUTE, keyedBy: "ACTOR" },
  { group: "MEDIA", actor: "CUSTOMER", perWindow: 10, windowSeconds: MINUTE, keyedBy: "ACTOR" },
  { group: "MEDIA", actor: "PARTNER", perWindow: 30, windowSeconds: MINUTE, keyedBy: "ACTOR" },
  { group: "MEDIA", actor: "RIDER", perWindow: 20, windowSeconds: MINUTE, keyedBy: "ACTOR" },
  { group: "MEDIA", actor: "ADMIN", perWindow: 60, windowSeconds: MINUTE, keyedBy: "ACTOR" },
  { group: "ADMIN_WRITE", actor: "ADMIN", perWindow: 120, windowSeconds: MINUTE, keyedBy: "ACTOR" },
  { group: "SSE", actor: "ANONYMOUS", perWindow: 2, windowSeconds: MINUTE, keyedBy: "SESSION" },
  { group: "SSE", actor: "CUSTOMER", perWindow: 4, windowSeconds: MINUTE, keyedBy: "SESSION" },
  { group: "SSE", actor: "PARTNER", perWindow: 4, windowSeconds: MINUTE, keyedBy: "SESSION" },
  { group: "SSE", actor: "RIDER", perWindow: 4, windowSeconds: MINUTE, keyedBy: "SESSION" },
  { group: "SSE", actor: "ADMIN", perWindow: 10, windowSeconds: MINUTE, keyedBy: "SESSION" },
];

/** How many limits exist; asserted by the rate-limit tests. */
export const LIMIT_COUNT = 27;

if (LIMITS.length !== LIMIT_COUNT) {
  throw new Error(`rate-limit table holds ${LIMITS.length} rows, expected ${LIMIT_COUNT}`);
}

/**
 * The limits that apply to a request of this group and actor class.
 *
 * More than one can apply — an anonymous login is limited per IP *and* per phone — and
 * returning a list rather than one limit is what makes the second check impossible to
 * forget.
 */
export function limitsFor(group: RouteGroup, actor: ActorClass): Limit[] {
  return LIMITS.filter((limit) => limit.group === group && limit.actor === actor);
}

/**
 * Whether an actor class is subject to any limit in a group.
 *
 * A group with no entry for an actor class is not rate-limited *for that class*, which
 * is a claim worth being able to test: the admin write group has no anonymous bucket
 * because an anonymous caller cannot reach it at all.
 */
export function isLimited(group: RouteGroup, actor: ActorClass): boolean {
  return limitsFor(group, actor).length > 0;
}
