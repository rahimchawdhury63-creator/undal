/**
 * @file packages/shared_ts/src/rational.ts
 * @description Exact arbitrary-precision `BigInt` rational arithmetic helpers used across
 * UNDAL's money waterfall (`File 10`) and dynamic rider fare engine (`File 11`).
 *
 * Constitutional Law: IEEE-754 floating-point arithmetic is banned from money and payout rounding.
 * Every intermediate ratio executes in exact `BigInt` numerator/denominator space and rounds
 * half-up (`0.5 -> +1`) once at the documented step boundary.
 */

/**
 * Asserts that `value` is a finite safe integer and converts it to `bigint`.
 */
export function toSafePoishaBigInt(value: number, fieldName: string): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${fieldName} must be an integer poisha value; received ${value}`);
  }
  return BigInt(value);
}

/**
 * Divides non-negative or signed `numerator` by positive `denominator` using standard
 * round-half-away-from-zero (`ROUND_HALF_UP`: `2.5 -> 3`, `-2.5 -> -3`).
 */
export function roundHalfUpDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError(`Denominator must be positive; received ${denominator}`);
  }
  const sign = numerator < 0n ? -1n : 1n;
  const absNum = numerator < 0n ? -numerator : numerator;
  const quotient = absNum / denominator;
  const remainder = absNum % denominator;
  const roundIncrement = remainder * 2n >= denominator ? 1n : 0n;
  return sign * (quotient + roundIncrement);
}

/**
 * Scales an integer kilometer decimal (e.g. `3.8` or `'2.45'`) into exact integer millikilometers (`1 km = 1000 m`).
 */
export function kmToMetersInt(km: number, fieldName: string): bigint {
  if (!Number.isFinite(km) || km < 0) {
    throw new RangeError(`${fieldName} must be a non-negative finite number; received ${km}`);
  }
  // Convert decimal string cleanly to exact integer meters (0.001 km resolution) without float binary drift.
  const fixed = km.toFixed(6);
  const [whole = '0', frac = '000000'] = fixed.split('.');
  const microKm = BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, '0').slice(0, 6));
  return roundHalfUpDiv(microKm, 1_000n);
}

/**
 * Scales a non-negative rate factor (`1.675`, `0.6`, etc.) to exact 1,000,000-parts (`ppm`).
 */
export function factorToPpm(factor: number, fieldName: string): bigint {
  if (!Number.isFinite(factor) || factor < 0) {
    throw new RangeError(`${fieldName} must be a non-negative finite factor; received ${factor}`);
  }
  const fixed = factor.toFixed(6);
  const [whole = '0', frac = '000000'] = fixed.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, '0').slice(0, 6));
}
