/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Choosing which riders to ask, and deciding who won (`11 §3`, `§7`).
 *
 * Dispatch is the part of the platform where a wrong answer has a visible cost: an order offered to
 * a rider who cannot carry it wastes twenty-five seconds, and an order offered to nobody expires into
 * a refund. Both failures come from the same place — a candidate list that was filtered by an `if`
 * chain somewhere in a handler — so the filters are data here, numbered, and every refusal names the
 * filter that caused it. The rider app can then say *why* an order did not arrive, which is the
 * difference between a quiet queue and a support ticket.
 *
 * Nothing in this module touches the network or the database. It answers two questions: *may this
 * rider be offered this order?* and, given the ones who may, *who is asked in which wave?*
 */

/** How many waves dispatch will run before the fallback ladder (`11 §7`). */
export const MAX_WAVES = 5;

/** The most riders in one wave, so a small zone does not ring eight phones for one biryani. */
export const MAX_WAVE_SIZE = 8;

/** The probability that nobody in a wave accepts, below which the wave is good enough to send. */
export const WAVE_CONFIDENCE_TARGET = 0.1;

/** When the fallback ladder takes over, in seconds after the order became assignable. */
export const FALLBACK_AT_S = 112;

/** The offer TTL and start time of each wave, exactly as `11 §7.1` prints them. */
export const WAVE_SCHEDULE = [
  { wave: 1, ttlS: 25, startsAtS: 0 },
  { wave: 2, ttlS: 25, startsAtS: 25 },
  { wave: 3, ttlS: 22, startsAtS: 50 },
  { wave: 4, ttlS: 20, startsAtS: 72 },
  { wave: 5, ttlS: 20, startsAtS: 92 },
] as const;

/** How far outside their own zone a rider is still worth asking (`11 §3`, filter 7). */
export const ZONE_EDGE_TOLERANCE_M = 1_500;

/** A rider as dispatch sees them when the order becomes assignable. */
export interface RiderSnapshot {
  readonly riderId: string;
  readonly status: string;
  readonly shiftState: "ONLINE" | "ON_ORDER" | "OFFLINE" | "ON_BREAK";
  readonly selfieVerified: boolean;
  readonly positionAgeS: number;
  readonly positionStaleAfterS: number;
  readonly cashLocked: boolean;
  readonly suspended: boolean;
  readonly zoneId: string;
  /** Distance to the rider's own zone boundary, zero when inside it. */
  readonly distanceToZoneEdgeM: number;
  readonly vehicleMaxRadiusM: number;
  readonly routedDistanceToVendorM: number;
  readonly currentLoad: number;
  readonly maxConcurrent: number;
  readonly cashInHandPaisa: number;
  readonly cashLimitPaisa: number;
  /** The waves this rider was asked in and said no to. This order is never re-offered to them. */
  readonly rejectedWaves: readonly number[];
  /** Whether the rider is inside a rejection cooldown for this vendor (`11 §9`). */
  readonly vendorCooldown: boolean;
  readonly notificationsAllowed: boolean;
}

/** The order facts the filters read. */
export interface AssignmentTarget {
  readonly zoneId: string;
  readonly vendorId: string;
  readonly totalPaisa: number;
}

/** The result of running the filters: either a yes, or the number and name of the filter that said no. */
export interface Eligibility {
  readonly eligible: boolean;
  /** The failing filter's number, `null` when the rider passed. */
  readonly filter: number | null;
  /** The failing filter's name, for the app's explanation. */
  readonly reason: string | null;
}

