/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * A value a SQL constraint can be written against.
 *
 * `any` is deliberate and confined to this alias. A `CHECK` is defined over SQL's
 * dynamic types — the same expression compares a `BIGINT` to a literal and a
 * `VARCHAR` to a string — so a precise TypeScript union would force every
 * generated validator to cast before comparing. Confining the looseness to one
 * named type keeps it visible: nothing outside the generated validators may use
 * this alias for a domain decision.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SqlValue = any;

/** A row as the database would hold it, keyed by column name. */
export type Row = Record<string, SqlValue>;

/** One declared `CHECK`, with its SQL for the error message and a validator for the row. */
export interface Constraint {
  readonly name: string;
  readonly table: string;
  /** The SQL as written in the migration, so a violation quotes the rule it broke. */
  readonly sql: string;
  readonly validate: (row: Row) => boolean;
}

/** A single unmet constraint. */
export interface Violation {
  readonly table: string;
  readonly constraint: string;
  readonly sql: string;
}
