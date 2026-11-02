/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `POST /internal/coordination/statements` — the free coordinator's database, run by core (D90).
 *
 * `05 §4.2` gives the free path its atomicity from one conditional `UPDATE` on `dispatch_locks`;
 * `05 §2.1` and `34 §3.1` forbid `undal-realtime` from writing TiDB. Both hold only if the statement travels
 * as a name: realtime sends `{statement: "claim_lock", params: […]}` and this route looks the name up in the
 * shared catalogue and runs *that* SQL. A route that accepted SQL text would be a database proxy inside the
 * platform's trust boundary, and the trust boundary is the one thing a second writer would break.
 *
 * The catalogue is closed, the SQL is fixed, and every value is a bound parameter. What a caller chooses is
 * which of thirteen statements to run and with which values — never a table, a column, an ordering or a
 * limit. A name that is not in the catalogue is refused before the database is touched, so a caller that
 * invents a statement learns that it invented one.
 *
 * Read statements answer `{rows, truncated}`; write statements answer `{affectedRows}`. The distinction is
 * the catalogue's, not a sniff of the SQL: `SELECT` versus `UPDATE` is a property of the statement, and a
 * route that guessed would be a route that could be talked into guessing wrong.
 */

import { MAX_STATEMENT_PARAMS, MAX_STATEMENT_ROWS, statementByName } from "@undal/contracts";

import { failureResponse, successResponse } from "../middleware/envelope.ts";
import { ANONYMOUS } from "../middleware/auth.ts";
import { requireInternalToken } from "../middleware/internal-token.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";

// audit-exempt: this route is a pipe, not a decision — the statements it runs write dispatch locks, order
// events and the coordinator's own state, and every one of them is the effect of a decision made in the
// coordinator or in core's order routes, where the audit row belongs. An audit row per statement would be a
// trace of SQL rather than of decisions, and on the claim path it would put fifty racing riders behind one
// hash-linked chain for a lock row that exists to be contended.

/** The path realtime posts to. */
export const COORDINATION_PATH = "/internal/coordination/statements";

/** The longest single parameter value the executor will carry. A state value is JSON, not a document. */
export const MAX_PARAM_LENGTH = 4_096;

/** The body limit the route declares. Sixteen parameters of four kilobytes plus the envelope. */
export const COORDINATION_BODY_BYTES = 8 * 1024;

/**
 * Read the parameter list.
 *
 * Only the three kinds a column can hold travel: strings, finite numbers and `null`. A boolean, an object or
 * an array is refused rather than coerced, because the radio silence of a driver that turned `true` into `1`
 * is how a lock comes back held by nobody.
 */
export function readParams(raw: unknown): readonly unknown[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_STATEMENT_PARAMS) return null;
  const params: unknown[] = [];
  for (const value of raw) {
    if (value === null) {
      params.push(null);
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      params.push(value);
      continue;
    }
    if (typeof value === "string" && value.length <= MAX_PARAM_LENGTH) {
      params.push(value);
      continue;
    }
    return null;
  }
  return params;
}

/** Run one catalogue statement. */
async function runStatement(ctx: Ctx, body: unknown): Promise<Response> {
  const refused = requireInternalToken(ctx);
  if (refused !== null) return refused;

  const fields = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const statement = statementByName(fields["statement"]);
  if (statement === null) {
    return failureResponse(
      { code: "VALIDATION_FAILED", details: { field: "statement", reason: "unknown_statement" } },
      ctx.locale,
      ctx.requestId,
    );
  }
  const params = readParams(fields["params"]);
  if (params === null) {
    return failureResponse({ code: "VALIDATION_FAILED", details: { field: "params" } }, ctx.locale, ctx.requestId);
  }

  if (statement.kind === "read") {
    const rows = await ctx.db.query<Record<string, unknown>>(statement.sql, params);
    return successResponse(
      { rows: rows.slice(0, MAX_STATEMENT_ROWS), truncated: rows.length > MAX_STATEMENT_ROWS },
      ctx.locale,
      ctx.requestId,
    );
  }

  const result = await ctx.db.execute(statement.sql, params);
  return successResponse({ affectedRows: result.affectedRows }, ctx.locale, ctx.requestId);
}

/** The coordinator's internal surface. */
export const COORDINATION_ROUTES: readonly RouteDefinition[] = [
  {
    method: "POST",
    path: COORDINATION_PATH,
    permission: ANONYMOUS,
    group: "INTERNAL",
    write: true,
    maxBodyBytes: COORDINATION_BODY_BYTES,
    run: (ctx, input) => runStatement(ctx, input.body),
  },
];
