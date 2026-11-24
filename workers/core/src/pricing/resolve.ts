/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { BrainClient, FareRequest } from "../bindings/brain.ts";

import { priceOrder, type FareBreakdown, type FareInput, type WeatherCondition } from "./fallback.ts";

/**
 * Which of the two pricing engines priced this order, and what to tell ops about it.
 *
 * The Brain and `fallback.ts` are supposed to be the same function written twice. This module is
 * where that claim is tested at runtime rather than only in CI: the deterministic engine always
 * computes a full breakdown, the Brain is asked for its own answer, and the two are compared. If
 * they agree, the price is stamped `BRAIN` — provenance for the invoice. If the Brain is late,
 * down, malformed, or quietly disagrees, the deterministic number stands and the reason is returned
 * so it can be counted. An order is never held for a price that cannot be explained.
 *
 * Note what does *not* happen here: the Brain's numbers are never used directly. They are a second
 * opinion. A Brain that returns a surge of 19 000 bps on a quiet street cannot move a price, because
 * the price the customer sees has to be reproducible from the order row alone.
 */

/** The lookup facts a Brain request needs that a fare does not. */
export interface FareContext {
  readonly zoneId: string;
  readonly vendorId: string;
  readonly atIso: string;
  readonly itemsCount: number;
  readonly busyLevel?: number | undefined;
}

/** Why the deterministic engine priced the order instead of the Brain. */
export type DegradedReason =
  | "NO_CLIENT"
  | "BRAIN_DECLINED"
  | "BRAIN_UNAVAILABLE"
  | "BRAIN_MALFORMED"
  | "BRAIN_DISAGREES";

/** A field the two engines priced differently, kept whole so the log names both numbers. */
export interface Disagreement {
  readonly field: "deliveryFeePaisa" | "rideCorePaisa" | "riderPayoutPaisa" | "surgeBps";
  readonly brain: number;
  readonly deterministic: number;
}

/** The price, its provenance, and — when there is one — the reason it is not the Brain's. */
export interface ResolvedFare {
  readonly source: "BRAIN" | "FALLBACK";
  readonly breakdown: FareBreakdown;
  readonly degraded: DegradedReason | null;
  readonly disagreements: readonly Disagreement[];
  /** The Brain's explanation lines, present only when its answer was accepted. */
  readonly explanation: readonly string[];
}

/** Translate a fare input into the wire request the Brain documents. */
export function toFareRequest(input: FareInput, context: FareContext): FareRequest {
  return {
    zoneId: context.zoneId,
    vendorId: context.vendorId,
    distanceMeters: input.routedDistanceM,
    vehicle: input.rates.vehicle === "MOTORBIKE" ? "MOTO" : "BICYCLE",
    subtotalPaisa: input.itemSubtotalPaisa,
    itemsCount: context.itemsCount,
    atIso: context.atIso,
    ...(context.busyLevel === undefined
      ? {}
      : { surgeContext: { busyLevel: context.busyLevel, weather: input.weather as WeatherCondition } }),
  };
}

/** The four numbers both engines publish; they are the comparison, and the whole comparison. */
function compare(breakdown: FareBreakdown, brain: {
  deliveryFeePaisa: number;
  rideCorePaisa: number;
  riderPayoutPaisa: number;
  surgeBps: number;
}): Disagreement[] {
  const pairs: readonly (readonly [Disagreement["field"], number, number])[] = [
    ["deliveryFeePaisa", breakdown.deliveryFeePaisa, brain.deliveryFeePaisa],
    ["rideCorePaisa", breakdown.core.totalPaisa, brain.rideCorePaisa],
    ["riderPayoutPaisa", breakdown.riderPayoutPaisa, brain.riderPayoutPaisa],
    ["surgeBps", breakdown.surgeBps, brain.surgeBps],
  ];
  return pairs
    .filter(([, deterministic, fromBrain]) => deterministic !== fromBrain)
    .map(([field, deterministic, fromBrain]) => ({ field, brain: fromBrain, deterministic }));
}

/**
 * Ask the Brain, fall back when it cannot be believed.
 *
 * Input errors are not caught: a nonsense fare input is a bug in the caller and must be loud. Only
 * the Brain's failures are absorbed, because a dependency's bad day is not the customer's problem.
 */
export async function resolveFare(brain: BrainClient | null, input: FareInput, context: FareContext): Promise<ResolvedFare> {
  const breakdown = priceOrder(input);
  if (brain === null) return { source: "FALLBACK", breakdown, degraded: "NO_CLIENT", disagreements: [], explanation: [] };

  const answer = await brain.quote(toFareRequest(input, context));
  // A timeout and a 500 are the same fact to a customer: the Brain did not answer. Which one it was
  // belongs in the log line, not in the pricing decision.
  if (!answer.ok) return { source: "FALLBACK", breakdown, degraded: "BRAIN_UNAVAILABLE", disagreements: [], explanation: [] };

  const quote = answer.value;
  if (quote.source !== "BRAIN" || ![quote.deliveryFeePaisa, quote.rideCorePaisa, quote.riderPayoutPaisa, quote.surgeBps].every((value) => Number.isInteger(value) && value >= 0))
    return { source: "FALLBACK", breakdown, degraded: "BRAIN_MALFORMED", disagreements: [], explanation: [] };

  const disagreements = compare(breakdown, quote);
  if (disagreements.length > 0)
    return { source: "FALLBACK", breakdown, degraded: "BRAIN_DISAGREES", disagreements, explanation: [] };

  return { source: "BRAIN", breakdown, degraded: null, disagreements: [], explanation: quote.explanation };
}
