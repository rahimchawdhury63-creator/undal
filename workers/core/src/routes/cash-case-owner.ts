/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import * as audit from "../audit/write.ts";
import { toHexId } from "../lib/ids.ts";
import { uuidBytes } from "../middleware/auth.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { failureResponse, successResponse } from "../middleware/envelope.ts";
import { claimDeclaration, declarationCase, releaseDeclaration } from "../repositories/declarations.ts";

/** Claim or release one's own open review case. The conditional update arbitrates concurrent reviewers. */
async function changeOwner(ctx: Ctx, rawId: string, release: boolean): Promise<Response> {
  if (ctx.principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);
  let id: Uint8Array;
  let actor: Uint8Array;
  try { id = uuidBytes(rawId); } catch {
    return failureResponse({ code: "VALIDATION_ID_MALFORMED", details: { field: "id" } }, ctx.locale, ctx.requestId);
  }
  try { actor = uuidBytes(ctx.principal.userId); } catch {
    return failureResponse({ code: "PERM_DENIED", details: { reason: "not_an_admin" } }, ctx.locale, ctx.requestId);
  }
  const found = await declarationCase(ctx.db, id);
  if (found === null) {
    return failureResponse({ code: "CASH_DECLARATION_NOT_FOUND", details: { declaration_id: rawId } }, ctx.locale, ctx.requestId);
  }
  const now = Date.now();
  const changed = release
    ? await releaseDeclaration(ctx.db, id, actor)
    : await claimDeclaration(ctx.db, id, actor, now);
  if (!changed) return failureResponse({ code: "CASH_CASE_UNAVAILABLE" }, ctx.locale, ctx.requestId);

  const actorId = toHexId(actor);
  await audit.appendAudit(ctx.db, {
    actorId: ctx.principal.userId,
    actorType: "ADMIN",
    actorRole: ctx.principal.role ?? null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    action: release ? "finance.cash.case_release" : "finance.cash.case_claim",
    resourceType: "RIDER_CASH_DECLARATION",
    resourceId: toHexId(id),
    subjectId: found.riderId,
    before: { ownerId: release ? actorId : null },
    after: { ownerId: release ? null : actorId },
    reason: null,
    severity: "NOTICE",
  }, now);
  return successResponse({ id: toHexId(id), ownerId: release ? null : actorId, claimedAt: release ? null : new Date(now).toISOString() }, ctx.locale, ctx.requestId);
}

/** Reviewers can only claim or release themselves; financial resolution is a separate permission. */
export const CASH_CASE_OWNER_ROUTES: readonly RouteDefinition[] = [
  {
    method: "POST", path: "/v1/finance/cash/declarations/{id}/claim",
    permission: "finance.cash.reject_settlement", write: true, group: "ADMIN_WRITE", maxBodyBytes: 0,
    run: async (ctx, input) => changeOwner(ctx, input.params["id"] ?? "", false),
  },
  {
    method: "POST", path: "/v1/finance/cash/declarations/{id}/release",
    permission: "finance.cash.reject_settlement", write: true, group: "ADMIN_WRITE", maxBodyBytes: 0,
    run: async (ctx, input) => changeOwner(ctx, input.params["id"] ?? "", true),
  },
];
