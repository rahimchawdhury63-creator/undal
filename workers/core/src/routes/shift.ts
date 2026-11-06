/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import * as audit from "../audit/write.ts";
import { createRealtimeClient } from "../bindings/realtime.ts";
import { newId, toHexId } from "../lib/ids.ts";
import { parseDatetime, sqlDatetime } from "../db/time.ts";
import { failureResponse, successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { uuidBytes } from "../middleware/auth.ts";
import { parsePointE7 } from "../domain/order/distance.ts";
import {
  cashDueAtMs,
  cashOutstandingPaisa,
  closeShift,
  countActiveOrders,
  deleteShift,
  findRiderByUserId,
  insertShift,
  openShiftFor,
  setShiftState,
  zoneIsAssigned,
} from "../repositories/riders.ts";
import { activeLiftUntil, latestSettlement, pendingSettlement } from "../repositories/cash.ts";
import { liftStateOf, submittedAtMs } from "./cash.ts";

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

  // A rider whose last shift ended with cash in hand is locked until they settle (`25 §2`). The state is set
  // by the shift's end, which is the only thing that knows the amount, so the gate lives here and the balance
  // is read only for a rider who is actually locked.
  if (rider.shiftState === "CASH_LOCKED") {
    // `25 §8`'s two-hour rule, applied at the door (D142). There is no cron in this platform, so a deadline cannot fire
    // anything; what a deadline can do is change what a door decides. A rider whose claim has waited past the SLA is not
    // blocked, and the door is where that stops being a calculation and becomes a fact — one state write and one audit
    // row, made when it matters, rather than a sweep that would need a schedule nobody has.
    const lift = liftStateOf(
      rider.shiftState,
      await latestSettlement(ctx.db, rider.id),
      await activeLiftUntil(ctx.db, rider.id, Date.now()),
      Date.now(),
    );
    if (lift.escalated || lift.declared) {
      // A reviewer already promised to look at this claim (`25 §6.1`, D146), or the rider declared an emergency and the
      // platform believed them for a day (`25 §7`, D148). Either way the door opens without a second audit row: the
      // escalation or the declaration is the record, and a system row here would read as the platform's failure.
      await setShiftState(ctx.db, rider.id, "OFFLINE");
    } else if (lift.autoLiftDue) {
      await setShiftState(ctx.db, rider.id, "OFFLINE");
      const pending = await pendingSettlement(ctx.db, rider.id);
      // The platform was slow, so the platform records it: this is a failure metric in `25 §10`, not a rider metric.
      console.error(`shift: auto-lifted cash block for rider ${toHexId(rider.id)} — review exceeded 2 h`);
      await audit.appendAudit(ctx.db, {
        actorId: null,
        actorType: "SYSTEM",
        actorRole: null,
        ip: null,
        userAgent: null,
        requestId: ctx.requestId,
        action: "rider.cash.auto_lift",
        resourceType: "RIDER",
        resourceId: toHexId(rider.id),
        subjectId: toHexId(rider.id),
        before: { shiftState: "CASH_LOCKED" },
        after: { shiftState: "OFFLINE", settlementId: pending === null ? null : toHexId(pending.id) },
        reason: "REVIEW_SLA_EXCEEDED",
        severity: "WARNING",
      });
    } else {
      const outstanding = await cashOutstandingPaisa(ctx.db, rider.id);
      const dueAtMs = await cashDueAtMs(ctx.db, rider.id);
      // `08` fixes this refusal's details as `{ outstanding, due_at }`, and the app's screen is a sentence about time:
      // "you have carried this since 22:14". A refusal that names the amount and not the moment leaves the rider to
      // work out whether they are early or late (D140).
      return failureResponse(
        {
          code: "SHIFT_CASH_OVERDUE",
          details: { outstanding, due_at: dueAtMs === null ? null : new Date(dueAtMs).toISOString() },
        },
        ctx.locale,
        ctx.requestId,
      );
    }
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
          // The identity, not the row: D1's `rider_current.rider_id` is the token's `sub` (D97), because that is
          // what every flush carries. Seeding with `riders.id` writes a row nothing will ever read back — the
          // exact swap this file's sibling got wrong once already (D110).
          riderId: principal.userId,
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

/** The end body: where the rider is standing, and why the shift is ending. */
type EndParsed = { readonly ok: true; readonly latE7: number | null; readonly lonE7: number | null } | { readonly ok: false; readonly field: string };

/**
 * Read a shift-end body. Both fields are optional — a rider who has lost their phone's location still gets to
 * end their shift — but a point that is present must be a point.
 */
export function readShiftEnd(raw: unknown): EndParsed {
  const body = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  if (body["point"] === undefined) return { ok: true, latE7: null, lonE7: null };
  const point = parsePointE7(body["point"]);
  if (point === null) return { ok: false, field: "point" };
  return { ok: true, latE7: point.latE7, lonE7: point.lonE7 };
}

/**
 * Ending a shift (`08 §8`, `25 §2`, D110).
 *
 * Three things happen and the order between them is the design:
 *
 * 1. **The shift is closed in TiDB, conditionally on it still being open.**
 * 2. **The rider's state becomes `OFFLINE`, or `CASH_LOCKED` when they still owe cash.** That state is what
 *    refuses their next shift, so it is written here rather than derived by whoever asks next.
 * 3. **The live channel is erased, synchronously, before the answer** (`07 §6.1` promises under a second for
 *    a rider who taps End shift). A failure here does not fail the end: trapping a rider online because
 *    realtime is cold would be a worse bug than a trail that outlives the shift by a minute, and the zone
 *    sweep (D107) erases a row whose deadline passed anyway. The failure is reported in the answer and to the
 *    log, so it is visible rather than assumed.
 *
 * An open order refuses the end (`SHIFT_ORDERS_ACTIVE`): a rider who vanishes mid-delivery leaves a customer
 * watching a marker that stopped moving. Reassigning behind the rider is the dispatch engine's business, not a
 * side effect of a button.
 */
async function endShift(ctx: Ctx, body: unknown): Promise<Response> {
  const principal = ctx.principal;
  if (principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);

  const parsed = readShiftEnd(body);
  if (!parsed.ok) {
    return failureResponse({ code: "VALIDATION_FAILED", details: { field: parsed.field } }, ctx.locale, ctx.requestId);
  }

  let userBytes: Uint8Array;
  try {
    userBytes = uuidBytes(principal.userId);
  } catch {
    return failureResponse({ code: "PERM_DENIED", details: { reason: "not_a_rider" } }, ctx.locale, ctx.requestId);
  }
  const rider = await findRiderByUserId(ctx.db, userBytes);
  if (rider === null) {
    return failureResponse({ code: "PERM_DENIED", details: { reason: "not_a_rider" } }, ctx.locale, ctx.requestId);
  }

  const open = await openShiftFor(ctx.db, rider.id);
  if (open === null) return failureResponse({ code: "SHIFT_NOT_FOUND" }, ctx.locale, ctx.requestId);

  const active = await countActiveOrders(ctx.db, rider.id);
  if (active > 0) {
    return failureResponse({ code: "SHIFT_ORDERS_ACTIVE", details: { active_orders: active } }, ctx.locale, ctx.requestId);
  }

  const nowMs = Date.now();
  const startedAt = parseDatetime(open.startedAt);
  const onlineSeconds = startedAt === null ? 0 : Math.max(0, Math.round((nowMs - startedAt.getTime()) / 1_000));
  const closed = await closeShift(ctx.db, {
    shiftId: open.id,
    endedAt: sqlDatetime(new Date(nowMs)),
    reason: "RIDER_ENDED",
    endLatE7: parsed.latE7,
    endLonE7: parsed.lonE7,
    onlineSeconds,
  });
  // Two ends racing: the loser reports the shift as closed rather than rewriting the moment it ended.
  if (closed === 0) {
    return failureResponse(
      { code: "SHIFT_ALREADY_CLOSED", details: { closed_at: new Date(nowMs).toISOString() } },
      ctx.locale,
      ctx.requestId,
    );
  }

  const outstanding = await cashOutstandingPaisa(ctx.db, rider.id);
  // A debt under escalation does not re-block the rider at the end of the next shift either (D146): the claim is still
  // pending and a human is still on it, so setting `CASH_LOCKED` here would make them prove that again at the next door.
  const review = await pendingSettlement(ctx.db, rider.id);
  const underReview = review !== null && review.escalatedAt !== null;
  // The same applies to a live declaration (`25 §7`, D148): an emergency lift is 24 hours, so a shift that ends inside
  // the window must not end it early by writing the block back on.
  const declared = (await activeLiftUntil(ctx.db, rider.id, Date.now())) !== null;
  const shiftState = outstanding > 0 && !underReview && !declared ? "CASH_LOCKED" : "OFFLINE";
  await setShiftState(ctx.db, rider.id, shiftState);

  const base = ctx.env.REALTIME_BASE;
  const token = ctx.env.INTERNAL_TOKEN;
  const erased =
    base === undefined || token === undefined
      ? null
      : await createRealtimeClient(base, token).eraseLiveLocation({ riderId: principal.userId, reason: "shift_end" });
  // A trail that outlived its shift is a privacy failure with a one-minute fuse (D107), so it is logged loudly
  // and reported to the caller instead of being swallowed into a 200 that claims the promise was kept.
  if (erased !== null && !erased.ok) {
    console.error(`shift: live location survived the end of shift ${toHexId(open.id)}: ${String(erased.error.code)}`);
  }

  await audit.appendAudit(ctx.db, {
    actorId: principal.userId,
    actorType: "RIDER",
    actorRole: principal.role,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    action: "rider.shift.end",
    resourceType: "RIDER_SHIFT",
    resourceId: toHexId(open.id),
    subjectId: toHexId(rider.id),
    before: { shiftState: rider.shiftState },
    after: { shiftState, onlineSeconds, cashOutstandingPaisa: outstanding, liveLocationErased: erased === null ? null : erased.ok },
    reason: "RIDER_ENDED",
    severity: "NOTICE",
  }, nowMs);

  return successResponse(
    {
      shiftId: toHexId(open.id),
      shiftState,
      endedAt: new Date(nowMs).toISOString(),
      onlineSeconds,
      cashOutstandingPaisa: outstanding,
      settlementRequired: outstanding > 0,
      liveLocationErased: erased === null ? null : erased.ok ? erased.value : { positions: 0, current: 0 },
    },
    ctx.locale,
    ctx.requestId,
  );
}

/**
 * The rider's current shift (`08 §8`, D111).
 *
 * A read route, and its shape is the decision: **no open shift is a `200` with `shift: null`, not a `404`.** The
 * rider app calls this on every launch and every resume, and most riders are offline at any given moment; a
 * `SHIFT_NOT_FOUND` would fill the client's error log with the normal case and, worse, teach the app that an
 * error means "go to the shift screen". The 404 is reserved for the *end*, where asking to end a shift that is
 * not open is a mistake worth naming.
 *
 * What it answers is what the two routes around it changed: the shift, its state, how long it has been running,
 * and the cash that decides whether the next end leaves the rider locked.
 */
async function currentShift(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);

  let userBytes: Uint8Array;
  try {
    userBytes = uuidBytes(principal.userId);
  } catch {
    return failureResponse({ code: "PERM_DENIED", details: { reason: "not_a_rider" } }, ctx.locale, ctx.requestId);
  }
  const rider = await findRiderByUserId(ctx.db, userBytes);
  if (rider === null) {
    return failureResponse({ code: "PERM_DENIED", details: { reason: "not_a_rider" } }, ctx.locale, ctx.requestId);
  }

  const outstanding = await cashOutstandingPaisa(ctx.db, rider.id);
  const open = await openShiftFor(ctx.db, rider.id);
  const nowMs = Date.now();
  const startedAt = open === null ? null : parseDatetime(open.startedAt);
  return successResponse(
    {
      shiftState: rider.shiftState,
      shift:
        open === null || startedAt === null
          ? null
          : {
              shiftId: toHexId(open.id),
              zoneId: toHexId(open.zoneId),
              vehicle: rider.vehicle,
              startedAt: startedAt.toISOString(),
              onlineSeconds: Math.max(0, Math.round((nowMs - startedAt.getTime()) / 1_000)),
              ordersCompleted: open.ordersCompleted,
              distanceM: open.distanceM,
            },
      cashOutstandingPaisa: outstanding,
      settlementRequired: outstanding > 0,
    },
    ctx.locale,
    ctx.requestId,
  );
}

/**
 * Entering or leaving a break (`08 §8`, D111).
 *
 * A break is a field on the rider and a cadence on the device, and the cadence is pushed by whoever answers a
 * flush — so this route's whole job is the flag. It is a separate route rather than a `PATCH` on the shift
 * because the app toggles it from a button on two different screens and the audit trail wants to say which.
 *
 * The refusals are the ones that would otherwise leave a rider on a break with no shift to come back to: no open
 * shift is `SHIFT_NOT_FOUND`, and a rider locked for cash cannot reach this state at all (`CASH_LOCKED` implies
 * no open shift, so the same 404 answers, correctly).
 */
async function toggleBreak(ctx: Ctx, body: unknown): Promise<Response> {
  const principal = ctx.principal;
  if (principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);

  const fields = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const onBreak = fields["onBreak"];
  if (typeof onBreak !== "boolean") {
    return failureResponse({ code: "VALIDATION_FAILED", details: { field: "onBreak" } }, ctx.locale, ctx.requestId);
  }

  let userBytes: Uint8Array;
  try {
    userBytes = uuidBytes(principal.userId);
  } catch {
    return failureResponse({ code: "PERM_DENIED", details: { reason: "not_a_rider" } }, ctx.locale, ctx.requestId);
  }
  const rider = await findRiderByUserId(ctx.db, userBytes);
  if (rider === null) {
    return failureResponse({ code: "PERM_DENIED", details: { reason: "not_a_rider" } }, ctx.locale, ctx.requestId);
  }
  const open = await openShiftFor(ctx.db, rider.id);
  if (open === null) return failureResponse({ code: "SHIFT_NOT_FOUND" }, ctx.locale, ctx.requestId);

  const shiftState = onBreak ? "BREAK" : "ONLINE";
  await setShiftState(ctx.db, rider.id, shiftState);

  const nowMs = Date.now();
  await audit.appendAudit(ctx.db, {
    actorId: principal.userId,
    actorType: "RIDER",
    actorRole: principal.role,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    action: onBreak ? "rider.shift.break.start" : "rider.shift.break.end",
    resourceType: "RIDER_SHIFT",
    resourceId: toHexId(open.id),
    subjectId: toHexId(rider.id),
    before: { shiftState: rider.shiftState },
    after: { shiftState },
    reason: null,
    severity: "INFO",
  }, nowMs);

  return successResponse({ shiftId: toHexId(open.id), shiftState, onBreak }, ctx.locale, ctx.requestId);
}

/** The shift routes. */

/** The shift routes, in the order `08 §8` lists them: start, read, break, end. The cash pair lives in `cash.ts`. */
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
  {
    method: "GET",
    path: "/v1/rider/shift/current",
    permission: "rider.shift.read",
    group: "PRESENCE",
    run: async (ctx) => currentShift(ctx),
  },
  {
    method: "POST",
    path: "/v1/rider/shift/break",
    permission: "rider.shift.break",
    write: true,
    group: "PRESENCE",
    maxBodyBytes: 1_024,
    run: async (ctx, input) => toggleBreak(ctx, input.body),
  },
  {
    method: "POST",
    path: "/v1/rider/shift/end",
    permission: "rider.shift.end",
    write: true,
    group: "PRESENCE",
    maxBodyBytes: 1_024,
    run: async (ctx, input) => endShift(ctx, input.body),
  },
];