/** The fourteen filters of `11 §3`, in the order they must be applied. */
export const FILTERS: readonly { readonly number: number; readonly name: string; readonly passes: (rider: RiderSnapshot, target: AssignmentTarget) => boolean }[] = [
  { number: 1, name: "KYC_APPROVED", passes: (rider) => rider.status === "APPROVED" },
  { number: 2, name: "ON_SHIFT", passes: (rider) => rider.shiftState === "ONLINE" || rider.shiftState === "ON_ORDER" },
  { number: 3, name: "SELFIE_VERIFIED", passes: (rider) => rider.selfieVerified },
  { number: 4, name: "POSITION_FRESH", passes: (rider) => rider.positionAgeS <= rider.positionStaleAfterS },
  { number: 5, name: "NOT_CASH_LOCKED", passes: (rider) => !rider.cashLocked },
  { number: 6, name: "NOT_SUSPENDED", passes: (rider) => !rider.suspended },
  {
    number: 7,
    name: "ZONE_MATCH_OR_NEAR",
    passes: (rider, target) => rider.zoneId === target.zoneId || rider.distanceToZoneEdgeM <= ZONE_EDGE_TOLERANCE_M,
  },
  { number: 8, name: "WITHIN_VEHICLE_RADIUS", passes: (rider) => rider.routedDistanceToVendorM <= rider.vehicleMaxRadiusM },
  { number: 9, name: "UNDER_LOAD_LIMIT", passes: (rider) => rider.currentLoad < rider.maxConcurrent },
  {
    number: 10,
    name: "BATCH_FEASIBLE",
    // A rider already carrying an order may only be asked if the platform can prove the second one
    // still arrives hot (`12 §5`). Until that proof is supplied the answer is no — a cold meal is
    // worse than a second wave.
    passes: (rider) => rider.currentLoad === 0,
  },
  {
    number: 11,
    name: "CASH_WITHIN_LIMIT",
    passes: (rider, target) => rider.cashInHandPaisa + target.totalPaisa <= rider.cashLimitPaisa,
  },
  { number: 12, name: "NOT_ALREADY_REJECTED", passes: (rider) => rider.rejectedWaves.length === 0 },
  { number: 13, name: "NOT_IN_REJECTION_COOLDOWN", passes: (rider) => !rider.vendorCooldown },
  { number: 14, name: "NOTIFICATIONS_ENABLED", passes: (rider) => rider.notificationsAllowed },
];

/**
 * May this rider be offered this order?
 *
 * The first failing filter is returned rather than a boolean, because "you cannot take this order"
 * and "you cannot take this order because your notifications are off" are different products: the
 * second one is fixable in ten seconds by the rider themselves.
 */
export function eligibility(rider: RiderSnapshot, target: AssignmentTarget): Eligibility {
  for (const filter of FILTERS) {
    if (!filter.passes(rider, target)) return { eligible: false, filter: filter.number, reason: filter.name };
  }
  return { eligible: true, filter: null, reason: null };
}

/** A candidate with the model's predicted chance of accepting, from `09 §7.4`. */
export interface ScoredCandidate {
  readonly riderId: string;
  /** The probability this rider accepts this offer, in `0..1`. */
  readonly acceptanceProbability: number;
  /**
   * The weighted ranking score from `11 §5` (D124), when the caller has one.
   *
   * Two numbers, two jobs, and they were one number until this field existed. The **ordering** of candidates is the
   * weighted sum: fourteen factors, and a rider who is close, idle, reliable and familiar outranks one who merely
   * tends to tap *accept*. The **confidence** arithmetic is the acceptance probability: `pNone` multiplies
   * `(1 − acceptance)` and a weighted sum is not a probability it can multiply. Lacking this field, `planWaves` falls
   * back to ranking by acceptance probability, which is what it did before and is correct only when the score is
   * unavailable — not a default worth pretending is equivalent.
   */
  readonly score?: number;
}

/** One wave: who is asked, when, and for how long. */
export interface Wave {
  readonly wave: number;
  readonly riderIds: readonly string[];
  readonly ttlS: number;
  readonly startsAtS: number;
  /** The probability that nobody in this wave accepts. */
  readonly pNone: number;
}

