/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The `SqlExecutor` port, filled by core over the service binding (D90).
 *
 * The coordinator composes a statement — `CLAIM_SQL`, `state_put`, whichever the situation calls for — and
 * this adapter turns that text back into the catalogue's name before anything leaves the Worker. That
 * direction matters: SQL composed here, a name on the wire, the same SQL executed there. A caller that
 * invented a statement cannot POST it, because there is no name to send.
 *
 * Failures throw. A claim that answered `affectedRows: 0` because the database was unreachable would look
 * exactly like a claim another rider won, and the coordinator would tell a rider the offer was taken when it
 * was never offered. The health endpoint catches the throw and reports the backend down; a live claim lets
 * it out.
 */

import { statementFor } from "@undal/contracts";

import type { SqlExecutor } from "./tidb.ts";

/** Where core runs a statement. */
export const COORDINATION_PATH = "/internal/coordination/statements";

/** How long one statement may take before the coordinator gives up. */
export const STATEMENT_TIMEOUT_MS = 900;

/** What the executor may be given, so a test can supply a transport. */
export interface CoreSqlDeps {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** The statement's name, or a throw that says why there is none. */
function nameFor(sql: string): string {
  const statement = statementFor(sql);
  if (statement === null) {
    throw new RangeError(`coordination statement is not in the catalogue: ${sql.slice(0, 60)}`);
  }
  return statement.name;
}

/**
 * Build the executor.
 *
 * `query` and `execute` differ only in what they read back, because the catalogue already knows which
 * statements are reads: a `SELECT` posted to the write path would be a statement executed for its side
 * effects on a database that has none.
 */
export function createCoreSqlExecutor(baseUrl: string, token: string, deps: CoreSqlDeps = {}): SqlExecutor {
  const transport = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? STATEMENT_TIMEOUT_MS;
  const base = baseUrl.replace(/\/+$/, "");

  const post = async (sql: string, params: readonly unknown[]): Promise<Record<string, unknown>> => {
    const statement = nameFor(sql);
    const controller = new AbortController();
    // Two guards, because they fail differently: the controller cancels the request a real transport is
    // holding, and the race rejects even when a transport ignores the signal — which is what a stalled
    // `fetch` in a test, or a binding that has already given up, looks like.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`core did not answer ${statement} within ${timeoutMs} ms`));
      }, timeoutMs);
    });
    try {
      const response = await Promise.race([
        transport(`${base}${COORDINATION_PATH}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ statement, params }),
          signal: controller.signal,
        }),
        expired,
      ]);
      if (!response.ok) throw new Error(`core refused ${statement}: ${response.status}`);
      const answer = (await response.json()) as { ok?: boolean; data?: Record<string, unknown> };
      if (answer.ok !== true) throw new Error(`core did not run ${statement}`);
      return answer.data ?? {};
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  return {
    async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      const data = await post(sql, params);
      const rows = data["rows"];
      return Array.isArray(rows) ? (rows as T[]) : [];
    },
    async execute(sql: string, params: readonly unknown[] = []): Promise<{ affectedRows: number }> {
      const data = await post(sql, params);
      const affected = data["affectedRows"];
      if (typeof affected !== "number" || !Number.isFinite(affected)) {
        throw new TypeError("core answered a write without affectedRows");
      }
      return { affectedRows: affected };
    },
  };
}
