/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import * as audit from "../audit/write.ts";
import { createRealtimeClient } from "../bindings/realtime.ts";
import { newId, toHexId } from "../lib/ids.ts";
import { sqlDatetime } from "../db/time.ts";
import { failureResponse, successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { uuidBytes } from "../middleware/auth.ts";
import { parsePointE7 } from "../domain/order/distance.ts";
import {
  deleteShift,
  findRiderByUserId,
  insertShift,
  openShiftFor,
  setShiftState,
  zoneIsAssigned,
} from "../repositories/riders.ts";

/**
 * Beginning a shift: `POST /v1/rider/shift/start` (`08 §8`, D109).
 *
 * This is the route the whole live-tracking channel hangs from. Before it existed a rider could not open a
 * shift at all, so `rider_current` was never seeded, so the first flush of every shift was refused with
 * `SHIFT_NOT_OPEN` — the ingest route was correct and unreachable at the same time.
 *
 * Four things must be true, and each has its own refusal so the app can deep-link the screen that fixes it
 * (`19 §3`):
 *
 * 1. **The token resolves to a rider.** The row is found by `user_id`, never by a rider id in the body.
 * 2. **The rider is approved.** `riders.status = 'APPROVED'`. An application still under review is
 *    `SHIFT_KYC_PENDING`; a suspended account is `AUTH_ACCOUNT_SUSPENDED`.
 * 3. **The rider has no open shift.** A second tap is `SHIFT_ALREADY_OPEN` with the shift id, because the
 *    alternative — quietly returning the open one — hides a stale shift forever.
 * 4. **The zone is theirs.** The home zone always is; any other zone needs a live `rider_zone_assignments` row.
 *
 * **The selfie is required and is not verified here.** `19 §3.1` verifies on the device (a face, eyes open,
 * liveness) and samples 10% plus every first shift for a human afterwards, so the API's job is to require that
 * a selfie exists and record that it was accepted at the door. `SHIFT_SELFIE_REQUIRED` is the refusal.
 *
 * **The live row is written before the answer, and a failure unwinds the shift.** A shift that exists in TiDB
 * but not in D1 is a rider who is online to dispatch and invisible on the map, whose every flush is refused —
 * the worst of both halves, and impossible for the rider to detect or fix. So the seed is synchronous and
 * failure undoes the row: a shift that cannot be tracked does not exist, and the rider taps again.
 */

/** The selfie URL is a `VARCHAR(512)` and must be an https URL: the app uploads to imgbb (`26`). */
export const MAX_SELFIE_URL = 512;

/** The shift start body, or the field that is wrong with it. */
type Parsed =
  | { readonly ok: true; readonly selfieUrl: string; readonly latE7: number; readonly lonE7: number; readonly zoneId: string | null }
  | { readonly ok: false; readonly field: string };

/** Read a shift-start body. `zoneId` is optional: the rider's home zone is the default. */
export function readShiftStart(raw: unknown): Parsed {
  const body = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const selfieUrl = body["selfieUrl"];
  if (typeof selfieUrl !== "string" || selfieUrl.length === 0 || selfieUrl.length > MAX_SELFIE_URL) {
    return { ok: false, field: "selfieUrl" };
  }
  let url: URL;
  try {
    url = new URL(selfieUrl);
  } catch {
    return { ok: false, field: "selfieUrl" };
  }
  if (url.protocol !== "https:") return { ok: false, field: "selfieUrl" };

  const point = parsePointE7(body["point"]);
  if (point === null) return { ok: false, field: "point" };

  const rawZone = body["zoneId"];
  if (rawZone !== undefined && typeof rawZone !== "string") return { ok: false, field: "zoneId" };
  return {
    ok: true,
    selfieUrl,
    latE7: point.latE7,
    lonE7: point.lonE7,
    zoneId: typeof rawZone === "string" ? rawZone : null,
  };
}

/** Start a shift. */
async function startShift(ctx: Ctx, body: unknown): Promise<Response> {
  const principal = ctx.principal;
  if (principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);

  const parsed = readShiftStart(body);
  if (!parsed.ok) {
    const code = parsed.field === "selfieUrl" ? "SHIFT_SELFIE_REQUIRED" : "VALIDATION_FAILED";
    return failureResponse({ code, details: { field: parsed.field } }, ctx.locale, ctx.requestId);
  }

  let userBytes: Uint8Array;
  try {
    userBytes = uuidBytes(principal.userId);
  } catch {
    return failureResponse({ code: "PERM_DENIED", details: { reason: "not_a_rider" } }, ctx.locale, ctx.requestId);
  }

  const rider = await findRiderByUserId(ctx.db, userBytes);
  // A token that says RIDER and resolves to no rider is a broken account, not a missing resource: there is no
  // rider id to name in the refusal, and inventing a 404 would send the app to a screen that does not exist.
  if (rider === null) {
    return failureResponse({ code: "PERM_DENIED", details: { reason: "not_a_rider" } }, ctx.locale, ctx.requestId);
  }
  if (rider.status === "SUSPENDED") {
    return failureResponse({ code: "AUTH_ACCOUNT_SUSPENDED", details: { reason: "rider_suspended" } }, ctx.locale, ctx.requestId);
  }
  if (rider.status !== "APPROVED") {
    return failureResponse({ code: "SHIFT_KYC_PENDING" }, ctx.locale, ctx.requestId);
  }

  const open = await openShiftFor(ctx.db, rider.id);
  if (open !== null) {
    return failureResponse({ code: "SHIFT_ALREADY_OPEN", details: { shift_id: toHexId(open.id) } }, ctx.locale, ctx.requestId);
  }

  // The zone: the rider's own by default, any other only by a live assignment.
  let zoneId = rider.homeZoneId;
  if (parsed.zoneId !== null) {
    let requested: Uint8Array;
    try {
      requested = uuidBytes(parsed.zoneId);
    } catch {
      return failureResponse({ code: "VALIDATION_FAILED", details: { field: "zoneId" } }, ctx.locale, ctx.requestId);
    }
    if (toHexId(requested) !== toHexId(rider.homeZoneId) && !(await zoneIsAssigned(ctx.db, rider.id, requested))) {
      return failureResponse({ code: "SHIFT_ZONE_NOT_ASSIGNED", details: { zone_id: parsed.zoneId } }, ctx.locale, ctx.requestId);
    }
    zoneId = requested;
  }

  const nowMs = Date.now();
  const shiftId = newId(nowMs);
  await insertShift(ctx.db, {
    id: shiftId,
    riderId: rider.id,
    zoneId,
    startedAt: sqlDatetime(new Date(nowMs)),
    selfieUrl: parsed.selfieUrl,
    startLatE7: parsed.latE7,
    startLonE7: parsed.lonE7,
  });
  await setShiftState(ctx.db, rider.id, "ONLINE");

  // The seed, before the answer: without it every flush of this shift is refused (D108). A failure here is a
  // shift that cannot be tracked, so the row is undone rather than left to look like a shift that can.
  const base = ctx.env.REALTIME_BASE;
  const token = ctx.env.INTERNAL_TOKEN;
  const seeded =
    base === undefined || token === undefined
      ? null
      : await createRealtimeClient(base, token).openShift({
          riderId: toHexId(rider.id),
          shiftId: toHexId(shiftId),
          zoneId: toHexId(zoneId),
          vehicle: rider.vehicle,
          point: { lat: parsed.latE7 / 1e7, lon: parsed.lonE7 / 1e7 },
        });
  if (seeded === null || !seeded.ok) {
    await deleteShift(ctx.db, shiftId);
    await setShiftState(ctx.db, rider.id, "OFFLINE");
    return failureResponse(
      { code: "SERVICE_DEGRADED", details: { component: "realtime", reason: "live_position_unavailable" } },
      ctx.locale,
      ctx.requestId,
    );
  }

  await audit.appendAudit(ctx.db, {
    actorId: principal.userId,
    actorType: "RIDER",
    actorRole: principal.role,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    action: "rider.shift.start",
    resourceType: "RIDER_SHIFT",
    resourceId: toHexId(shiftId),
    subjectId: toHexId(rider.id),
    before: { shiftState: rider.shiftState },
    after: { shiftState: "ONLINE", zoneId: toHexId(zoneId), vehicle: rider.vehicle },
    reason: null,
    severity: "NOTICE",
  }, nowMs);

  return successResponse(
    {
      shiftId: toHexId(shiftId),
      riderId: toHexId(rider.id),
      zoneId: toHexId(zoneId),
      vehicle: rider.vehicle,
      shiftState: "ONLINE",
      startedAt: new Date(nowMs).toISOString(),
    },
    ctx.locale,
    ctx.requestId,
  );
}

/** The shift routes. */
export const SHIFT_ROUTES: readonly RouteDefinition[] = [
  {
    method: "POST",
    path: "/v1/rider/shift/start",
    permission: "rider.shift.start",
    write: true,
    group: "PRESENCE",
    maxBodyBytes: 4_096,
    run: async (ctx, input) => startShift(ctx, input.body),
  },
];
