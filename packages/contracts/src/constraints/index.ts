/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { CONSTRAINTS } from "./generated.ts";
import type { Constraint, Row, Violation } from "./types.ts";

export { CONSTRAINTS } from "./generated.ts";
export type { Constraint, Row, SqlValue, Violation } from "./types.ts";

/**
 * Validate one row against every constraint declared for its table.
 *
 * This is the enforcement TiDB does not provide. Call it inside the same atomic
 * statement that writes the row — the platform prefers a single conditional
 * `UPDATE` or a guarded `INSERT` over an interactive transaction, so the check
 * and the write are usually the same statement's `WHERE`; this function exists
 * for the cases where the row is assembled in the Worker first (a quote, an
 * invoice line) and for the tests that prove each rule still bites.
 *
 * A table with no declared constraints returns an empty list rather than
 * throwing: the absence of a rule is not a rule, and a validator that fails on
 * unknown tables would reject every table added before its constraints.
 */
export function validateRow(table: string, row: Row): Violation[] {
  const constraints = CONSTRAINTS[table];
  if (constraints === undefined) {
    return [];
  }
  const violations: Violation[] = [];
  for (const constraint of constraints) {
    if (!constraint.validate(row)) {
      violations.push({ table, constraint: constraint.name, sql: constraint.sql });
    }
  }
  return violations;
}

/** True when the row satisfies every declared constraint for its table. */
export function isValidRow(table: string, row: Row): boolean {
  return validateRow(table, row).length === 0;
}

/** Every constraint for one table, in declaration order. */
export function constraintsFor(table: string): readonly Constraint[] {
  return CONSTRAINTS[table] ?? [];
}
