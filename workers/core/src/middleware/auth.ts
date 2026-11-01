/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { verifyAccessToken } from "../auth/jwt.ts";
import { findLiveSession, isIdle } from "../auth/sessions.ts";
import { fail, ok, type Result } from "../lib/result.ts";
import type { Principal } from "../rbac/guard.ts";
import { binToUuid } from "@undal/contracts";

import type { Ctx } from "./context.ts";

/**
 * Turn a bearer token into a principal, by checking the session as well as the signature.
 *
 * Verifying the signature alone would accept a token from a session that has been
 * revoked — the signature stays valid until it expires, which is the whole reason a
 * session row exists. Every authenticated request therefore costs one indexed read, and
 * that read is the price of being able to log somebody out immediately.
 */

/** The bearer token from the header, or `null` when the header is absent or malformed. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (header === null) return null;
  const match = /^Bearer\s+(\S+)$/u.exec(header);
  return match === null ? null : (match[1] as string);
}

/** The session row plus the account status, in one query. */
interface SessionJoin {
  readonly id: Uint8Array;
  readonly user_id: Uint8Array;
  readonly device_id: Uint8Array;
  readonly last_used_at: string;
  readonly revoked_at: string | null;
  readonly status: string;
  readonly actor_type: string;
}

/**
 * Authenticate the request.
 *
 * Failures are deliberately coarse: a missing token, a bad signature, a revoked session
 * and a suspended account all return a code the client can act on, but the response does
 * not distinguish "this account is suspended" from "this token is wrong" for a caller who
 * has not proved the token is theirs.
 */
export async function authenticate(ctx: Ctx): Promise<Result<Principal>> {
  const token = bearerToken(ctx.request);
  if (token === null) return fail("AUTH_TOKEN_MISSING");
  const claims = await verifyAccessToken(token, ctx.keys, Date.now());
  if (!claims.ok) return claims;

  const session = await ctx.db.first<SessionJoin>(
    "SELECT s.`id`, s.`user_id`, s.`device_id`, s.`last_used_at`, s.`revoked_at`, u.`status`, u.`actor_type` " +
      "FROM `sessions` s JOIN `users` u ON u.`id` = s.`user_id` " +
      "WHERE s.`id` = ? AND s.`revoked_at` IS NULL",
    [uuidBytes(claims.value.sid)],
  );
  if (session === null) return fail("AUTH_SESSION_EXPIRED");
  if (session.status !== "ACTIVE") {
    return session.status === "SUSPENDED" ? fail("AUTH_ACCOUNT_SUSPENDED") : fail("PERM_ACCOUNT_DISABLED");
  }
  // The claim carries the dashed UUID the rest of the API uses; the column is 16 bytes.
  // Comparing the two forms directly would refuse every request, which is the kind of bug
  // a test that only checks "not 200" would miss.
  if (binToUuid(new Uint8Array(session.device_id)) !== claims.value.did.toLowerCase()) return fail("AUTH_DEVICE_MISMATCH");
  if (isIdle({ last_used_at: session.last_used_at }, claims.value.act, Date.now())) return fail("AUTH_SESSION_EXPIRED");

  return ok({
    userId: claims.value.sub,
    actorType: claims.value.act,
    role: claims.value.role,
    sessionId: claims.value.sid,
    deviceId: claims.value.did,
    zoneScope: claims.value.scope,
    stepUpAtMs: claims.value.amr,
    impersonating: claims.value.imp,
  });
}

/** A UUID string as the 16 bytes a `BINARY(16)` column compares against. */
export function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/gu, "");
  if (!/^[0-9a-f]{32}$/iu.test(hex)) throw new RangeError(`not a UUID: ${uuid}`);
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

/** Whether a route needs a principal at all, which is what makes anonymous routes explicit. */
export const ANONYMOUS = "*" as const;
