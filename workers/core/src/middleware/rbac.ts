/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { fail, ok, type Result } from "../lib/result.ts";
import { authorise, type Requirement } from "../rbac/guard.ts";
import type { PermissionKey } from "../rbac/keys.ts";
import { isPermissionKey } from "../rbac/keys.ts";

import type { Ctx } from "./context.ts";
import { ANONYMOUS } from "./auth.ts";

/**
 * The authorisation step of the pipeline, and the check that a route declares a real
 * permission.
 *
 * `isPermissionKey` is called at module load for every route rather than at request
 * time: a route declaring `finance.payout.mark_paid` with a typo would deny everybody
 * forever, and finding that in CI is cheap while finding it in production is a support
 * ticket about a button that does nothing.
 */
export function checkRequirement(ctx: Ctx, permission: string, options: { write?: boolean; zoneId?: string; reasonRequired?: boolean; reason?: string | null }): Result<true> {
  if (permission === ANONYMOUS) return ok(true);
  if (!isPermissionKey(permission)) throw new Error(`route declares an unknown permission: ${permission}`);
  const requirement: Requirement = {
    permission: permission as PermissionKey,
    ...(options.write === undefined ? {} : { write: options.write }),
    ...(options.zoneId === undefined ? {} : { zoneId: options.zoneId }),
    ...(options.reasonRequired === undefined ? {} : { reasonRequired: options.reasonRequired }),
  };
  const decision = authorise(ctx.principal, requirement, { nowMs: Date.now(), reason: options.reason ?? null });
  if (decision.allowed) return ok(true);
  return fail(decision.code);
}
