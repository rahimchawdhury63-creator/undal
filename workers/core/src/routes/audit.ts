/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The audit register route.
 *
 * Read-only, and deliberately so. Every other admin route in this Worker changes something and
 * therefore writes its own row; this one exists so a person can read those rows back. It returns
 * the before and after of each entry, because "vendor.pause" is a verb and the difference between
 * a kitchen that was open and one that was closed is the thing being investigated.
 *
 * Paged by sequence, descending, with `nextCursor` carrying the last sequence seen. A register read
 * at 21:00 wants the newest rows first; the CSV export in `audit/export.ts` walks the same table
 * forwards, which is the right order for a file an auditor reconciles line by line.
 */

import { failureResponse, successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { toHexId } from "../lib/ids.ts";
import { isAuditActorType, isAuditSeverity, listAuditRows, type AuditRow } from "../repositories/audit-log.ts";

/** The page sizes the register accepts. */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/** The longest action name worth accepting: the register's own are far shorter. */
const MAX_ACTION_LENGTH = 64;

/** An action name that cannot be anything but a lookup key. */
const ACTION_PATTERN = /^[a-z][a-z0-9._-]{2,63}$/u;

/** The resource types the platform writes. A closed list would go stale, so only shape is enforced. */
const RESOURCE_PATTERN = /^[A-Z][A-Z_]{2,31}$/u;

/** A 32-character hex id, which is how ids cross this API. */
const HEX_ID_PATTERN = /^[0-9a-f]{32}$/u;

/** Decode a JSON column that may arrive as text, an object, or nothing. */
function jsonValue(value: unknown): unknown {
  if (typeof value !== "string" || value === "") return value ?? null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** Hex for a buffer column, or `null`. */
function hexOf(value: Uint8Array | null): string | null {
  return value instanceof Uint8Array ? toHexId(value) : null;
}

/** One entry, as the console reads it. */
function serialise(row: AuditRow): Record<string, unknown> {
  return {
    seq: Number(row.seq),
    occurredAt: row.occurred_at,
    actor: {
      id: row.actor_id === null ? null : hexOf(row.actor_id),
      type: row.actor_type,
      role: row.actor_role,
    },
    action: row.action,
    resource: { type: row.resource_type, id: row.resource_id, subjectId: row.subject_id },
    before: jsonValue(row.before),
    after: jsonValue(row.after),
    reason: row.reason,
    severity: row.severity,
    requestId: hexOf(row.request_id),
    // The chain: a reader can see that entry N follows N-1 without being given the whole table.
    prevHash: hexOf(row.prev_hash),
    hash: hexOf(row.hash),
  };
}

/** A `422` that names the parameter the caller has to fix. */
function invalid(ctx: Ctx, field: string): Response {
  return failureResponse({ code: "VALIDATION_FAILED", details: { field } }, ctx.locale, ctx.requestId);
}

/** `GET /v1/audit`: the register, newest first. */
async function readRegister(ctx: Ctx): Promise<Response> {
  const params = ctx.url.searchParams;

  const action = params.get("action");
  if (action !== null && (!ACTION_PATTERN.test(action) || action.length > MAX_ACTION_LENGTH)) return invalid(ctx, "action");

  const resourceType = params.get("resourceType");
  if (resourceType !== null && !RESOURCE_PATTERN.test(resourceType)) return invalid(ctx, "resourceType");

  const resourceId = params.get("resourceId");
  if (resourceId !== null && !HEX_ID_PATTERN.test(resourceId)) return invalid(ctx, "resourceId");

  const actorType = params.get("actorType");
  if (actorType !== null && !isAuditActorType(actorType.toUpperCase())) return invalid(ctx, "actorType");

  const severity = params.get("severity");
  if (severity !== null && !isAuditSeverity(severity.toUpperCase())) return invalid(ctx, "severity");

  const rawLimit = Number(params.get("limit") ?? DEFAULT_LIMIT);
  if (!Number.isFinite(rawLimit) || rawLimit < 1 || rawLimit > MAX_LIMIT) return invalid(ctx, "limit");
  const limit = Math.floor(rawLimit);

  const rawBefore = params.get("before");
  let beforeSeq: number | null = null;
  if (rawBefore !== null) {
    const parsed = Number(rawBefore);
    if (!Number.isInteger(parsed) || parsed < 1) return invalid(ctx, "before");
    beforeSeq = parsed;
  }

  const rows = await listAuditRows(ctx.db, {
    action,
    resourceType,
    resourceId,
    actorType: actorType === null ? null : actorType.toUpperCase(),
    severity: severity === null ? null : severity.toUpperCase(),
    beforeSeq,
    limit,
  });
  const last = rows[rows.length - 1];
  return successResponse(
    {
      entries: rows.map(serialise),
      // A register that is not full has no successor, and saying otherwise invites a screen to
      // keep asking a table it has already finished reading.
      nextCursor: rows.length === limit && last !== undefined ? String(Number(last.seq)) : null,
      limit,
    },
    ctx.locale,
    ctx.requestId,
  );
}

/** The register route. */
export const AUDIT_ROUTES: readonly RouteDefinition[] = [
  {
    method: "GET",
    path: "/v1/audit",
    permission: "admin.audit.read",
    // Reading the register is an admin action for the limiter's purposes: one reviewer, one screen.
    group: "ADMIN_WRITE",
    run: (ctx) => readRegister(ctx),
  },
];