/**
 * Turn scored candidates into waves.
 *
 * A wave is filled until the chance that *nobody* accepts drops below one in ten, because asking a
 * fourth phone buys less than it costs in rider goodwill. The arithmetic is `1 - Π(1 - p)`, computed
 * in the same order the candidates are ranked, so a stable ranking gives a stable wave — a wave that
 * shuffled between retries would page the same rider twice and skip another entirely.
 */
export function planWaves(candidates: readonly ScoredCandidate[], maxWaves = MAX_WAVES): readonly Wave[] {
  // Rank on the weighted score when both have one, on acceptance probability otherwise; ties fall back to acceptance
  // so that a caller with no scores still gets a deterministic order.
  const ranked = [...candidates].sort((left, right) => {
    if (right.score !== undefined && left.score !== undefined && right.score !== left.score) {
      return right.score - left.score;
    }
    return right.acceptanceProbability - left.acceptanceProbability;
  });

  const waves: Wave[] = [];
  let cursor = 0;

  for (let index = 0; index < maxWaves && cursor < ranked.length; index += 1) {
    const schedule = WAVE_SCHEDULE[index];
    if (schedule === undefined) break;

    const chosen: ScoredCandidate[] = [];
    let pNone = 1;
    while (chosen.length < MAX_WAVE_SIZE && cursor < ranked.length) {
      const candidate = ranked[cursor] as ScoredCandidate;
      // The candidate that crosses the target is *included*: stopping one short would send a wave
      // with a worse chance of acceptance than the model says is acceptable.
      chosen.push(candidate);
      pNone *= 1 - candidate.acceptanceProbability;
      cursor += 1;
      if (pNone < WAVE_CONFIDENCE_TARGET) break;
    }

    if (chosen.length > 0)
      waves.push({ wave: schedule.wave, riderIds: chosen.map((candidate) => candidate.riderId), ttlS: schedule.ttlS, startsAtS: schedule.startsAtS, pNone });
  }

  return waves;
}

/** The state a claim races against, as the coordinator holds it (`11 §7.3`). */
export interface DispatchState {
  readonly orderId: string;
  readonly currentWave: readonly string[];
  readonly claimedBy: string | null;
  readonly expiredAtMs: number | null;
}

/** Why a claim did or did not win. */
export type ClaimOutcome =
  | { readonly ok: true; readonly riderId: string }
  | { readonly ok: false; readonly code: "OFFER_EXPIRED" | "OFFER_CLAIMED" | "OFFER_NOT_YOURS"; readonly claimedBy: string | null };

/**
 * Decide a claim, the way the Durable Object will (`11 §7.3`).
 *
 * This is a pure version of a single-threaded decision, which makes the race testable: three riders
 * tap at once, exactly one wins, and the losers are told *why* — `OFFER_CLAIMED` is a race, and a
 * race must never look like a malfunction on the losing phone.
 */
export function decideClaim(state: DispatchState, riderId: string, nowMs: number): ClaimOutcome {
  if (state.expiredAtMs !== null && nowMs >= state.expiredAtMs) return { ok: false, code: "OFFER_EXPIRED", claimedBy: state.claimedBy };
  if (state.claimedBy !== null) return { ok: false, code: "OFFER_CLAIMED", claimedBy: state.claimedBy };
  if (!state.currentWave.includes(riderId)) return { ok: false, code: "OFFER_NOT_YOURS", claimedBy: null };
  return { ok: true, riderId };
}

/** When a wave's offers expire, in milliseconds, given when the wave started. */
export function waveExpiryMs(startsAtMs: number, wave: number): number {
  const schedule = WAVE_SCHEDULE.find((entry) => entry.wave === wave);
  if (schedule === undefined) throw new RangeError(`there is no wave ${wave}`);
  return startsAtMs + schedule.ttlS * 1000;
}

/** Whether dispatch should move to the fallback ladder (`11 §11`). */
export function fallbackDue(assignableSinceMs: number, nowMs: number): boolean {
  return nowMs - assignableSinceMs >= FALLBACK_AT_S * 1000;
}
