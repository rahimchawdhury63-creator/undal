/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { enforce } from "../ratelimit/coordinated.ts";
import type { ActorClass, RouteGroup } from "../ratelimit/limits.ts";
import { fail, ok, type Result } from "../lib/result.ts";

import type { Ctx } from "./context.ts";

/**
 * Apply the rate-limit table to a request.
 *
 * The actor class comes from the authenticated principal, and an unauthenticated request
 * is always `ANONYMOUS` — a caller cannot claim to be a customer to get the larger
 * bucket, because the class is derived from a verified token and nothing else.
 */
export interface RateHeaders {
  readonly retryAfterSeconds: number;
  readonly remaining: number;
}

/** The actor class of this request. */
export function actorClass(ctx: Ctx): ActorClass {
  if (ctx.principal === null) return "ANONYMOUS";
  switch (ctx.principal.actorType) {
    case "ADMIN":
      return "ADMIN";
    case "RIDER":
      return "RIDER";
    case "VENDOR_OWNER":
      return "PARTNER";
    default:
      return "CUSTOMER";
  }
}

/**
 * Charge the buckets for this group and return whether to proceed.
 *
 * The phone number is only known after the body is parsed, so auth routes call
 * `enforce` again with it; here the per-IP bucket is charged, which is the one that
 * protects the endpoint from a flood of made-up numbers.
 */
export async function applyRateLimit(ctx: Ctx, group: RouteGroup, phone?: string): Promise<Result<RateHeaders>> {
  const identity: { actorId?: string; ip?: string; phone?: string; sessionId?: string } = {
    ip: ctx.ip,
    ...(ctx.principal === null ? {} : { actorId: ctx.principal.userId, sessionId: ctx.principal.sessionId }),
    ...(phone === undefined ? {} : { phone }),
  };
  const verdict = await enforce(ctx.env.RATE_LIMIT, group, actorClass(ctx), identity, Date.now());
  if (!verdict.allowed) {
    return fail("RATE_LIMITED", { details: { retryAfterSeconds: verdict.retryAfterSeconds } });
  }
  return ok({ retryAfterSeconds: 0, remaining: verdict.remaining });
}
