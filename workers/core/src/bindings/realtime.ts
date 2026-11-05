/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { fail, ok, type Result } from "../lib/result.ts";

/**
 * The typed client for `undal-realtime`.
 *
 * A Worker-to-Worker call is a fetch, so the failure modes are the ones a fetch has:
 * a timeout, a 500, a body that is not the envelope. All three become a Result the
 * caller handles by *degrading* — an order still transitions when the SSE broadcast
 * fails — rather than by retrying into the same wall. The convention is fixed here so
 * that every caller in the codebase behaves the same way.
 */

/** What the realtime Worker exposes to the core Worker. */
export interface RealtimeClient {
  /** Fan an order event out to the order's watchers and the zone's admin map. */
  broadcast(input: {
    readonly zoneId: string;
    readonly orderId: string;
    /** The catalogue name (`order.assigned`) or the stored kind (`RIDER_ASSIGNED`). */
    readonly event: string;
    readonly payload: unknown;
    /** The order's log sequence, when the caller has it; the stream ids the frame otherwise. */
    readonly seq?: number;
    /**
     * Who else is watching, by the identity their own stream resolves `self` to (D104).
     *
     * These are **user** ids in hex — the `sub` a token carries — because `vendor:self` resolves to the
     * caller's user id. A broadcast without an audience still reaches the order and the zone; it reaches no
     * vendor's or rider's own channel, and that is the honest limit of what core told it.
     */
    readonly audience?: { readonly vendorUserId?: string; readonly riderUserId?: string };
  }): Promise<Result<true>>;
  /** Whether a rider is currently present in a zone. Presence is per zone, so the zone is required. */
  presenceOf(input: {
    readonly zoneId: string;
    readonly riderId: string;
  }): Promise<Result<{ online: boolean; lastSeenAt: string | null }>>;
}

/** How long a Worker-to-Worker call may take before it is abandoned. */
export const REALTIME_TIMEOUT_MS = 1_500;

/**
 * Build the client.
 *
 * `fetch` failure and a non-2xx both return a failure Result with `SERVICE_DEGRADED`,
 * which the caller logs and continues past. The broadcast is a notification, not a state
 * change, and a customer who does not see the push until the next reconnect is a worse
 * experience than an order that failed to move because the SSE Worker was cold.
 */
export function createRealtimeClient(baseUrl: string, token: string): RealtimeClient {
  const call = async (path: string, body: unknown): Promise<Result<unknown>> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REALTIME_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      // A non-2xx is decided before the body is read: a 502 from the edge has an HTML body, and parsing
      // it would turn a degraded dependency into a timeout that the caller retries into the same wall.
      if (!response.ok) return fail("SERVICE_DEGRADED", { details: { status: response.status, path } });
      // Every response on this platform is the shared envelope (`05 §3.4`), internal calls included.
      // Reading `data` rather than the whole body is what keeps one client honest across Workers.
      const envelope = (await response.json()) as { ok?: boolean; data?: unknown };
      if (envelope.ok !== true) {
        return fail("SERVICE_DEGRADED", { details: { status: response.status, path, reason: "bad_envelope" } });
      }
      return ok(envelope.data);
    } catch (error) {
      return fail("DEPENDENCY_TIMEOUT", { details: { path, error: String(error) } });
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    async broadcast(input) {
      const result = await call("/internal/broadcast", input);
      return result.ok ? ok(true) : result;
    },
    async presenceOf(input) {
      const result = await call("/internal/presence", input);
      if (!result.ok) return result;
      return ok(result.value as { online: boolean; lastSeenAt: string | null });
    },
  };
}
