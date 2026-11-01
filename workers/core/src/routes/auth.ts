/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../db/client.ts";
import { sqlDatetime } from "../db/time.ts";
import { hashPassword, needsRehash, verifyPassword } from "../auth/argon2.ts";
import { checkPasswordPolicy, reusesHistory } from "../auth/password.ts";
import { issueTokens } from "../auth/issue.ts";
import { revokeAllSessions, revokeSession, touchSession } from "../auth/sessions.ts";
import { killFamily, rotate } from "../auth/refresh-rotation.ts";
import { recordSecurityEvent } from "../auth/security-events.ts";
import * as audit from "../audit/write.ts";
import { toHexId } from "../lib/ids.ts";
import { ok, type Result } from "../lib/result.ts";
import { normalisePhone } from "../lib/validate.ts";
import { successResponse, failureResponse } from "../middleware/envelope.ts";
import { uuidBytes } from "../middleware/auth.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";

/**
 * Authentication routes: the only endpoints in this response, because they are the ones
 * that make every later endpoint possible.
 *
 * Login is deliberately expensive and deliberately vague. Expensive: Argon2id at the
 * documented parameters, plus a device row, plus a session row, plus a refresh family.
 * Vague: a wrong password, an unknown number and a suspended account all answer
 * `AUTH_INVALID_CREDENTIALS`, because an endpoint that distinguishes them is a free
 * account-enumeration oracle over a phone-number space of 10⁸.
 */

/** The user row login reads. */
interface UserRow {
  readonly id: Uint8Array;
  readonly phone_norm: string;
  readonly email_norm: string | null;
  readonly password_hash: string | null;
  readonly actor_type: string;
  readonly status: string;
  readonly locale: string;
}

/** Minutes an account stays locked after repeated failures. */
export const LOCKOUT_MINUTES = 15;
/** Failures inside the lockout window that trigger it. */
export const LOCKOUT_THRESHOLD = 5;

/**
 * How many failures this phone has had inside the lockout window.
 *
 * Counted from `login_attempts` rather than kept in KV: a lockout must survive an
 * isolate eviction and must be visible in the admin panel while support is on the phone
 * with the customer, and KV offers neither.
 */
async function recentFailures(db: Db, phone: string, nowMs: number): Promise<number> {
  const since = sqlDatetime(new Date(nowMs - LOCKOUT_MINUTES * 60_000));
  const row = await db.first<{ failures: number | string }>(
    "SELECT COUNT(*) AS failures FROM `login_attempts` WHERE `phone` = ? AND `created_at` >= ? " +
      "AND `outcome` IN ('BAD_PASSWORD','TOTP_FAILED','DEVICE_MISMATCH')",
    [phone, since],
  );
  return row === null ? 0 : Number(row.failures);
}

/** Record one attempt, which is what the lockout and the security review both read. */
async function recordAttempt(
  db: Db,
  input: { phone: string; ipHash: Uint8Array; deviceHash: Uint8Array; outcome: string; nowMs: number },
): Promise<void> {
  await db.execute(
    "INSERT INTO `login_attempts` (`id`, `phone`, `ip_hash`, `device_hash`, `outcome`, `failed_count`, `created_at`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      crypto.randomUUID().replace(/-/gu, "").slice(0, 0) || newUint8(16, input.nowMs),
      input.phone,
      input.ipHash,
      input.deviceHash,
      input.outcome,
      1,
      sqlDatetime(new Date(input.nowMs)),
    ],
  );
}

/** Sixteen bytes for an id column, without importing the UUID helper into a route. */
function newUint8(length: number, nowMs: number): Uint8Array {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  bytes[0] = nowMs & 0xff;
  return bytes;
}

/** The session list a user may see about themselves. */
interface SessionListRow {
  readonly id: Uint8Array;
  readonly device_id: Uint8Array;
  readonly issued_at: string;
  readonly last_used_at: string;
  readonly expires_at: string;
  readonly revoked_at: string | null;
  readonly platform: string | null;
  readonly model: string | null;
}

