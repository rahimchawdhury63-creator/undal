/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The claim decision, as a pure function over dispatch state.
 *
 * Both coordinator backends run this exact function; what differs is only *how* they make the
 * read-and-write atomic — one Durable Object that is single-threaded, one conditional `UPDATE` that
 * the database serialises. Writing the decision once and testing it in isolation is what makes the
 * 50-way claim test meaningful on both: a winner is decided by these five rules, not by two copies of
 * them that are usually the same.
 *
 * The order of the rules is the order of the questions a rider's app can ask: is there a dispatch at
 * all, is it still open, has someone won, was I asked, is the wave still live. Each refusal maps to a
 * registry error code so the route layer never invents a status.
 */

import type { ErrorCode } from "@undal/contracts";
import type { DispatchState, DispatchWave } from "./coordinator.ts";

/** The five claim verdicts. `OK` is the only one that assigns an order. */
export type ClaimCode =
  | "OK"
  | "OFFER_CLAIMED"
  | "OFFER_EXPIRED"
  | "OFFER_NOT_TARGETED"
  | "OFFER_WAVE_CLOSED";

/** What a claim attempt produced. */
export interface ClaimResult {
  readonly ok: boolean;
  readonly code: ClaimCode;
  readonly orderId: string;
  readonly riderId: string;
  /** The rider who holds the order, whether that is the caller or somebody else. */
  readonly claimedBy: string | null;
  /** The wave the winning offer belonged to, or `null` when nobody has won. */
  readonly wave: number | null;
  readonly atMs: number;
}

/** The error code and HTTP story for a refusal, so routes stay declarative. */
export function errorForClaim(code: Exclude<ClaimCode, "OK">): ErrorCode {
  switch (code) {
    case "OFFER_CLAIMED":
      return "OFFER_CLAIMED";
    case "OFFER_EXPIRED":
      return "OFFER_EXPIRED";
    case "OFFER_NOT_TARGETED":
      return "OFFER_NOT_TARGETED";
    case "OFFER_WAVE_CLOSED":
      return "OFFER_WAVE_CLOSED";
  }
}

/** The current wave of a dispatch, or `null` before the first one has been fired. */
export function currentWaveOf(state: DispatchState): DispatchWave | null {
  return state.waves.find((wave) => wave.wave === state.currentWave) ?? null;
}

/** Whether a rider appears anywhere in the plan. A rider who is not in any wave was never asked. */
export function wasAsked(state: DispatchState, riderId: string): boolean {
  return state.waves.some((wave) => wave.riderIds.includes(riderId));
}

/**
 * Decide a claim.
 *
 * `state` is `null` when the dispatch has been closed and swept — an order that no longer has a
 * cascade. Everything else is answered from the stored state and the instant the caller asks, never
 * from the caller's idea of the time.
 */
export function decideClaim(state: DispatchState | null, riderId: string, atMs: number): ClaimResult {
  if (state === null) {
    return {
      ok: false,
      code: "OFFER_WAVE_CLOSED",
      orderId: "",
      riderId,
      claimedBy: null,
      wave: null,
      atMs,
    };
  }
  const base = { orderId: state.orderId, riderId, atMs } as const;

  if (state.claimedBy !== null) {
    const mine = state.claimedBy === riderId;
    // A repeat claim from the winner is a success, not a conflict: the app retries after a dropped
    // response, and telling the rider they lost their own order would be a bug they remember.
    return {
      ...base,
      ok: mine,
      code: mine ? "OK" : "OFFER_CLAIMED",
      claimedBy: state.claimedBy,
      wave: state.waves.find((wave) => wave.riderIds.includes(state.claimedBy ?? ""))?.wave ?? null,
    };
  }
  if (state.phase !== "OPEN") {
    return { ...base, ok: false, code: "OFFER_WAVE_CLOSED", claimedBy: null, wave: null };
  }
  if (state.rejected.includes(riderId)) {
    return { ...base, ok: false, code: "OFFER_WAVE_CLOSED", claimedBy: null, wave: null };
  }
  if (!wasAsked(state, riderId)) {
    return { ...base, ok: false, code: "OFFER_NOT_TARGETED", claimedBy: null, wave: null };
  }
  const wave = currentWaveOf(state);
  if (wave === null || !wave.riderIds.includes(riderId)) {
    return { ...base, ok: false, code: "OFFER_WAVE_CLOSED", claimedBy: null, wave: wave?.wave ?? null };
  }
  if (atMs > wave.expiresAtMs) {
    return { ...base, ok: false, code: "OFFER_EXPIRED", claimedBy: null, wave: wave.wave };
  }
  return { ...base, ok: true, code: "OK", claimedBy: riderId, wave: wave.wave };
}

/**
 * Validate a wave plan.
 *
 * Disjointness and ascending numbers are checked when the plan is stored rather than when it is used:
 * a plan that rings one rider twice is a bug in the sizing, and finding it three waves in is finding
 * it too late.
 */
export function assertPlanIsSound(waves: DispatchState["waves"]): void {
  if (waves.length === 0) throw new RangeError("a dispatch needs at least one wave");
  let previous = 0;
  const seen = new Set<string>();
  for (const wave of waves) {
    if (wave.wave !== previous + 1) {
      throw new RangeError(`waves must be numbered from 1 without gaps, got ${wave.wave} after ${previous}`);
    }
    if (wave.riderIds.length === 0) throw new RangeError(`wave ${wave.wave} has no riders`);
    if (wave.expiresAtMs <= wave.startsAtMs) {
      throw new RangeError(`wave ${wave.wave} expires before it starts`);
    }
    for (const riderId of wave.riderIds) {
      if (seen.has(riderId)) throw new RangeError(`${riderId} appears in two waves`);
      seen.add(riderId);
    }
    previous = wave.wave;
  }
}
