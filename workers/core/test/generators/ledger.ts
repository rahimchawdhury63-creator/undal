/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The committed case generator for the ledger property tests.
 *
 * The tests commit the *generator*, not ten thousand hand-written cases: a case list is a
 * snapshot of what somebody thought of, while a generator with a fixed seed explores the
 * same ten thousand combinations on every machine and every run, and the seed is the only
 * thing that has to be stable for a failure to be reproducible.
 */

/** The same linear congruential generator the money vectors use, with the same constants. */
export class Lcg {
  private state: bigint;

  constructor(seed: bigint = 0x9e3779b97f4a7c15n) {
    this.state = seed;
  }

  /** The next 61-bit value, as a JavaScript-safe integer. */
  next(): number {
    const mask = (1n << 64n) - 1n;
    this.state = (this.state * 6364136223846793005n + 1442695040888963407n) & mask;
    return Number(this.state >> 11n);
  }

  /** A value in `[min, max)`. */
  between(min: number, max: number): number {
    return min + (this.next() % Math.max(1, max - min));
  }

  /** A UUID-shaped id that is stable for a given seed, so failures reproduce. */
  uuid(): string {
    const hex: string[] = [];
    for (let index = 0; index < 32; index += 1) hex.push((this.next() % 16).toString(16));
    const joined = hex.join("");
    return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-7${joined.slice(13, 16)}-8${joined.slice(17, 20)}-${joined.slice(20)}`;
  }

  /** True with probability `numerator / denominator`. */
  chance(numerator: number, denominator: number): boolean {
    return this.between(0, denominator) < numerator;
  }
}
