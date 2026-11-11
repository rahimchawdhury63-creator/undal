/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { sqlSafeInteger } from "../../lib/sql-integer.ts";

/** Number-based public reports cannot accurately represent integers outside this range. */
export function safeLedgerNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError("ledger integer exceeds safe number range");
  }
  return Number(value);
}

/** Accept the TiDB driver's integer/decimal aggregate strings without rounding or coercing NULL. */
export function sqlLedgerInteger(value: unknown): number {
  // SUM(BIGINT) can be returned as DECIMAL, which may include a zero-only scale.
  return sqlSafeInteger(value, "ledger SQL integer");
}

/** A SQL COUNT must also be non-negative. */
export function sqlLedgerCount(value: unknown): number {
  const result = sqlLedgerInteger(value);
  if (result < 0) throw new RangeError("invalid ledger SQL count");
  return result;
}
