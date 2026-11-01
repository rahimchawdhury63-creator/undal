/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * An amount/rate pair used by the differential test.
 *
 * The generator is a fixed 64-bit LCG rather than `Math.random` so that the
 * 110 000-vector differential against Python and Kotlin can be reproduced
 * byte-for-byte from a seed recorded in CI logs. A test that cannot be replayed
 * cannot be used to settle an argument about money.
 */
export interface RateVector {
  readonly amount: number;
  readonly rateBps: number;
}

const SEED = 0x9e3779b97f4a7c15n;
const MULTIPLIER = 6364136223846793005n;
const INCREMENT = 1442695040888963407n;
const MASK = 0xffffffffffffffffn;

/** Deterministically produce `count` vectors across every rate the platform uses. */
export function generateVectors(count: number): RateVector[] {
  const rates = [0, 1, 500, 600, 800, 1_000, 1_500, 2_500, 5_000, 10_000, 22_000];
  const out: RateVector[] = [];
  let state = SEED;
  for (let index = 0; index < count; index += 1) {
    state = (state * MULTIPLIER + INCREMENT) & MASK;
    const amount = Number(state % 25_000_000n);
    state = (state * MULTIPLIER + INCREMENT) & MASK;
    const rateBps = rates[Number(state % BigInt(rates.length))] ?? 0;
    out.push({ amount, rateBps });
  }
  return out;
}
