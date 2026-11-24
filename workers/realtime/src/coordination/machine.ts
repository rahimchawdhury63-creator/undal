/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The state transitions, written once so the two backends cannot drift.
 *
 * A coordinator's job is *atomicity*, not policy. Which wave comes next, whether a rejection closes a
 * wave, what a close does to the phase — those are the same answers on a Durable Object and on TiDB,
 * and they live here as pure functions over an immutable state value. Each backend persists the
 * result; neither invents one. A bug in this file is a bug in both backends at once, which is the
 * correct outcome: two copies of a rule diverge, and the divergence is discovered by a rider.
 */

import type { CloseReason, DispatchState, OpenDispatchInput } from "./coordinator.ts";
import { assertPlanIsSound, decideClaim } from "./claim.ts";
import type { ClaimResult } from "./claim.ts";
import { leaseFrom } from "./lease.ts";

/** The key a dispatch lives under, in a Durable Object or in the key-value store. */
export function dispatchKey(orderId: string): string {
  return `dispatch:${orderId}`;
}

/** The key prefix every dispatch shares, for a zone's index or a sweep. */
export const DISPATCH_PREFIX = "dispatch:";

/** The state an empty dispatch starts in: open, no wave fired, nothing claimed. */
export function openState(input: OpenDispatchInput, atMs: number): DispatchState {
  const waves = input.waves.map((wave) => ({
    wave: wave.wave,
    riderIds: [...wave.riderIds],
    startsAtMs: wave.startsAtMs,
    expiresAtMs: wave.expiresAtMs,
  }));
  assertPlanIsSound(waves);
  if (input.excludeRiderId !== undefined && waves.some((wave) => wave.riderIds.includes(input.excludeRiderId ?? ""))) {
    throw new RangeError(`${input.excludeRiderId} is excluded but still appears in a wave`);
  }
  return {
    orderId: input.orderId,
    zoneId: input.zoneId,
    phase: "OPEN",
    waves,
    currentWave: 0,
    claimedBy: null,
    claimedAtMs: null,
    rejected: [],
    closedReason: null,
    openedAtMs: atMs,
    leaseUntilMs: leaseFrom(atMs).untilMs,
    excludedRiderId: input.excludeRiderId ?? null,
  };
}

/**
 * Apply a claim to a state.
 *
 * The refusal cases return the state untouched — a losing claim must not extend a lease, clear a
 * rejection, or otherwise make the loser's request visible in the history.
 */
export function claimState(
  state: DispatchState,
  riderId: string,
  atMs: number,
): { readonly state: DispatchState; readonly result: ClaimResult } {
  const result = decideClaim(state, riderId, atMs);
  if (!result.ok || state.claimedBy === riderId) return { state, result };
  return {
    state: {
      ...state,
      phase: "ASSIGNED",
      claimedBy: riderId,
      claimedAtMs: atMs,
      leaseUntilMs: leaseFrom(atMs).untilMs,
    },
    result,
  };
}

/** Record a rejection. The rider is remembered even if the offer had already expired. */
export function withdrawState(state: DispatchState, riderId: string): DispatchState {
  if (state.rejected.includes(riderId)) return state;
  return { ...state, rejected: [...state.rejected, riderId] };
}

/**
 * Advance to the next wave.
 *
 * Advancing past the last wave is not an error and not a cancellation: it is the fallback ladder's
 * turn, and the phase says so. A closed or assigned dispatch ignores the call entirely.
 */
export function advanceState(state: DispatchState): DispatchState {
  if (state.phase !== "OPEN") return state;
  if (state.currentWave >= state.waves.length) {
    return { ...state, phase: "FALLBACK", closedReason: "FALLBACK" };
  }
  return { ...state, currentWave: state.currentWave + 1 };
}

/** Close a dispatch with a reason, leaving an assigned claim intact. */
export function closeState(state: DispatchState, reason: CloseReason, atMs: number): DispatchState {
  if (reason === "ASSIGNED" && state.claimedBy === null) {
    throw new RangeError("cannot close a dispatch as ASSIGNED without a claim");
  }
  const phase = reason === "ASSIGNED" ? "ASSIGNED" : reason === "FALLBACK" ? "FALLBACK" : "CANCELLED";
  return {
    ...state,
    phase,
    closedReason: reason,
    leaseUntilMs: state.claimedBy === null ? state.leaseUntilMs : leaseFrom(atMs).untilMs,
  };
}

/** The sequence number an appended event receives: one more than the highest stored. */
export function nextSeq(events: readonly { readonly seq: number }[]): number {
  return events.reduce((highest, event) => Math.max(highest, event.seq), 0) + 1;
}
