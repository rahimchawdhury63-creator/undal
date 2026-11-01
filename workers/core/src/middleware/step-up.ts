/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { open } from "../auth/secret-box.ts";
import { verifyCode } from "../auth/totp.ts";
import { recordSecurityEvent } from "../auth/security-events.ts";
import { requiresStepUp } from "../rbac/step-up.ts";
import { fail, ok, type Result } from "../lib/result.ts";
import type { PermissionKey } from "../rbac/keys.ts";

import type { Ctx } from "./context.ts";
import { uuidBytes } from "./auth.ts";

/**
 * Step-up verification: the TOTP code a sensitive action must carry.
 *
 * The requirement comes from the permission key, not from the route, so a route added later
 * with one of the twenty-three sensitive keys inherits it. The code travels in
 * `X-Undal-Step-Up`, together with the reason in `X-Undal-Reason`; both are headers rather
 * than body fields because they are authorisation, and a caller should not be able to submit
 * an authorised body by accident.
 */

/** The header a client sends the six-digit code in. */
export const STEP_UP_HEADER = "X-Undal-Step-Up";

/** The stored TOTP secret for an admin. */
interface SecretRow {
  readonly secret_cipher: Uint8Array;
  readonly confirmed_at: string | null;
  readonly last_used_step: number | string;
}

/**
 * Verify the code and advance the used step.
 *
 * `last_used_step` is written here, inside the same check that accepted the code: a code
 * that verified but whose step was not recorded could be replayed for up to thirty seconds,
 * which is precisely the window a shoulder-surfer needs.
 */
export async function verifyStepUp(ctx: Ctx, key: PermissionKey): Promise<Result<number>> {
  if (!requiresStepUp(key)) return ok(Date.now());
  const principal = ctx.principal;
  if (principal === null) return fail("AUTH_TOKEN_MISSING");

  const submitted = ctx.request.headers.get(STEP_UP_HEADER);
  if (submitted === null || submitted.trim() === "") return fail("PERM_STEP_UP_REQUIRED");
  const reason = ctx.request.headers.get("X-Undal-Reason");
  if (reason === null || reason.trim().length < 8) return fail("VALIDATION_REQUIRED", { field: "reason" });

  const row = await ctx.db.first<SecretRow>(
    "SELECT `secret_cipher`, `confirmed_at`, `last_used_step` FROM `totp_secrets` WHERE `user_id` = ?",
    [uuidBytes(principal.userId)],
  );
  if (row === null || row.confirmed_at === null) return fail("AUTH_TOTP_REQUIRED");

  const keyMaterial = await import("../auth/secret-box.ts").then((module) => module.importBoxKey(ctx.env.TOTP_ENCRYPTION_KEY));
  const secret = await open(keyMaterial, new TextDecoder().decode(new Uint8Array(row.secret_cipher)));
  if (secret === null) return fail("AUTH_TOTP_INVALID");

  const verified = await verifyCode(submitted, secret, { lastUsedStep: Number(row.last_used_step) });
  if (!verified.ok) {
    await recordSecurityEvent(ctx.db, {
      kind: "STEP_UP_FAILED",
      severity: "WARNING",
      actorId: uuidBytes(principal.userId),
      subjectId: uuidBytes(principal.userId),
      requestId: uuidBytes(ctx.requestId),
      detail: { action: key },
      ip: ctx.ip,
    });
    return verified;
  }

  await ctx.db.execute("UPDATE `totp_secrets` SET `last_used_step` = ?, `updated_at` = ? WHERE `user_id` = ?", [
    verified.value,
    new Date().toISOString().slice(0, 19).replace("T", " "),
    uuidBytes(principal.userId),
  ]);
  return ok(Date.now());
}
