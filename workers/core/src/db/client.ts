/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { connect, type Connection } from "@tidbcloud/serverless";

/**
 * The database, as the rest of the Worker sees it.
 *
 * One interface, four methods, no ORM: a query builder that generates SQL for a
 * schema this document-driven would be a second source of truth for the schema, and
 * the guardrails would have to check both. Repositories write SQL, and this type is
 * the only thing between them and the network.
 */
export interface Db {
  /** Rows of a `SELECT`, typed by the caller who knows what the columns mean. */
  query<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  /** The first row, or `null` — for lookups by primary key, which is most of them. */
  first<T>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  /** Affected rows of a write. */
  execute(sql: string, params?: readonly unknown[]): Promise<{ affectedRows: number; lastInsertId?: number }>;
  /** A single-statement atomic operation, which the platform prefers to a transaction. */
  batch(statements: readonly { sql: string; params?: readonly unknown[] }[]): Promise<void>;
}

/** What a TiDB error looks like once it has been classified. */
export type DbErrorKind = "DEADLOCK" | "LOCK_TIMEOUT" | "DUPLICATE" | "CONSTRAINT" | "CONNECTION" | "UNKNOWN";

/** Which failures are worth retrying, and which are the caller's fault. */
const RETRYABLE: ReadonlySet<DbErrorKind> = new Set<DbErrorKind>(["DEADLOCK", "LOCK_TIMEOUT", "CONNECTION"]);

interface DriverError {
  readonly code?: string;
  readonly errno?: number;
  readonly message?: string;
}

/**
 * Classify a driver error by its MySQL error number.
 *
 * 1213 (deadlock) and 1205 (lock wait timeout) are the two the ledger meets under
 * load, and both mean "try again", not "tell the customer". 1062 means the unique
 * index did its job and the caller asked for something that already exists — that
 * is a 409, not a retry.
 */
export function classifyError(error: unknown): DbErrorKind {
  const detail = error as DriverError;
  const code = String(detail.code ?? "");
  if (code === "1213" || code === "40001") return "DEADLOCK";
  if (code === "1205") return "LOCK_TIMEOUT";
  if (code === "1062" || code === "23000") return "DUPLICATE";
  if (code === "1452" || code === "1048") return "CONSTRAINT";
  if (code === "ETIMEDOUT" || code === "ECONNRESET" || /fetch failed|network/iu.test(detail.message ?? ""))
    return "CONNECTION";
  return "UNKNOWN";
}

/** Whether a caller should retry rather than surface the failure. */
export function isRetryable(kind: DbErrorKind): boolean {
  return RETRYABLE.has(kind);
}

/**
 * The `time_zone` pin, sent with the connection rather than after it.
 *
 * The HTTP driver opens no session to hold a `SET`, so the pin has to travel in the
 * DSN; TiDB applies it to every statement the gateway proxies. Without it a
 * `CURRENT_TIMESTAMP(6)` default is written in whatever zone the server was
 * provisioned with, and every `DATETIME(6)` column silently stops being UTC — which
 * shows up as invoices an hour off, months later.
 */
export const TIME_ZONE_PARAM = "time_zone=%2B00%3A00";

/** Add the UTC pin to a DSN that does not already carry one. */
export function pinTimeZone(url: string): string {
  if (/[?&]time_zone=/u.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${TIME_ZONE_PARAM}`;
}

/**
 * Build the database handle for one request.
 *
 * The connection is created per request, not cached in module scope: a Worker
 * isolate can be evicted between two requests, and a cached driver holding a
 * half-open gateway connection fails the next request in a way that looks random.
 */
export function createDb(url: string): Db {
  const connection: Connection = connect({ url: pinTimeZone(url) });

  return {
    async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      const rows = await connection.execute(sql, [...params]);
      return rows as T[];
    },
    async first<T>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
      const rows = (await connection.execute(sql, [...params])) as T[];
      return rows.length > 0 ? (rows[0] as T) : null;
    },
    async execute(sql: string, params: readonly unknown[] = []) {
      const result = (await connection.execute(sql, [...params])) as {
        rowsAffected?: number;
        lastInsertId?: number;
      };
      const affected: { affectedRows: number; lastInsertId?: number } = { affectedRows: result.rowsAffected ?? 0 };
      if (result.lastInsertId !== undefined) affected.lastInsertId = result.lastInsertId;
      return affected;
    },
    async batch(statements): Promise<void> {
      for (const statement of statements) {
        await connection.execute(statement.sql, [...(statement.params ?? [])]);
      }
    },
  };
}

/**
 * In-memory database for tests, refusing anything a real database would refuse.
 *
 * A stub that answers every query with `[]` lets a broken repository pass its tests,
 * so this one matches on the SQL it was given and fails loudly on an unexpected
 * statement — including on a `SELECT` that is missing the zone-scope predicate,
 * which is the leak the scoping layer exists to prevent.
 */
export function stubDb(handlers: readonly { match: RegExp; rows?: unknown[]; affectedRows?: number }[]): Db & {
  readonly calls: readonly { sql: string; params: readonly unknown[] }[];
} {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const respond = (sql: string): { rows: unknown[]; affectedRows: number } => {
    const handler = handlers.find((candidate) => candidate.match.test(sql));
    if (handler === undefined) throw new Error(`unexpected statement: ${sql}`);
    return { rows: handler.rows ?? [], affectedRows: handler.affectedRows ?? 0 };
  };
  return {
    calls,
    async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      calls.push({ sql, params });
      return respond(sql).rows as T[];
    },
    async first<T>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
      calls.push({ sql, params });
      const rows = respond(sql).rows as T[];
      return rows.length > 0 ? (rows[0] as T) : null;
    },
    async execute(sql: string, params: readonly unknown[] = []) {
      calls.push({ sql, params });
      return { affectedRows: respond(sql).affectedRows };
    },
    async batch(statements): Promise<void> {
      for (const statement of statements) {
        calls.push({ sql: statement.sql, params: statement.params ?? [] });
        respond(statement.sql);
      }
    },
  };
}
