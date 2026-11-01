/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Paisa } from "./paisa.ts";

/**
 * Multiply an integer paisa amount by a rate in basis points, rounding once,
 * with banker's rounding (ties to even).
 *
 * This is the only place in the platform where a ratio becomes an amount.
 * Everything else — commission, tax, rider bonus, delivery margin, bundle
 * credit, weather premium — calls this. Three implementations exist (Python,
 * TypeScript, Kotlin) and a 110 000-vector differential test asserts they agree
 * exactly, because "nearly the right amount of money" is not a thing.
 *
 * Banker's rounding rather than half-up because half-up is biased: it always
 * sends the half-paisa to the party with the larger share, which over a year of
 * orders is money nobody agreed to. Ties-to-even has no directional bias.
 */
export function applyRate(amountPaisa: Paisa | number, rateBps: number): Paisa {
  if (!Number.isInteger(amountPaisa)) {
    throw new RangeError(`applyRate: amount must be integer paisa, got ${amountPaisa}`);
  }
  if (!Number.isInteger(rateBps)) {
    throw new RangeError(`applyRate: rate must be integer basis points, got ${rateBps}`);
  }

  const product = amountPaisa * rateBps;
  if (!Number.isSafeInteger(product)) {
    throw new RangeError("applyRate: intermediate product left the safe integer range");
  }

  const negative = product < 0;
  const magnitude = Math.abs(product);
  const quotient = Math.floor(magnitude / 10_000);
  const remainder = magnitude % 10_000;

  let rounded: number;
  if (remainder * 2 > 10_000) {
    rounded = quotient + 1;
  } else if (remainder * 2 < 10_000) {
    rounded = quotient;
  } else {
    rounded = quotient % 2 === 0 ? quotient : quotient + 1;
  }

  return (negative ? -rounded : rounded) as Paisa;
}
