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
  broadcast(input: { zoneId: string; orderId: string; event: string; payload: unknown }): Promise<Result<true>>;
  presenceOf(riderId: string): Promise<Result<{ online: boolean; lastSeenAt: string | null }>>;
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
      if (!response.ok) return fail("SERVICE_DEGRADED", { details: { status: response.status, path } });
      return ok((await response.json()) as unknown);
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
    async presenceOf(riderId) {
      const result = await call("/internal/presence", { riderId });
      if (!result.ok) return result;
      return ok(result.value as { online: boolean; lastSeenAt: string | null });
    },
  };
}
