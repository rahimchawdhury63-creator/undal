/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../db/client.ts";
import { sqlDatetime } from "../db/time.ts";
import { newId, opaqueToken, sha256, toHexId } from "../lib/ids.ts";
import { fail, ok, type Result } from "../lib/result.ts";

import { SESSION_LIMITS, revokeSession } from "./sessions.ts";
import { recordSecurityEvent } from "./security-events.ts";

/**
 * Refresh-token rotation with family reuse detection.
 *
 * Every refresh issues a new token and marks the old one used. A token presented twice
 * means one of two things: the network duplicated a request, or somebody copied the
 * token. Both are handled the same way — the whole family dies — because the cost of
 * logging a user out once is a re-login, and the cost of guessing wrong is a session
 * that lives for thirty days in two places at once.
 */

/** A rotated pair: the token to send, and when it stops working. */
export interface Rotated {
  readonly token: string;
  readonly sessionId: Uint8Array;
  readonly expiresAt: Date;
}

/** The row this module reads. */
interface RefreshRow {
  readonly id: Uint8Array;
  readonly session_id: Uint8Array;
  readonly family_id: Uint8Array;
  readonly token_hash: Uint8Array;
  readonly expires_at: string;
  readonly used_at: string | null;
  readonly revoked_at: string | null;
}

/**
 * Start a family: one token, one session, one family id.
 *
 * The family is created with the session rather than on first refresh so that a
 * compromised session has a single handle to revoke.
 */
export async function startFamily(
  db: Db,
  input: { sessionId: Uint8Array; actorType: keyof typeof SESSION_LIMITS; nowMs?: number },
): Promise<Rotated> {
  const now = input.nowMs ?? Date.now();
  const familyId = newId(now);
  const expiresAt = new Date(now + SESSION_LIMITS[input.actorType].refreshMinutes * 60_000);
  const token = opaqueToken();
  const tokenHash = await sha256(token);
  await db.execute(
    "INSERT INTO `refresh_tokens` (`id`, `session_id`, `family_id`, `token_hash`, `issued_at`, `expires_at`) VALUES (?, ?, ?, ?, ?, ?)",
    [newId(now + 1), input.sessionId, familyId, tokenHash, sqlDatetime(new Date(now)), sqlDatetime(expiresAt)],
  );
  return { token, sessionId: input.sessionId, expiresAt };
}

/**
 * Exchange a refresh token for a new one.
 *
 * Three outcomes: a fresh token (the normal path), `AUTH_REFRESH_REUSED` when the token
 * was already used — which kills the family and raises a security event — and
 * `AUTH_SESSION_EXPIRED` when the family has aged out.
 */
export async function rotate(db: Db, presentedToken: string, nowMs: number = Date.now()): Promise<Result<Rotated>> {
  const tokenHash = await sha256(presentedToken);
  const row = await db.first<RefreshRow>(
    "SELECT `id`, `session_id`, `family_id`, `token_hash`, `expires_at`, `used_at`, `revoked_at` " +
      "FROM `refresh_tokens` WHERE `token_hash` = ?",
    [tokenHash],
  );
  if (row === null) return fail("AUTH_TOKEN_INVALID");
  if (row.revoked_at !== null) return fail("AUTH_SESSION_EXPIRED");

  if (row.used_at !== null) {
    await killFamily(db, row.family_id, "REUSE", nowMs);
    await recordSecurityEvent(db, {
      kind: "TOKEN_REUSE",
      severity: "CRITICAL",
      actorId: null,
      subjectId: null,
      requestId: newId(nowMs),
      detail: { familyId: toHexId(row.family_id) },
      nowMs,
    });
    return fail("AUTH_REFRESH_REUSED");
  }

  if (Date.parse(`${row.expires_at.replace(" ", "T")}Z`) <= nowMs) return fail("AUTH_SESSION_EXPIRED");

  const token = opaqueToken();
  const nextHash = await sha256(token);
  const nextId = newId(nowMs);
  await db.batch([
    { sql: "UPDATE `refresh_tokens` SET `used_at` = ? WHERE `id` = ?", params: [sqlDatetime(new Date(nowMs)), row.id] },
    {
      sql: "INSERT INTO `refresh_tokens` (`id`, `session_id`, `family_id`, `token_hash`, `issued_at`, `expires_at`) VALUES (?, ?, ?, ?, ?, ?)",
      params: [nextId, row.session_id, row.family_id, nextHash, sqlDatetime(new Date(nowMs)), row.expires_at],
    },
    { sql: "UPDATE `refresh_tokens` SET `replaced_by` = ? WHERE `id` = ?", params: [nextId, row.id] },
  ]);

  return ok({ token, sessionId: row.session_id, expiresAt: new Date(Date.parse(`${row.expires_at.replace(" ", "T")}Z`)) });
}

/**
 * Revoke every token in a family and the session behind it.
 *
 * `REUSE` is the reason that matters: the session must die too, because an access token
 * already issued from it would otherwise keep working for its remaining minutes.
 */
export async function killFamily(db: Db, familyId: Uint8Array, reason: string, nowMs: number = Date.now()): Promise<void> {
  const session = await db.first<{ session_id: Uint8Array }>(
    "SELECT `session_id` FROM `refresh_tokens` WHERE `family_id` = ? LIMIT 1",
    [familyId],
  );
  await db.execute(
    "UPDATE `refresh_tokens` SET `revoked_at` = ?, `revoked_reason` = ? WHERE `family_id` = ? AND `revoked_at` IS NULL",
    [sqlDatetime(new Date(nowMs)), reason.slice(0, 48), familyId],
  );
  if (session !== null) await revokeSession(db, session.session_id, `REFRESH_${reason}`, nowMs);
}
