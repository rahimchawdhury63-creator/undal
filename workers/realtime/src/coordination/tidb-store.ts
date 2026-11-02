/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The `StateStore` port over `coordination_state` (D90).
 *
 * D77 put the coordinator's non-atomic state in Workers KV; D89 retired that on arithmetic, and this is the
 * store that replaces it: one row per key, an opaque JSON value, and an expiry. The port has not changed, so
 * the coordinator above it has not either — the same class that a test drives against a `Map` drives this
 * against core's statement route.
 *
 * Two things are deliberate. Values are JSON text the database never reads, so a wave plan can grow a field
 * without a migration. And a key is validated here rather than trusted: keys are built from ids and roles,
 * the listing is a `LIKE` prefix, and a `%` in a key would quietly turn a zone's listing into every zone's.
 */

import { MAX_STATEMENT_ROWS } from "@undal/contracts";

import type { Clock } from "../lib/clock.ts";
import { systemClock } from "../lib/clock.ts";
import { COORDINATION_STATEMENTS } from "@undal/contracts";
import type { SqlExecutor, StateStore } from "./tidb.ts";
import { sqlTime } from "./tidb.ts";

/** The longest key the table indexes. */
export const MAX_STATE_KEY_LENGTH = 191;

/**
 * What a key may contain: the ids, roles and kinds the coordinator composes.
 *
 * No `%` and no `_`. They are the two characters `LIKE` treats as patterns, and a key carrying one would
 * quietly widen a zone's listing into every zone's — the kind of bug that reads as "presence is broken today".
 */
const KEY_SHAPE = /^[A-Za-z0-9:-]{1,191}$/u;

/** A row of the state listing, as the statement returns it. */
interface StateRow {
  readonly state_key: string;
  readonly state_value: string;
}

/** Throw unless this key can be stored and listed without changing what a prefix means. */
export function assertStateKey(key: string): void {
  if (!KEY_SHAPE.test(key) || key.length > MAX_STATE_KEY_LENGTH) {
    throw new RangeError(`not a coordination state key: ${JSON.stringify(key.slice(0, 40))}`);
  }
}

/**
 * Build the store.
 *
 * The clock is the caller's, so an expiry is computed from the same instant the coordinator used to decide it
 * — a store with a clock of its own would expire a row at a different moment than the one that wrote it said.
 */
export function createTiDBStateStore(sql: SqlExecutor, clock: Clock = systemClock): StateStore {
  return {
    async get<T>(key: string): Promise<T | null> {
      assertStateKey(key);
      const rows = await sql.query<StateRow>(COORDINATION_STATEMENTS.state_get.sql, [key, sqlTime(clock.nowMs())]);
      const raw = rows[0]?.state_value;
      if (raw === undefined) return null;
      return JSON.parse(String(raw)) as T;
    },

    async put<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
      assertStateKey(key);
      const expiresAt = ttlSeconds === undefined ? null : sqlTime(clock.nowMs() + ttlSeconds * 1_000);
      await sql.execute(COORDINATION_STATEMENTS.state_put.sql, [key, JSON.stringify(value), expiresAt]);
    },

    async delete(key: string): Promise<void> {
      assertStateKey(key);
      await sql.execute(COORDINATION_STATEMENTS.state_delete.sql, [key]);
    },

    async list<T>(prefix: string): Promise<readonly { readonly key: string; readonly value: T }[]> {
      assertStateKey(`${prefix}x`);
      const rows = await sql.query<StateRow>(COORDINATION_STATEMENTS.state_list.sql, [
        prefix,
        sqlTime(clock.nowMs()),
        MAX_STATEMENT_ROWS,
      ]);
      return rows.map((row) => ({ key: String(row.state_key), value: JSON.parse(String(row.state_value)) as T }));
    },
  };
}