/**
 * `POST /v1/auth/login`.
 *
 * The order of checks is the security design: lockout before password verification (so
 * a locked account cannot be used as a hashing oracle), password before status (so a
 * suspended account cannot be probed with a guessed password), and the device row only
 * after both, because a device registration is a write an unauthenticated caller must
 * not be able to force.
 */
async function login(ctx: Ctx, body: unknown): Promise<Response> {
  const input = (body ?? {}) as { phone?: unknown; password?: unknown; fingerprint?: unknown; platform?: unknown };
  const phone = normalisePhone(typeof input.phone === "string" ? input.phone : "");
  if (!phone.ok) return failureResponse(phone.error, ctx.locale, ctx.requestId);
  const password = typeof input.password === "string" ? input.password : "";
  const fingerprint = typeof input.fingerprint === "string" ? input.fingerprint : "";
  if (password === "" || fingerprint === "") {
    return failureResponse({ code: "VALIDATION_REQUIRED", field: password === "" ? "password" : "fingerprint" }, ctx.locale, ctx.requestId);
  }

  const now = Date.now();
  const ipHash = await sha256Bytes(ctx.ip);
  const deviceHash = await sha256Bytes(fingerprint);

  if ((await recentFailures(ctx.db, phone.value, now)) >= LOCKOUT_THRESHOLD) {
    await recordAttempt(ctx.db, { phone: phone.value, ipHash, deviceHash, outcome: "LOCKED", nowMs: now });
    return failureResponse({ code: "AUTH_LOCKED_OUT", details: { lockoutMinutes: LOCKOUT_MINUTES } }, ctx.locale, ctx.requestId);
  }

  const user = await ctx.db.first<UserRow>(
    "SELECT `id`, `phone_norm`, `email_norm`, `password_hash`, `actor_type`, `status`, `locale` FROM `users` WHERE `phone_norm` = ? AND `deleted_at` IS NULL",
    [phone.value],
  );
  const passwordOk = user === null ? false : await verifyPassword(password, user.password_hash);
  if (user === null || !passwordOk) {
    await recordAttempt(ctx.db, { phone: phone.value, ipHash, deviceHash, outcome: user === null ? "UNKNOWN_USER" : "BAD_PASSWORD", nowMs: now });
    return failureResponse({ code: "AUTH_INVALID_CREDENTIALS" }, ctx.locale, ctx.requestId);
  }
  if (user.status !== "ACTIVE") {
    return failureResponse({ code: user.status === "SUSPENDED" ? "AUTH_ACCOUNT_SUSPENDED" : "PERM_ACCOUNT_DISABLED" }, ctx.locale, ctx.requestId);
  }

  // A hash from weaker parameters is upgraded here, on the one request where the
  // plaintext is available, rather than by a migration that cannot compute hashes.
  if (user.password_hash !== null && needsRehash(user.password_hash)) {
    const upgraded = await hashPassword(password);
    ctx.waitUntil(ctx.db.execute("UPDATE `users` SET `password_hash` = ?, `updated_at` = ? WHERE `id` = ?", [upgraded, sqlDatetime(new Date(now)), user.id]));
  }

  const issued = await issueTokens(ctx, {
    userId: user.id,
    userIdHex: toHexId(new Uint8Array(user.id)),
    actorType: user.actor_type as "CUSTOMER" | "VENDOR_OWNER" | "RIDER" | "ADMIN",
    role: null,
    zoneScope: null,
    fingerprint,
    platform: input.platform === "WEB" ? "WEB" : "ANDROID",
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    nowMs: now,
  });
  if (!issued.ok) return failureResponse(issued.error, ctx.locale, ctx.requestId);

  await recordAttempt(ctx.db, { phone: phone.value, ipHash, deviceHash, outcome: "SUCCESS", nowMs: now });
  return successResponse(
    {
      accessToken: issued.value.accessToken,
      refreshToken: issued.value.refreshToken,
      expiresIn: issued.value.expiresIn,
      user: { id: toHexId(new Uint8Array(user.id)), actorType: user.actor_type, locale: user.locale },
    },
    ctx.locale,
    ctx.requestId,
  );
}

