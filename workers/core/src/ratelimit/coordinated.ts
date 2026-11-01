/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { KVNamespace } from "@cloudflare/workers-types";

import { charge, type Charge } from "./kv.ts";
import { limitsFor, type ActorClass, type RouteGroup } from "./limits.ts";

/**
 * All the limits that apply to one request, applied together.
 *
 * The point of this module is that it returns every refusal, not the first one: an
 * anonymous login that exceeds the per-IP bucket *and* the per-phone bucket should
 * back off for the phone's window, which is the longer of the two. Returning after the
 * first failure would let an attacker with many IPs keep hammering one phone number.
 */

/** What the caller must supply for each kind of bucket key. */
export interface RateIdentity {
  readonly actorId?: string;
  readonly ip?: string;
  readonly phone?: string;
  readonly sessionId?: string;
}

/** The combined verdict: allowed, or refused with the longest wait. */
export interface RateVerdict {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
  /** The narrowest bucket that was still open, for the `X-RateLimit-Remaining` header. */
  readonly remaining: number;
}

/**
 * Charge every applicable bucket and take the strictest answer.
 *
 * A missing identity for a bucket that needs one is treated as a refusal of that
 * bucket: the anonymous phone bucket exists so that a number cannot be hammered, and
 * skipping it because the handler did not pass the phone would remove exactly the
 * protection it provides.
 */
export async function enforce(
  kv: KVNamespace,
  group: RouteGroup,
  actor: ActorClass,
  identity: RateIdentity,
  nowMs: number = Date.now(),
): Promise<RateVerdict> {
  const limits = limitsFor(group, actor);
  if (limits.length === 0) return { allowed: true, retryAfterSeconds: 0, remaining: Number.POSITIVE_INFINITY };

  const verdicts: Charge[] = [];
  for (const limit of limits) {
    const identifier =
      limit.keyedBy === "ACTOR"
        ? identity.actorId
        : limit.keyedBy === "IP"
          ? identity.ip
          : limit.keyedBy === "PHONE"
            ? identity.phone
            : identity.sessionId;
    if (identifier === undefined || identifier === "") {
      verdicts.push({ allowed: false, remaining: 0, retryAfterSeconds: limit.windowSeconds });
      continue;
    }
    verdicts.push(await charge(kv, limit, identifier, nowMs));
  }

  const refused = verdicts.filter((verdict) => !verdict.allowed);
  if (refused.length > 0) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(...refused.map((verdict) => verdict.retryAfterSeconds)),
      remaining: 0,
    };
  }
  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: Math.min(...verdicts.map((verdict) => verdict.remaining)),
  };
}
