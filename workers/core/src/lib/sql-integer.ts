/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/** Parse an integer returned by SQL without accepting floating-point rounding or decimal fractions. */
export function sqlSafeInteger(value: unknown, field: string): number {
  if (typeof value === "number") {
    if (Number.isSafeInteger(value)) return value;
    throw new RangeError(`invalid ${field}`);
  }
  if (typeof value !== "string" || value.length > 96 || !/^-?\d+(?:\.0+)?$/u.test(value)) {
    throw new RangeError(`invalid ${field}`);
  }
  const integer = BigInt(value.split(".")[0]!);
  if (integer > BigInt(Number.MAX_SAFE_INTEGER) || integer < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`invalid ${field}`);
  }
  return Number(integer);
}

/** Parse a SQL integer and refuse negative values rather than masking corrupt financial state. */
export function sqlSafeNonNegativeInteger(value: unknown, field: string): number {
  const integer = sqlSafeInteger(value, field);
  if (integer < 0) throw new RangeError(`negative ${field}`);
  return integer;
}
