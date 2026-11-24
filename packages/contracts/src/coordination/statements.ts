/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The statements `undal-realtime` may ask `undal-core` to run (D90).
 *
 * `05 §2.1` and `34 §3.1` are unambiguous that core is the only Worker that writes TiDB, and `05 §4.2` is
 * equally unambiguous that the free coordinator's atomicity comes from a conditional `UPDATE` it composes
 * itself. Both are true at once only if the statement travels as a *name*: realtime sends
 * `{statement: "claim_lock", params: […]}`, core looks the name up in this catalogue and runs that SQL.
 *
 * The catalogue lives in the shared contracts package rather than in either Worker for the reason that makes
 * it safe: there is exactly one spelling of `claim_lock`, core executes the spelling realtime composed, and a
 * test can prove the two are the same string. A route that accepted SQL text would be a general-purpose
 * database proxy in the platform's trust boundary, which is a much larger thing to own than seven statements.
 *
 * Everything here is parameterised and everything here is fixed. No caller-supplied table name, column name,
 * ordering or limit reaches the statement, which is what makes "the catalogue is closed" a property a reader
 * can check rather than a promise.
 */

/** One statement the executor may run, with the name it travels under. */
export interface CoordinationStatement {
  /** The wire name. Stable: an audit row or a log line may name it. */
  readonly name: string;
  /** The one spelling of the SQL. */
  readonly sql: string;
  /** Reads answer rows; writes answer `affectedRows`. */
  readonly kind: "read" | "write";
}

/**
 * The locks, the event log and the key-value state the free coordinator needs.
 *
 * The lock statements come from `05 §4.2`: exactly one caller's `UPDATE` reports `affectedRows = 1`, and the
 * `WHERE` clause carrying the lease is what makes that true without a transaction. The event statements are
 * the order stream's storage (`order_state_events` already exists for it). The state statements are the
 * coordinator's own row store — wave plans, zone counters and presence sessions — which is a table with a
 * key, a value and an expiry rather than a second Cloudflare product (D89).
 */
export const COORDINATION_STATEMENTS = {
  claim_lock: {
    name: "claim_lock",
    kind: "write",
    sql: `UPDATE dispatch_locks
   SET holder = ?, expires_at = ?
 WHERE order_id = UNHEX(?)
   AND (holder = 'NONE' OR (holder = ? AND expires_at >= ?) OR expires_at < ?)`,
  },
  open_lock: {
    name: "open_lock",
    kind: "write",
    sql: `INSERT IGNORE INTO dispatch_locks (id, order_id, holder, expires_at, created_at)
VALUES (UNHEX(?), UNHEX(?), 'NONE', ?, ?)`,
  },
  release_lock: {
    name: "release_lock",
    kind: "write",
    sql: `UPDATE dispatch_locks
   SET holder = 'NONE', expires_at = ?
 WHERE order_id = UNHEX(?) AND holder = ?`,
  },
  lock_holder: {
    name: "lock_holder",
    kind: "read",
    sql: "SELECT holder, expires_at FROM dispatch_locks WHERE order_id = UNHEX(?)",
  },
  next_seq: {
    name: "next_seq",
    kind: "read",
    sql: "SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM order_state_events WHERE order_id = UNHEX(?)",
  },
  insert_event: {
    name: "insert_event",
    kind: "write",
    sql: `INSERT INTO order_state_events
  (id, order_id, seq, from_state, to_state, actor_type, actor_user_id, reason_code, reason_text, metadata, occurred_at)
VALUES (UNHEX(?), UNHEX(?), ?, NULL, ?, ?, ?, NULL, NULL, ?, ?)`,
  },
  read_events: {
    name: "read_events",
    kind: "read",
    sql: `SELECT seq, to_state AS kind, actor_type AS actorType, actor_user_id AS actorId,
       metadata, occurred_at AS occurredAt
  FROM order_state_events
 WHERE order_id = UNHEX(?) AND seq > ?
 ORDER BY seq ASC
 LIMIT ?`,
  },
  ping: {
    name: "ping",
    kind: "read",
    sql: "SELECT 1 AS one",
  },
  state_get: {
    name: "state_get",
    kind: "read",
    sql: "SELECT state_value FROM coordination_state WHERE state_key = ? AND (expires_at IS NULL OR expires_at > ?)",
  },
  state_put: {
    name: "state_put",
    kind: "write",
    sql: `INSERT INTO coordination_state (state_key, state_value, expires_at)
VALUES (?, ?, ?)
ON DUPLICATE KEY UPDATE state_value = VALUES(state_value), expires_at = VALUES(expires_at)`,
  },
  state_delete: {
    name: "state_delete",
    kind: "write",
    sql: "DELETE FROM coordination_state WHERE state_key = ?",
  },
  state_list: {
    name: "state_list",
    kind: "read",
    // Keyset pagination, not `OFFSET`: the listing is assembled while other rows are being written, and an
    // offset would skip or repeat a device depending on what landed between two pages (D92).
    sql: `SELECT state_key, state_value FROM coordination_state
 WHERE state_key LIKE CONCAT(?, '%') AND state_key > ? AND (expires_at IS NULL OR expires_at > ?)
 ORDER BY state_key ASC
 LIMIT ?`,
  },
} as const satisfies Record<string, CoordinationStatement>;

/** Every name the executor accepts. */
export type CoordinationStatementName = keyof typeof COORDINATION_STATEMENTS;

/** The most parameters one call may carry. No statement here needs more than seven. */
export const MAX_STATEMENT_PARAMS = 16;

/** The most rows one read may return. A caller asking for more is asking for an export, not a stream. */
export const MAX_STATEMENT_ROWS = 500;

/** Every statement, in catalogue order, for a route that wants to validate or document them all. */
export const ALL_COORDINATION_STATEMENTS: readonly CoordinationStatement[] = Object.values(COORDINATION_STATEMENTS);

/** The statement a wire name refers to, or `null` when the name is not in the catalogue. */
export function statementByName(name: unknown): CoordinationStatement | null {
  if (typeof name !== "string") return null;
  const found = ALL_COORDINATION_STATEMENTS.find((statement) => statement.name === name);
  return found ?? null;
}

/**
 * The statement this SQL text is, or `null`.
 *
 * This is how the executor turns the `SQL` a coordinator composed into a name on the wire: the strings are
 * imported from this module, so identity is exact and a statement a caller invented cannot be sent at all.
 */
export function statementFor(sql: string): CoordinationStatement | null {
  const found = ALL_COORDINATION_STATEMENTS.find((statement) => statement.sql === sql);
  return found ?? null;
}