/** `POST /v1/auth/refresh`: exchange a refresh token for a new access token. */
async function refresh(ctx: Ctx, body: unknown): Promise<Response> {
  const input = (body ?? {}) as { refreshToken?: unknown };
  if (typeof input.refreshToken !== "string" || input.refreshToken === "") {
    return failureResponse({ code: "VALIDATION_REQUIRED", field: "refreshToken" }, ctx.locale, ctx.requestId);
  }
  const rotated = await rotate(ctx.db, input.refreshToken, Date.now());
  if (!rotated.ok) return failureResponse(rotated.error, ctx.locale, ctx.requestId);

  const row = await ctx.db.first<{ user_id: Uint8Array; actor_type: string; status: string }>(
    "SELECT u.`id` AS user_id, u.`actor_type`, u.`status` FROM `sessions` s JOIN `users` u ON u.`id` = s.`user_id` WHERE s.`id` = ?",
    [rotated.value.sessionId],
  );
  if (row === null || row.status !== "ACTIVE") return failureResponse({ code: "AUTH_SESSION_EXPIRED" }, ctx.locale, ctx.requestId);
  await touchSession(ctx.db, rotated.value.sessionId, Date.now());

  return successResponse({ accessToken: await shortLivedToken(ctx, rotated.value.sessionId, row.actor_type as "CUSTOMER" | "VENDOR_OWNER" | "RIDER" | "ADMIN"), refreshToken: rotated.value.token }, ctx.locale, ctx.requestId);
}

/** Mint an access token for an existing session, which is all a refresh does. */
async function shortLivedToken(ctx: Ctx, sessionId: Uint8Array, actorType: "CUSTOMER" | "VENDOR_OWNER" | "RIDER" | "ADMIN"): Promise<string> {
  const row = await ctx.db.first<{ user_id: Uint8Array; device_id: Uint8Array }>(
    "SELECT `user_id`, `device_id` FROM `sessions` WHERE `id` = ?",
    [sessionId],
  );
  if (row === null) throw new Error("session disappeared during refresh");
  const { signAccessToken } = await import("../auth/jwt.ts");
  return signAccessToken(
    {
      sub: toHexId(new Uint8Array(row.user_id)),
      act: actorType,
      role: null,
      scope: null,
      did: toHexId(new Uint8Array(row.device_id)),
      sid: toHexId(sessionId),
      amr: null,
      imp: false,
    },
    ctx.keys[0] as (typeof ctx.keys)[number],
  );
}

/** `POST /v1/auth/logout`: end this session and its refresh family. */
async function logout(ctx: Ctx): Promise<Response> {
  if (ctx.principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);
  const sessionId = uuidBytes(ctx.principal.sessionId);
  const family = await ctx.db.first<{ family_id: Uint8Array }>("SELECT `family_id` FROM `refresh_tokens` WHERE `session_id` = ? LIMIT 1", [sessionId]);
  if (family !== null) await killFamily(ctx.db, new Uint8Array(family.family_id), "LOGOUT");
  await revokeSession(ctx.db, sessionId, "LOGOUT");
  return successResponse({ loggedOut: true }, ctx.locale, ctx.requestId);
}

/** `GET /v1/auth/me`: the caller, as the client's own session screen shows them. */
async function me(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);
  const user = await ctx.db.first<{ phone: string; email: string | null; locale: string; status: string }>(
    "SELECT `phone`, `email`, `locale`, `status` FROM `users` WHERE `id` = ?",
    [uuidBytes(principal.userId)],
  );
  return successResponse(
    {
      id: principal.userId,
      actorType: principal.actorType,
      role: principal.role,
      locale: user?.locale ?? ctx.locale,
      phone: user?.phone ?? null,
      email: user?.email ?? null,
      zoneScope: principal.zoneScope,
      impersonating: principal.impersonating,
    },
    ctx.locale,
    ctx.requestId,
  );
}

