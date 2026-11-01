/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * A number of paisa, branded so that a plain `number` cannot be passed where
 * money is expected. The brand is compile-time only: at runtime this is still
 * an integer, which is what makes it free in Workers and identical in Kotlin.
 *
 * 100 paisa = ৳1. The brand exists because the single most expensive defect a
 * payments system can have is a taka value reaching a paisa parameter, and a
 * structural type cannot tell 549 from 54 900.
 */
export type Paisa = number & { readonly __paisa: unique symbol };

/**
 * The largest value a TiDB `BIGINT` holds, and therefore the ceiling for any
 * stored amount. Anything above it is a defect upstream, not a value to clamp:
 * silently saturating money is how a ledger stops balancing.
 */
export const PAISA_MAX = Number.MAX_SAFE_INTEGER;

/** Assert that a value is an integer number of paisa inside the safe range. */
export function assertPaisa(value: number, label = "paisa"): Paisa {
  if (!Number.isInteger(value)) {
    throw new RangeError(`${label} must be an integer number of paisa, got ${value}`);
  }
  if (value > PAISA_MAX || value < -PAISA_MAX) {
    throw new RangeError(`${label} is outside the safe integer range: ${value}`);
  }
  return value as Paisa;
}

/** Construct a Paisa from a checked integer. */
export function paisa(value: number): Paisa {
  return assertPaisa(value);
}

/**
 * Sum amounts while refusing to exceed the safe integer range.
 *
 * A normal `reduce` would silently lose precision past 2^53, which turns a
 * ledger that closes to zero into one that closes to zero *almost* — the one
 * failure mode double-entry bookkeeping exists to make impossible.
 */
export function sumPaisa(amounts: readonly Paisa[]): Paisa {
  let total = 0;
  for (const amount of amounts) {
    total += amount;
    if (total > PAISA_MAX || total < -PAISA_MAX) {
      throw new RangeError("paisa sum left the safe integer range");
    }
  }
  return total as Paisa;
}

/** True when the amount is a whole number of taka (property P2). */
export function isWholeTaka(value: Paisa): boolean {
  return value % 100 === 0;
}
