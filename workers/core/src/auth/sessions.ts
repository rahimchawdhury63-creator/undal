/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../db/client.ts";
import { sqlDatetime } from "../db/time.ts";
import { newId, sha256, toHexId } from "../lib/ids.ts";

/**
 * Sessions: the row a token points at, and the only thing that can end a login early.
 *
 * An access token is a bearer credential for fifteen minutes; the session row is what
 * makes it revocable sooner. Deleting a device, suspending an account, or a replay
 * detected during rotation all end the session, and the next request fails the session
 * lookup rather than trusting a signature that is still cryptographically valid.
 */

/** Lifetimes per actor, from `27 §2.3`. Refresh lifetimes live with rotation. */
export const SESSION_LIMITS = {
  CUSTOMER: { accessMinutes: 15, refreshMinutes: 43_200, idleMinutes: null, boundToDevice: false, maxDevices: 10 },
  VENDOR_OWNER: { accessMinutes: 15, refreshMinutes: 720, idleMinutes: null, boundToDevice: true, maxDevices: 5 },
  RIDER: { accessMinutes: 15, refreshMinutes: 720, idleMinutes: null, boundToDevice: true, maxDevices: 1 },
  ADMIN: { accessMinutes: 10, refreshMinutes: 240, idleMinutes: 30, boundToDevice: true, maxDevices: 2 },
} as const;

/** The row shape this module reads, named so the repository is not typed `any`. */
export interface SessionRow {
  readonly id: Uint8Array;
  readonly user_id: Uint8Array;
  readonly token_hash: Uint8Array;
  readonly device_id: Uint8Array;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly last_used_at: string;
  readonly revoked_at: string | null;
  readonly revoked_reason: string | null;
}

/** A created session, with the opaque token the client keeps. */
export interface IssuedSession {
  readonly sessionId: string;
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * Open a session for a device.
 *
 * The token is generated here and only its SHA-256 is stored: a database dump must not
 * contain anything a caller could present as a credential, and the lookup by hash is
 * one indexed equality.
 */
export async function createSession(
  db: Db,
  input: {
    userId: Uint8Array;
    deviceId: Uint8Array;
    ip: string;
    userAgent: string;
    expiresAt: Date;
    nowMs?: number;
  },
): Promise<IssuedSession> {
  const sessionId = newId(input.nowMs);
  const token = toHexId(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  await db.execute(
    "INSERT INTO `sessions` (`id`, `user_id`, `token_hash`, `device_id`, `ip_created`, `ua_created`, `issued_at`, `expires_at`, `last_used_at`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      sessionId,
      input.userId,
      tokenHash,
      input.deviceId,
      input.ip,
      input.userAgent.slice(0, 512),
      sqlDatetime(new Date(input.nowMs ?? Date.now())),
      sqlDatetime(input.expiresAt),
      sqlDatetime(new Date(input.nowMs ?? Date.now())),
    ],
  );
  return { sessionId: toHexId(sessionId), token, expiresAt: input.expiresAt };
}

/**
 * The live session for a presented token, or `null`.
 *
 * Revoked and expired sessions are filtered in SQL rather than in the caller: a session
 * that is returned and then checked is a session some path will forget to check.
 */
export async function findLiveSession(db: Db, token: string, nowMs: number = Date.now()): Promise<SessionRow | null> {
  const tokenHash = await sha256(token);
  return db.first<SessionRow>(
    "SELECT `id`, `user_id`, `token_hash`, `device_id`, `issued_at`, `expires_at`, `last_used_at`, `revoked_at`, `revoked_reason` " +
      "FROM `sessions` WHERE `token_hash` = ? AND `revoked_at` IS NULL AND `expires_at` > ?",
    [tokenHash, sqlDatetime(new Date(nowMs))],
  );
}

/** Record that a session was used, so idle timeouts have something to measure. */
export async function touchSession(db: Db, sessionId: Uint8Array, nowMs: number = Date.now()): Promise<void> {
  await db.execute("UPDATE `sessions` SET `last_used_at` = ? WHERE `id` = ?", [
    sqlDatetime(new Date(nowMs)),
    sessionId,
  ]);
}

/** End one session, with a reason the security log can group on. */
export async function revokeSession(db: Db, sessionId: Uint8Array, reason: string, nowMs: number = Date.now()): Promise<void> {
  await db.execute(
    "UPDATE `sessions` SET `revoked_at` = ?, `revoked_reason` = ? WHERE `id` = ? AND `revoked_at` IS NULL",
    [sqlDatetime(new Date(nowMs)), reason.slice(0, 64), sessionId],
  );
}

/**
 * End every session a user has, optionally sparing the one making the request.
 *
 * Sparing the caller matters: a password change should log out the other devices, not
 * the screen the user is standing in front of, which would look like the change failed.
 */
export async function revokeAllSessions(
  db: Db,
  userId: Uint8Array,
  reason: string,
  exceptSessionId?: Uint8Array,
  nowMs: number = Date.now(),
): Promise<number> {
  const result =
    exceptSessionId === undefined
      ? await db.execute(
          "UPDATE `sessions` SET `revoked_at` = ?, `revoked_reason` = ? WHERE `user_id` = ? AND `revoked_at` IS NULL",
          [sqlDatetime(new Date(nowMs)), reason.slice(0, 64), userId],
        )
      : await db.execute(
          "UPDATE `sessions` SET `revoked_at` = ?, `revoked_reason` = ? WHERE `user_id` = ? AND `revoked_at` IS NULL AND `id` <> ?",
          [sqlDatetime(new Date(nowMs)), reason.slice(0, 64), userId, exceptSessionId],
        );
  return result.affectedRows;
}

/**
 * Whether an admin session has gone idle.
 *
 * Only admins have an idle limit, and the check is deliberately here rather than in the
 * token: an idle timeout cannot live in a token that was minted before the idleness
 * began.
 */
export function isIdle(session: { last_used_at: string }, actorType: keyof typeof SESSION_LIMITS, nowMs: number): boolean {
  const limit = SESSION_LIMITS[actorType].idleMinutes;
  if (limit === null) return false;
  const lastUsed = Date.parse(`${session.last_used_at.replace(" ", "T")}Z`);
  return Number.isFinite(lastUsed) && nowMs - lastUsed > limit * 60_000;
}
