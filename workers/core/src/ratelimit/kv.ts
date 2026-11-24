/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { KVNamespace } from "@cloudflare/workers-types";

import type { Limit } from "./limits.ts";

/**
 * A token bucket in KV, which is the only shared storage this Worker has for counters.
 *
 * The bucket is stored as `{ tokens, updatedAt }` and refilled lazily on read, so no
 * timer is needed and an idle key costs nothing. KV is eventually consistent across
 * PoPs — a limit can be overshot by a request or two in the seconds a write takes to
 * propagate — and that is accepted deliberately: the alternative is a Durable Object
 * per counter, and this Worker's job is to shed load, not to be exact.
 */

/** What is stored under one bucket key. */
interface Bucket {
  readonly tokens: number;
  readonly updatedAtMs: number;
}

/** The outcome of one charge against a bucket. */
export interface Charge {
  readonly allowed: boolean;
  /** Requests left after this one, never negative. */
  readonly remaining: number;
  /** Whole seconds until the bucket has at least one token again. */
  readonly retryAfterSeconds: number;
}

/** KV's minimum TTL, which also caps how long an idle bucket lingers. */
const MIN_TTL_SECONDS = 60;

/** The key for one bucket: group, actor class and the identity being counted. */
export function bucketKey(limit: Limit, identity: string): string {
  return `rl:${limit.group}:${limit.actor}:${limit.keyedBy}:${identity}`;
}

function refill(bucket: Bucket, limit: Limit, nowMs: number): Bucket {
  const windowMs = limit.windowSeconds * 1000;
  const elapsed = Math.max(0, nowMs - bucket.updatedAtMs);
  const refilled = (elapsed / windowMs) * limit.perWindow;
  return {
    tokens: Math.min(limit.perWindow, bucket.tokens + refilled),
    updatedAtMs: nowMs,
  };
}

/**
 * Charge one request against a bucket.
 *
 * Read-modify-write, which is not atomic across PoPs and is documented as such: under a
 * genuine flood two requests can both see the last token. The consequences are bounded
 * — one extra request per concurrent writer — while the cost of exactness would be a
 * Durable Object round trip on every API call.
 */
export async function charge(kv: KVNamespace, limit: Limit, identity: string, nowMs: number = Date.now()): Promise<Charge> {
  const key = bucketKey(limit, identity);
  const stored = await kv.get<Bucket>(key, "json");
  const bucket = stored === null ? { tokens: limit.perWindow, updatedAtMs: nowMs } : refill(stored, limit, nowMs);
  const tokens = bucket.tokens - 1;
  const allowed = tokens >= 0;

  const ttl = Math.max(MIN_TTL_SECONDS, limit.windowSeconds * 2);
  await kv.put(key, JSON.stringify({ tokens: Math.max(0, tokens), updatedAtMs: bucket.updatedAtMs }), {
    expirationTtl: ttl,
  });

  const deficit = allowed ? 0 : 1 - tokens;
  const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil((deficit / limit.perWindow) * limit.windowSeconds));
  return { allowed, remaining: Math.max(0, Math.floor(tokens)), retryAfterSeconds };
}
