/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The system surface: what the platform is currently configured to do.
 *
 * One reader. It exists because `platform_config` is the answer to a question support asks every
 * week — "which dispatch weights are live in Sylhet" — and until now that answer required a
 * database console, which is a permission nobody should need to be helpful.
 *
 * Two decisions worth stating rather than discovering later:
 *
 *  - The key is `admin.config.edit`, because the register grants configuration as one key and
 *    reading a value is strictly weaker than rewriting it. Inventing `admin.config.read` would
 *    change a register the specification fixes; borrowing an unrelated key would be worse.
 *  - Values whose key looks like a credential are redacted, not filtered out. A row that vanishes
 *    leaves a reviewer wondering whether the setting exists; a row that says "redacted" tells them
 *    it does and that they do not get to see it. The check is a name heuristic and says so — the
 *    real answer is that credentials should not live in this table, and that is a separate job.
 */

import { failureResponse, successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { uuidBytes } from "../middleware/auth.ts";
import { toHexId } from "../lib/ids.ts";
import { countConfigKeys, listCurrentConfig, type ConfigRow } from "../repositories/platform-config.ts";

/** The page sizes the register accepts. */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;

/** The longest prefix worth accepting. */
const MAX_PREFIX = 60;

/** A configuration key: dotted words, no wildcards, no quoting games. */
const KEY_PATTERN = /^[a-z][a-z0-9._-]{0,59}$/u;

/** A key whose value is a credential by name. */
const CREDENTIAL = /(secret|pepper|token|password|private_key|api_key)/iu;

/** Decode a JSON column that may arrive as text or already parsed. */
function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** One row as the console reads it. */
function serialise(row: ConfigRow): Record<string, unknown> {
  const redacted = CREDENTIAL.test(row.key);
  return {
    key: row.key,
    zoneId: toHexId(row.zone_id),
    // The all-zero zone is the global default rather than a zone; naming it is clearer than
    // leaving a screen to special-case a string of zeroes.
    scope: /^0{32}$/u.test(toHexId(row.zone_id)) ? "GLOBAL" : "ZONE",
    value: redacted ? null : jsonValue(row.value),
    redacted,
    version: row.version,
    effectiveAt: row.effective_at,
    reason: row.reason,
  };
}

/** `GET /v1/system/config`. */
async function readConfig(ctx: Ctx): Promise<Response> {
  const params = ctx.url.searchParams;

  const prefix = params.get("prefix");
  if (prefix !== null && !KEY_PATTERN.test(prefix)) {
    return failureResponse({ code: "VALIDATION_FAILED", details: { field: "prefix" } }, ctx.locale, ctx.requestId);
  }

  let zoneId: Uint8Array | null = null;
  const rawZone = params.get("zoneId");
  if (rawZone !== null) {
    try {
      zoneId = uuidBytes(rawZone);
    } catch {
      return failureResponse({ code: "VALIDATION_ID_MALFORMED", field: "zoneId" }, ctx.locale, ctx.requestId);
    }
  }

  const rawLimit = Number(params.get("limit") ?? DEFAULT_LIMIT);
  if (!Number.isFinite(rawLimit) || rawLimit < 1 || rawLimit > MAX_LIMIT) {
    return failureResponse({ code: "VALIDATION_FAILED", details: { field: "limit" } }, ctx.locale, ctx.requestId);
  }
  const limit = Math.floor(rawLimit);

  const rows = await listCurrentConfig(ctx.db, { prefix, zoneId, limit });
  const total = await countConfigKeys(ctx.db);
  return successResponse(
    {
      entries: rows.map(serialise),
      // How many keys exist at all, so a screen can say what it is not showing. Without it a
      // filter looks like the whole register the moment it returns fewer rows than the limit.
      totalKeys: total,
      limit,
    },
    ctx.locale,
    ctx.requestId,
  );
}

/** The system routes. */
export const SYSTEM_ROUTES: readonly RouteDefinition[] = [
  {
    method: "GET",
    path: "/v1/system/config",
    permission: "admin.config.edit",
    group: "ADMIN_WRITE",
    run: (ctx) => readConfig(ctx),
  },
];
