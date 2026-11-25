/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The fleet routes an operator reads.
 *
 * Two readers and no switches yet, on purpose. A list and a profile are safe to add because they
 * change nothing; suspending a rider, editing a zone assignment and resetting a password are all
 * step-up actions with consequences a support conversation exists to handle, and each of them gets
 * its own route with its own audit reason rather than arriving in a batch nobody reviewed.
 *
 * The balance travels with the row because it is the number a supervisor is actually looking for:
 * a rider in `CASH_LOCKED` is a rider who cannot earn, and the amount is what decides whether that
 * is a five-minute conversation or an escalation.
 */

import { failureResponse, successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { uuidBytes } from "../middleware/auth.ts";
import { toHexId } from "../lib/ids.ts";
import { decodeCursor, encodeCursor } from "../lib/cursor.ts";
import {
  isRiderShiftState,
  isRiderStatus,
  listAdminRiders,
  type AdminRiderRow,
} from "../repositories/riders-admin.ts";

/** The page sizes the list accepts. */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

/** A rider as the console reads it. Contact details are absent; see `rider.view_contacts`. */
function serialiseRider(row: AdminRiderRow): Record<string, unknown> {
  return {
    id: toHexId(row.id),
    code: row.code,
    name: row.full_name,
    vehicle: row.vehicle,
    zoneId: toHexId(row.home_zone_id),
    status: row.status,
    shiftState: row.shift_state,
    payoutMethod: row.payout_method,
    approvedAt: row.approved_at,
    outstandingPayoutPaisa: Number(row.outstanding_paisa),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** A `422` that names the parameter the caller has to fix. */
function invalid(ctx: Ctx, field: string): Response {
  return failureResponse({ code: "VALIDATION_FAILED", details: { field } }, ctx.locale, ctx.requestId);
}

/** `GET /v1/riders`: the fleet list. */
async function listRiders(ctx: Ctx): Promise<Response> {
  const params = ctx.url.searchParams;

  const rawStatus = params.get("status");
  if (rawStatus !== null && !isRiderStatus(rawStatus.toUpperCase())) return invalid(ctx, "status");

  const rawShift = params.get("shiftState");
  if (rawShift !== null && !isRiderShiftState(rawShift.toUpperCase())) return invalid(ctx, "shiftState");

  const rawLimit = Number(params.get("limit") ?? DEFAULT_LIMIT);
  if (!Number.isFinite(rawLimit) || rawLimit < 1 || rawLimit > MAX_LIMIT) return invalid(ctx, "limit");
  const limit = Math.floor(rawLimit);

  let zoneId: Uint8Array | null = null;
  const rawZone = params.get("zoneId");
  if (rawZone !== null) {
    try {
      zoneId = uuidBytes(rawZone);
    } catch {
      return failureResponse({ code: "VALIDATION_ID_MALFORMED", field: "zoneId" }, ctx.locale, ctx.requestId);
    }
  }

  const rawCursor = params.get("cursor");
  const cursor = rawCursor === null ? null : decodeCursor(rawCursor);
  if (rawCursor !== null && cursor === null) return invalid(ctx, "cursor");

  const rows = await listAdminRiders(ctx.db, {
    status: rawStatus === null ? null : (rawStatus.toUpperCase() as Parameters<typeof listAdminRiders>[1]["status"]),
    shiftState: rawShift === null ? null : (rawShift.toUpperCase() as Parameters<typeof listAdminRiders>[1]["shiftState"]),
    q: params.get("q"),
    zoneId,
    cursor,
    limit,
  });
  const last = rows[rows.length - 1];
  return successResponse(
    {
      riders: rows.map(serialiseRider),
      // The header the fleet screen shows, counted over this page: how many are online, how many
      // are locked, and how much cash is being carried by the people in the list.
      summary: {
        total: rows.length,
        online: rows.filter((row) => row.shift_state === "ONLINE" || row.shift_state === "ON_ORDER").length,
        cashLocked: rows.filter((row) => row.shift_state === "CASH_LOCKED").length,
        outstandingPaisa: rows.reduce((sum, row) => sum + Number(row.outstanding_paisa), 0),
        limit,
      },
      nextCursor: rows.length === limit && last !== undefined ? encodeCursor(last.created_at, toHexId(last.id)) : null,
    },
    ctx.locale,
    ctx.requestId,
  );
}

/**
 * The fleet routes.
 *
 * One route, not two. A rider profile needs a "no such rider" code and the error registry has none
 * — it has a code for a missing order, offer, quote, zone, menu item and cash declaration, but a
 * rider read has until now only ever been a rider reading themselves. Adding a 188th code would
 * change the contract the specification fixes at 187, so the detail route waits for that decision
 * instead of borrowing `SHIFT_NOT_FOUND` and lying to a support agent.
 */
export const RIDER_ADMIN_ROUTES: readonly RouteDefinition[] = [
  { method: "GET", path: "/v1/riders", permission: "rider.list", group: "ADMIN_WRITE", run: (ctx) => listRiders(ctx) },
];
