/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * A deterministic random source for property tests in this package.
 *
 * Same seed and same LCG as `packages/money/test/vectors.ts` so a failure in one
 * suite can be reproduced in the other; a test that cannot be replayed cannot be
 * used to settle an argument about money or about which zone an address is in.
 */
export interface SweepVector {
  readonly amount: number;
  readonly rateBps: number;
}

const SEED = 0x9e3779b97f4a7c15n;
const MULTIPLIER = 6364136223846793005n;
const INCREMENT = 1442695040888963407n;
const MASK = 0xffffffffffffffffn;

/** Produce `count` pairs drawn from the shared seeded stream. */
export function generateVectors(count: number): SweepVector[] {
  const rates = [1, 500, 800, 1_000, 1_500, 2_500, 5_000, 10_000];
  const out: SweepVector[] = [];
  let state = SEED;
  for (let index = 0; index < count; index += 1) {
    state = (state * MULTIPLIER + INCREMENT) & MASK;
    const amount = Number(state % 25_000_000n);
    state = (state * MULTIPLIER + INCREMENT) & MASK;
    out.push({ amount, rateBps: rates[Number(state % BigInt(rates.length))] ?? 1 });
  }
  return out;
}