/** `GET /v1/auth/sessions`: the devices this account is signed in on. */
async function sessions(ctx: Ctx): Promise<Response> {
  if (ctx.principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);
  const rows = await ctx.db.query<SessionListRow>(
    "SELECT s.`id`, s.`device_id`, s.`issued_at`, s.`last_used_at`, s.`expires_at`, s.`revoked_at`, d.`platform`, d.`model` " +
      "FROM `sessions` s LEFT JOIN `devices` d ON d.`id` = s.`device_id` " +
      "WHERE s.`user_id` = ? ORDER BY s.`last_used_at` DESC LIMIT 20",
    [uuidBytes(ctx.principal.userId)],
  );
  return successResponse(
    {
      sessions: rows.map((row) => ({
        id: toHexId(new Uint8Array(row.id)),
        platform: row.platform,
        model: row.model,
        issuedAt: row.issued_at,
        lastUsedAt: row.last_used_at,
        expiresAt: row.expires_at,
        current: toHexId(new Uint8Array(row.id)) === ctx.principal?.sessionId,
      })),
    },
    ctx.locale,
    ctx.requestId,
  );
}

/** `POST /v1/auth/logout-all`: end every session, sparing this one. */
async function logoutAll(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);
  const revoked = await revokeAllSessions(ctx.db, uuidBytes(principal.userId), "LOGOUT_ALL", uuidBytes(principal.sessionId));
  ctx.waitUntil(
    audit.appendAudit(ctx.db, {
      actorId: principal.userId,
      actorType: principal.actorType === "ADMIN" ? "ADMIN" : principal.actorType === "RIDER" ? "RIDER" : principal.actorType === "VENDOR_OWNER" ? "VENDOR" : "CUSTOMER",
      actorRole: principal.role,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      action: "customer.revoke_sessions",
      resourceType: "session",
      resourceId: principal.userId,
      subjectId: principal.userId,
      after: { revoked },
      reason: null,
      severity: "NOTICE",
    }),
  );
  ctx.waitUntil(
    audit.appendAudit(ctx.db, {
      actorId: principal.userId,
      actorType: principal.actorType === "ADMIN" ? "ADMIN" : principal.actorType === "RIDER" ? "RIDER" : principal.actorType === "VENDOR_OWNER" ? "VENDOR" : "CUSTOMER",
      actorRole: principal.role,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      action: "customer.update",
      resourceType: "user",
      resourceId: principal.userId,
      subjectId: principal.userId,
      after: { passwordChanged: true },
      reason: null,
      severity: "WARNING",
    }),
  );
  await recordSecurityEvent(ctx.db, {
    kind: "PASSWORD_CHANGED",
    severity: "NOTICE",
    actorId: uuidBytes(principal.userId),
    subjectId: uuidBytes(principal.userId),
    requestId: uuidBytes(ctx.requestId),
    detail: { revoked },
    ip: ctx.ip,
  });
  return successResponse({ revoked }, ctx.locale, ctx.requestId);
}

