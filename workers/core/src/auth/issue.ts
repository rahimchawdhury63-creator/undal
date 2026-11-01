/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Ctx } from "../middleware/context.ts";
import { uuidBytes } from "../middleware/auth.ts";
import { newId, toHexId } from "../lib/ids.ts";
import { fail, ok, type Result } from "../lib/result.ts";
import { sqlDatetime } from "../db/time.ts";
import { signAccessToken, ACCESS_TOKEN_TTL } from "./jwt.ts";
import { SESSION_LIMITS, createSession } from "./sessions.ts";
import { startFamily } from "./refresh-rotation.ts";

/**
 * Logging somebody in, in one place: device row, session row, refresh family, token.
 *
 * The step order matters because each row references the previous one, and the device
 * cap is checked before anything is written — a rider whose second phone is refused must
 * not end up with a session row that has no device.
 */

/** What a caller must supply to sign somebody in. */
export interface IssueInput {
  readonly userId: Uint8Array;
  readonly userIdHex: string;
  readonly actorType: "CUSTOMER" | "VENDOR_OWNER" | "RIDER" | "ADMIN";
  readonly role: string | null;
  readonly zoneScope: readonly string[] | null;
  readonly fingerprint: string;
  readonly platform: "ANDROID" | "WEB";
  readonly ip: string;
  readonly userAgent: string;
  readonly nowMs?: number;
}

/** The tokens a successful login returns. */
export interface Issued {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}

/**
 * Register (or reuse) the device, then open a session on it.
 *
 * A rider is allowed exactly one device: a rider account on two phones is a fraud signal,
 * and the check is a count against the devices table rather than a claim in the token,
 * because the second phone would otherwise carry a token that looks perfectly valid.
 */
export async function issueTokens(ctx: Ctx, input: IssueInput): Promise<Result<Issued>> {
  const now = input.nowMs ?? Date.now();
  const limit = SESSION_LIMITS[input.actorType];

  const existing = await ctx.db.first<{ id: Uint8Array }>(
    "SELECT `id` FROM `devices` WHERE `user_id` = ? AND `fingerprint` = ?",
    [input.userId, input.fingerprint],
  );
  let deviceId: Uint8Array;
  if (existing !== null) {
    deviceId = new Uint8Array(existing.id);
    await ctx.db.execute("UPDATE `devices` SET `last_seen_at` = ?, `updated_at` = ? WHERE `id` = ?", [
      sqlDatetime(new Date(now)),
      sqlDatetime(new Date(now)),
      deviceId,
    ]);
  } else {
    const count = await ctx.db.first<{ devices: number | string }>("SELECT COUNT(*) AS devices FROM `devices` WHERE `user_id` = ?", [input.userId]);
    if (Number(count?.devices ?? 0) >= limit.maxDevices) {
      return fail("AUTH_DEVICE_MISMATCH", { details: { maxDevices: limit.maxDevices } });
    }
    deviceId = newId(now);
    await ctx.db.execute(
      "INSERT INTO `devices` (`id`, `user_id`, `platform`, `fingerprint`, `first_seen_at`, `last_seen_at`, `updated_at`) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [deviceId, input.userId, input.platform, input.fingerprint, sqlDatetime(new Date(now)), sqlDatetime(new Date(now)), sqlDatetime(new Date(now))],
    );
  }

  const expiresAt = new Date(now + limit.accessMinutes * 60_000);
  const session = await createSession(ctx.db, {
    userId: input.userId,
    deviceId,
    ip: input.ip,
    userAgent: input.userAgent,
    expiresAt,
    nowMs: now,
  });
  const family = await startFamily(ctx.db, { sessionId: uuidBytes(session.sessionId), actorType: input.actorType, nowMs: now });

  const accessToken = await signAccessToken(
    {
      sub: input.userIdHex,
      act: input.actorType,
      role: input.role,
      scope: input.zoneScope,
      did: toHexId(deviceId),
      sid: session.sessionId,
      amr: null,
      imp: false,
    },
    ctx.keys[0] as (typeof ctx.keys)[number],
    { nowMs: now, ttlSeconds: ACCESS_TOKEN_TTL[input.actorType] },
  );

  return ok({ accessToken, refreshToken: family.token, expiresIn: ACCESS_TOKEN_TTL[input.actorType] });
}
