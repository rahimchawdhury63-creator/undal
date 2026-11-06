/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * From a planned wave to the row that writes it (`11 §7`, D124).
 *
 * Three modules meet here and none of them knows the others: `planWaves` decides *who and when* (`assignment.ts`),
 * `scoreCandidates` decided *the order* (`scoring.ts`), and `insertOfferWave` knows *the table*
 * (`repositories/dispatch.ts`). This is the last pure step between them — the ranks, the scores and the single expiry
 * that the wave's twenty-five seconds turns into — so that the writer's only remaining job is the database and the
 * alarm.
 *
 * **Ranks come from the wave, not from the score list.** `planWaves` already chose and ordered the riders; re-sorting
 * here would let two orderings disagree about who was asked first, and the audit trail records `rank_in_wave` as the
 * planner's answer.
 */

import type { Wave, ScoredCandidate } from "./assignment.ts";
import { waveExpiryMs } from "./assignment.ts";

/** One offer, ready for `insertOfferWave`. Mirrors `WaveOffer` in the repository without importing the database. */
export interface PlannedOffer {
  readonly riderId: Uint8Array;
  readonly rankInWave: number;
  readonly score: number;
  readonly payoutPaisa: number;
}

/** A wave, with the instant it expires, ready to be written. */
export interface PlannedWave {
  readonly wave: number;
  readonly expiresAtMs: number;
  readonly offers: readonly PlannedOffer[];
  /** The probability nobody in this wave accepts, carried through from the planner for the trace. */
  readonly pNone: number;
}

/** What the caller must supply besides the plan itself. */
export interface PlanContext {
  /** The wave's first instant; every offer in it shares one expiry. */
  readonly nowMs: number;
  /** What the rider would earn, from the order's `rider_payout_paisa`. */
  readonly payoutPaisa: number;
  /** The score list the plan was made from, for `rank_in_wave`'s neighbours and the offer's `score` column. */
  readonly scored: readonly ScoredCandidate[];
}

function hexBytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "hex"));
}

/**
 * Build the write for one wave.
 *
 * A rider in the wave who is not in the score list is a `RangeError`: the planner can only have chosen them from that
 * list, so the mismatch means two different lists reached this function and the ranking the audit row will carry is
 * not the ranking the decision used.
 */
export function planWaveWrite(wave: Wave, context: PlanContext): PlannedWave {
  const byRider = new Map(context.scored.map((candidate) => [candidate.riderId, candidate]));
  const offers: PlannedOffer[] = wave.riderIds.map((riderId, index) => {
    const candidate = byRider.get(riderId);
    if (candidate === undefined) {
      throw new RangeError(`wave ${String(wave.wave)} names rider ${riderId}, who was not scored`);
    }
    return {
      riderId: hexBytes(riderId),
      rankInWave: index + 1,
      score: candidate.score ?? candidate.acceptanceProbability,
      payoutPaisa: context.payoutPaisa,
    };
  });
  return {
    wave: wave.wave,
    expiresAtMs: waveExpiryMs(context.nowMs, wave.wave),
    offers,
    pNone: wave.pNone,
  };
}