/** `POST /v1/auth/password`: change the password, checking policy and history. */
async function changePassword(ctx: Ctx, body: unknown): Promise<Response> {
  const principal = ctx.principal;
  if (principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);
  const input = (body ?? {}) as { currentPassword?: unknown; newPassword?: unknown; signOutOthers?: unknown };
  const current = typeof input.currentPassword === "string" ? input.currentPassword : "";
  const next = typeof input.newPassword === "string" ? input.newPassword : "";

  const user = await ctx.db.first<{ id: Uint8Array; password_hash: string | null; phone: string; email_norm: string | null }>(
    "SELECT `id`, `password_hash`, `phone`, `email_norm` FROM `users` WHERE `id` = ?",
    [uuidBytes(principal.userId)],
  );
  if (user === null || !(await verifyPassword(current, user.password_hash))) {
    return failureResponse({ code: "AUTH_INVALID_CREDENTIALS" }, ctx.locale, ctx.requestId);
  }
  const policy = checkPasswordPolicy(next, { phone: user.phone, ...(user.email_norm === null ? {} : { email: user.email_norm }) });
  if (!policy.ok) return failureResponse(policy.error, ctx.locale, ctx.requestId);

  const history = await ctx.db.query<{ password_hash: string }>(
    "SELECT `password_hash` FROM `password_history` WHERE `user_id` = ? ORDER BY `created_at` DESC LIMIT 5",
    [uuidBytes(principal.userId)],
  );
  if (user.password_hash !== null) history.unshift({ password_hash: user.password_hash });
  if (await reusesHistory(next, history.map((row) => row.password_hash), verifyPassword)) {
    return failureResponse({ code: "AUTH_PASSWORD_WEAK", field: "newPassword", details: { reason: "reuse" } }, ctx.locale, ctx.requestId);
  }

  const hashed = await hashPassword(next);
  const now = Date.now();
  // History first, then the account. A crash between the two leaves a history row for a
  // password that was never activated — harmless, and the alternative order would leave a
  // password with no history, which is the state the reuse check depends on.
  await ctx.db.execute("INSERT INTO `password_history` (`id`, `user_id`, `password_hash`, `created_at`) VALUES (?, ?, ?, ?)", [
    newUint8(16, now),
    uuidBytes(principal.userId),
    hashed,
    sqlDatetime(new Date(now)),
  ]);
  await ctx.db.execute("UPDATE `users` SET `password_hash` = ?, `updated_at` = ? WHERE `id` = ?", [
    hashed,
    sqlDatetime(new Date(now)),
    uuidBytes(principal.userId),
  ]);
  if (input.signOutOthers !== false) {
    await revokeAllSessions(ctx.db, uuidBytes(principal.userId), "PASSWORD_CHANGED", uuidBytes(principal.sessionId), now);
  }
  ctx.waitUntil(
    audit.appendAudit(ctx.db, {
      actorId: principal.userId,
      actorType: principal.actorType === "ADMIN" ? "ADMIN" : principal.actorType === "RIDER" ? "RIDER" : principal.actorType === "VENDOR_OWNER" ? "VENDOR" : "CUSTOMER",
      actorRole: principal.role,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      action: "customer.update",
      resourceType: "user",
      resourceId: principal.userId,
      subjectId: principal.userId,
      after: { passwordChanged: true },
      reason: null,
      severity: "WARNING",
    }),
  );
  await recordSecurityEvent(ctx.db, {
    kind: "PASSWORD_CHANGED",
    severity: "NOTICE",
    actorId: uuidBytes(principal.userId),
    subjectId: uuidBytes(principal.userId),
    requestId: uuidBytes(ctx.requestId),
    ip: ctx.ip,
  });
  return successResponse({ changed: true }, ctx.locale, ctx.requestId);
}

/** SHA-256 of a string, as the bytes the `login_attempts` hash columns store. */
async function sha256Bytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

/** The auth routes, in the order the API document lists them. */
export const AUTH_ROUTES: readonly RouteDefinition[] = [
  { method: "POST", path: "/v1/auth/login", permission: "*", group: "AUTH", maxBodyBytes: 8 * 1024, run: (ctx, input) => login(ctx, input.body) },
  { method: "POST", path: "/v1/auth/refresh", permission: "*", group: "AUTH", maxBodyBytes: 4 * 1024, run: (ctx, input) => refresh(ctx, input.body) },
  { method: "POST", path: "/v1/auth/logout", permission: "customer.read", write: true, group: "AUTH", run: (ctx) => logout(ctx) },
  { method: "POST", path: "/v1/auth/logout-all", permission: "customer.read", write: true, group: "AUTH", run: (ctx) => logoutAll(ctx) },
  { method: "POST", path: "/v1/auth/password", permission: "customer.read", write: true, group: "AUTH", maxBodyBytes: 8 * 1024, run: (ctx, input) => changePassword(ctx, input.body) },
  { method: "GET", path: "/v1/auth/me", permission: "customer.read", group: "AUTH", run: (ctx) => me(ctx) },
  { method: "GET", path: "/v1/auth/sessions", permission: "customer.view_sessions", group: "AUTH", run: (ctx) => sessions(ctx) },
];
