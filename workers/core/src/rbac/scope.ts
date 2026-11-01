/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Principal } from "./guard.ts";

/**
 * Zone scoping as a mandatory predicate rather than a filter somebody remembers.
 *
 * The specification's requirement is blunt: a zone-scoped dispatcher must not be able
 * to read another zone's data even if a `WHERE` clause is forgotten. That is achieved
 * by never letting SQL be built without going through this module — `ScopedQuery`
 * carries the principal's scope and refuses to render a statement that does not
 * constrain it.
 */

/** A SQL fragment and the parameters that go with it. */
export interface Predicate {
  readonly sql: string;
  readonly params: readonly string[];
}

/** Raised when zone-scoped SQL is built without its predicate — a programming error. */
export class UnscopedQueryError extends Error {
  constructor(column: string) {
    super(`zone-scoped query is missing its predicate on ${column}`);
    this.name = "UnscopedQueryError";
  }
}

/**
 * The predicate that limits rows to the principal's zones.
 *
 * `null` for a global principal, which is the absence of a limit rather than an
 * empty one: an empty `IN ()` list would return nothing, and a global admin seeing
 * no orders is a worse failure than the leak this class prevents.
 */
export function zonePredicate(principal: Principal, column = "zone_id"): Predicate | null {
  if (principal.zoneScope === null) return null;
  const zones = principal.zoneScope;
  if (zones.length === 0) return { sql: "1 = 0", params: [] };
  const placeholders = zones.map(() => "?").join(", ");
  return { sql: `\`${column}\` IN (${placeholders})`, params: zones };
}

/**
 * A statement under construction that will not render without its zone predicate.
 *
 * Repositories use it for every list query. The constructor refuses a base statement
 * that already contains `WHERE`, so the predicate always lands where the builder put
 * it; `render()` is the only way to get SQL out, and it throws rather than returning
 * an unconstrained statement.
 */
export class ScopedQuery {
  private readonly conditions: { sql: string; params: readonly string[] }[] = [];
  private readonly base: string;
  private readonly principal: Principal;
  private readonly column: string;
  private tail = "";

  /** Parameter properties are not available under Node's strip-only TypeScript mode. */
  constructor(base: string, principal: Principal, column = "zone_id") {
    this.base = base;
    this.principal = principal;
    this.column = column;
    if (/\swhere\s/iu.test(base)) {
      throw new UnscopedQueryError(column);
    }
  }

  /** Add a condition, ANDed with the rest and with the zone predicate. */
  where(sql: string, params: readonly string[] = []): this {
    this.conditions.push({ sql, params });
    return this;
  }

  /** Add an `ORDER BY`/`LIMIT` tail. Parameters in a tail would defeat the builder. */
  suffix(tail: string): this {
    if (tail.includes("?")) throw new UnscopedQueryError(this.column);
    this.tail = ` ${tail}`;
    return this;
  }

  /** The statement and its parameters, with the zone predicate always present. */
  render(): { sql: string; params: readonly string[] } {
    const parts = [...this.conditions];
    const zone = zonePredicate(this.principal, this.column);
    if (zone !== null) parts.push({ sql: zone.sql, params: zone.params });
    const where = parts.length > 0 ? ` WHERE ${parts.map((part) => part.sql).join(" AND ")}` : "";
    return { sql: `${this.base}${where}${this.tail}`, params: parts.flatMap((part) => part.params) };
  }
}
