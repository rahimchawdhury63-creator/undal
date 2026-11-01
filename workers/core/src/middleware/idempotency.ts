/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { sha256Hex } from "../lib/ids.ts";
import { fail, ok, type Result } from "../lib/result.ts";

import type { Ctx } from "./context.ts";

/**
 * Idempotency for the routes where a retry must not repeat the operation, exactly as
 * `08 §13` describes it: a key reserved with a 60-second lease, the response replayed for
 * 24 hours, a different body under the same key refused, and a request that arrives while
 * the original is still running told to come back.
 *
 * The keys live in KV rather than TiDB because KV expires them for free. A table would
 * need a nightly delete and would put an extra write on the critical path of the one
 * route where latency is most visible: placing an order.
 */

/** The header the Android clients send, generated once per user intent. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

/** How long the reservation holds while the original request runs. */
export const LEASE_SECONDS = 60;
/** How long a completed response is replayed. */
export const REPLAY_SECONDS = 86_400;

/** A stored outcome: the reservation in progress, or the response to replay. */
interface Record {
  readonly state: "IN_FLIGHT" | "DONE";
  readonly bodyHash: string;
  readonly status?: number;
  readonly body?: string;
}

/** What the route should do next. */
export type IdempotencyDecision =
  | { readonly kind: "PROCEED"; readonly key: string }
  | { readonly kind: "REPLAY"; readonly response: Response };

function recordKey(ctx: Ctx, route: string, key: string): string {
  const userId = ctx.principal?.userId ?? ctx.ip;
  return `idem:${userId}:${route}:${key}`;
}

/**
 * Reserve the key, replay a stored answer, or refuse.
 *
 * The body hash is part of the comparison, so a client that reuses a key for a genuinely
 * different order gets `409 IDEMPOTENCY_CONFLICT` rather than the previous order's
 * receipt — the difference between a retry and a lost order.
 */
export async function begin(ctx: Ctx, route: string, bodyHash: string): Promise<Result<IdempotencyDecision>> {
  const header = ctx.request.headers.get(IDEMPOTENCY_HEADER);
  if (header === null || header === "") return ok({ kind: "PROCEED", key: "" });
  if (header.length > 64) return fail("VALIDATION_ID_MALFORMED", { field: IDEMPOTENCY_HEADER });

  const key = recordKey(ctx, route, header);
  const existing = await ctx.env.RATE_LIMIT.get<Record>(key, "json");
  if (existing === null) {
    const reservation: Record = { state: "IN_FLIGHT", bodyHash };
    await ctx.env.RATE_LIMIT.put(key, JSON.stringify(reservation), { expirationTtl: LEASE_SECONDS });
    return ok({ kind: "PROCEED", key });
  }
  if (existing.bodyHash !== bodyHash) return fail("IDEMPOTENCY_CONFLICT");
  if (existing.state === "IN_FLIGHT") {
    // `08 §13.6` describes this as a conflict with `retryable: true`; the retry hint
    // travels in `details` because the envelope's `retryable` flag marks a code as
    // always-retryable, and a key stuck in flight is retryable only until the lease ends.
    return fail("IDEMPOTENCY_CONFLICT", { details: { inFlight: true, retryAfterSeconds: 1 } });
  }
  return ok({
    kind: "REPLAY",
    response: new Response(existing.body ?? "", {
      status: existing.status ?? 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "X-Undal-Idempotent-Replay": "true",
        "X-Undal-Request-Id": ctx.requestId,
      },
    }),
  });
}

/** Store the finished response so a retry replays it byte for byte. */
export async function finish(ctx: Ctx, key: string, response: Response, bodyHash: string): Promise<Response> {
  if (key === "") return response;
  const body = await response.clone().text();
  const record: Record = { state: "DONE", bodyHash, status: response.status, body };
  await ctx.env.RATE_LIMIT.put(key, JSON.stringify(record), { expirationTtl: REPLAY_SECONDS });
  return response;
}

/** The hash a caller compares: SHA-256 of the canonical body text. */
export async function bodyHashOf(body: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(body ?? null));
}
