/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { fail, ok, type Result } from "../lib/result.ts";

/**
 * The typed client for `undal-brain`, which answers one question: what does this order
 * cost and who should get it.
 *
 * The Brain is read-only and stateless, so a failure is always recoverable by falling
 * back to the deterministic pricing path the fare engine mirrors in TypeScript. That is
 * why this client returns a Result with `SERVICE_DEGRADED` rather than throwing: the
 * caller is expected to price the order without it, and the order still goes out.
 */

/** The request the Brain accepts. */
export interface FareRequest {
  readonly zoneId: string;
  readonly vendorId: string;
  readonly distanceMeters: number;
  readonly vehicle: "MOTO" | "BICYCLE" | "CAR";
  readonly subtotalPaisa: number;
  readonly itemsCount: number;
  readonly atIso: string;
  readonly surgeContext?: { readonly busyLevel: number; readonly weather: string };
}

/** The answer, in integer paisa and basis points, exactly as the Brain emits it. */
export interface FareResponse {
  readonly deliveryFeePaisa: number;
  readonly rideCorePaisa: number;
  readonly surgeBps: number;
  readonly riderPayoutPaisa: number;
  readonly source: "BRAIN" | "FALLBACK";
  readonly explanation: readonly string[];
}

/** The Brain's budget, from `09`: four hundred milliseconds or the fallback wins. */
export const BRAIN_BUDGET_MS = 400;

/** What the core Worker needs from the Brain. */
export interface BrainClient {
  quote(request: FareRequest): Promise<Result<FareResponse>>;
}

/**
 * Build the client.
 *
 * `AbortSignal.timeout` rather than a manual timer because the timeout must include the
 * body read, and a response that arrives just as the signal fires should be treated as
 * absent — a fee computed from a partially-read body is worse than the fallback.
 */
export function createBrainClient(baseUrl: string, token: string): BrainClient {
  return {
    async quote(request) {
      try {
        const response = await fetch(`${baseUrl}/v1/fare/quote`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(BRAIN_BUDGET_MS),
        });
        if (!response.ok) return fail("SERVICE_DEGRADED", { details: { status: response.status } });
        const body = (await response.json()) as { data?: FareResponse };
        if (body.data === undefined) return fail("SERVICE_DEGRADED", { details: { reason: "missing data" } });
        return ok(body.data);
      } catch (error) {
        return fail("DEPENDENCY_TIMEOUT", { details: { error: String(error) } });
      }
    },
  };
}
