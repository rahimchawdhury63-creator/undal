/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { fromSqlDateTime, toSqlDateTime } from "../lib/time.ts";

/**
 * The two conversions every repository needs, named for the column type.
 *
 * Repositories call `sqlNow()` and `parseDatetime()` rather than reaching for
 * `Date` methods, so "the column is DATETIME(6) in UTC" is decided once. TiDB
 * returns those columns as `YYYY-MM-DD HH:MM:SS.ffffff` strings, not `Date`
 * objects, and code that assumes otherwise silently produces `Invalid Date`
 * values that compare as `false` to everything.
 */

/** A `Date` as the `DATETIME(6)` string the driver expects. */
export function sqlDatetime(date: Date): string {
  return toSqlDateTime(date);
}

/** A `DATETIME(6)` column value as an instant in UTC. */
export function parseDatetime(value: string | Date | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : fromSqlDateTime(value);
}

/** Now, as a `DATETIME(6)` string: what every `updated_at` is set to. */
export function sqlNow(atMs: number = Date.now()): string {
  return toSqlDateTime(new Date(atMs));
}

/**
 * The SQL fragment that asserts a ledger entry balances before it is written.
 *
 * Posting code cannot rely on a constraint here — TiDB would not enforce a CHECK
 * that sums a sibling table — so the assertion travels in the same statement as the
 * insert and the statement fails if the sum is not zero. A closure checked in
 * application memory is a closure checked in a different transaction.
 */
export const LEDGER_CLOSURE_ASSERTION = "SUM(`amount_paisa`) = 0";
