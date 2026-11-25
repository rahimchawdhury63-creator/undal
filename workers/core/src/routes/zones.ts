/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The zone routes an operator uses.
 *
 * Two readers and two switches. A zone is the platform's unit of delivery: pause it and the area
 * stops taking orders; reopen it and the area comes back. Both switches are narrow on purpose —
 * drawing a new boundary is `zone.polygon.update`, a step-up action with its own permission, and
 * nothing here can move a line on a map.
 *
 * Two refusals carry the weight:
 *
 *  - A zone with live orders cannot be paused. The customer has paid, the kitchen has accepted, and
 *    a switch that stops the platform mid-delivery is a promise broken with no sentence to explain
 *    it — so the caller is told how many orders are in flight and can cancel them properly first.
 *  - A pause must name a reason the register accepts (`ZONE_UNSAFE`, `WEATHER_EMERGENCY`, or one of
 *    the operational codes). "Something came up" is not a reason a reviewer can group by, and the
 *    audit row is read months later by somebody who was not in the room.
 *
 * Reopening a zone that is already active succeeds and writes nothing: the operator's intent is
 * "running", the zone is running, and a refusal would only invite a second click.
 */

import { failureResponse, successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { uuidBytes } from "../middleware/auth.ts";
import { toHexId } from "../lib/ids.ts";
import { sqlDatetime } from "../db/time.ts";
import * as audit from "../audit/write.ts";
import type { ActorType } from "../audit/types.ts";
import { reasonAllowed, reasonsFor } from "../audit/reasons.ts";
import {
  countLiveOrdersInZone,
  findAdminZone,
  findZonePolygon,
  isZoneStatus,
  listAdminZones,
  setZoneStatus,
  type AdminZoneRow,
  type ZoneStatus,
} from "../repositories/zones-admin.ts";

/** The audit register's word for the caller. */
function actorTypeOf(ctx: Ctx): ActorType {
  switch (ctx.principal?.actorType) {
    case "VENDOR_OWNER":
      return "VENDOR";
    case "CUSTOMER":
      return "CUSTOMER";
    case "RIDER":
      return "RIDER";
    default:
      return "ADMIN";
  }
}

/** The page sizes the list accepts. */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;

/** The longest note an operator may attach to a switch, in characters. */
const MAX_NOTE_LENGTH = 200;

/** A zone as the console reads it. */
function serialiseZone(row: AdminZoneRow): Record<string, unknown> {
  return {
    id: toHexId(row.id),
    code: row.code,
    name: row.name,
    nameBn: row.name_bn,
    city: row.city,
    country: row.country,
    currency: row.currency,
    timezone: row.timezone,
    status: row.status,
    areaSqKm: Number(row.area_sq_km),
    polygonVersion: Number(row.polygon_version),
    centre: { latE7: Number(row.centroid_lat_e7), lonE7: Number(row.centroid_lon_e7) },
    counts: { vendors: Number(row.vendor_count), riders: Number(row.rider_count) },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** A `422` that names the field the caller has to fix. */
function invalid(ctx: Ctx, field: string): Response {
  return failureResponse({ code: "VALIDATION_FAILED", details: { field } }, ctx.locale, ctx.requestId);
}

/** Parse a path id, or answer with the `422` the corpus reserves for a malformed one. */
function parseId(ctx: Ctx, raw: string): Uint8Array | Response {
  try {
    return uuidBytes(raw);
  } catch {
    return failureResponse({ code: "VALIDATION_ID_MALFORMED", field: "id" }, ctx.locale, ctx.requestId);
  }
}

/** `GET /v1/zones`: the operator's list. */
async function listZones(ctx: Ctx): Promise<Response> {
  const params = ctx.url.searchParams;
  const rawStatus = params.get("status");
  if (rawStatus !== null && !isZoneStatus(rawStatus.toUpperCase())) return invalid(ctx, "status");

  const rawLimit = Number(params.get("limit") ?? DEFAULT_LIMIT);
  if (!Number.isFinite(rawLimit) || rawLimit < 1 || rawLimit > MAX_LIMIT) return invalid(ctx, "limit");

  const rows = await listAdminZones(ctx.db, {
    status: rawStatus === null ? null : (rawStatus.toUpperCase() as ZoneStatus),
    q: params.get("q"),
    limit: Math.floor(rawLimit),
  });
  return successResponse({ zones: rows.map(serialiseZone), limit: Math.floor(rawLimit) }, ctx.locale, ctx.requestId);
}

/** `GET /v1/zones/{id}`: one zone, with its shape. */
async function getZone(ctx: Ctx, idRaw: string): Promise<Response> {
  const id = parseId(ctx, idRaw);
  if (id instanceof Response) return id;
  const row = await findAdminZone(ctx.db, id);
  if (row === null) {
    return failureResponse({ code: "ZONE_NOT_FOUND", details: { zone_id: toHexId(id) } }, ctx.locale, ctx.requestId);
  }
  const polygon = await findZonePolygon(ctx.db, id);
  return successResponse(
    {
      zone: serialiseZone(row),
      // The ring travels as JSON rather than as a string: a caller that has to parse a string to
      // draw a map is a caller that will one day draw a string.
      polygon: polygon === null ? null : polygon.polygon,
    },
    ctx.locale,
    ctx.requestId,
  );
}

/** The reason codes a pause may cite. */
const PAUSE_REASONS = reasonsFor("zone.deactivate").map((entry) => entry.code);

/** Read a pause body: `{ reasonCode, note? }`. */
function readPauseBody(
  body: unknown,
): { readonly reasonCode: string; readonly note: string | null } | { readonly field: string } {
  if (typeof body !== "object" || body === null) return { field: "reasonCode" };
  const record = body as Record<string, unknown>;
  const reasonCode = record["reasonCode"];
  if (typeof reasonCode !== "string" || !reasonAllowed(reasonCode, "zone.deactivate")) {
    return { field: "reasonCode" };
  }
  const note = record["note"];
  if (note === undefined || note === null) return { reasonCode, note: null };
  if (typeof note !== "string" || note.trim().length < 3 || note.trim().length > MAX_NOTE_LENGTH) {
    return { field: "note" };
  }
  return { reasonCode, note: note.trim() };
}

/** `POST /v1/zones/{id}/pause`. */
async function pause(ctx: Ctx, idRaw: string, body: unknown): Promise<Response> {
  const id = parseId(ctx, idRaw);
  if (id instanceof Response) return id;
  const parsed = readPauseBody(body);
  if ("field" in parsed) return invalid(ctx, parsed.field);

  const row = await findAdminZone(ctx.db, id);
  if (row === null) {
    return failureResponse({ code: "ZONE_NOT_FOUND", details: { zone_id: toHexId(id) } }, ctx.locale, ctx.requestId);
  }

  // Already paused: the intent is satisfied, so nothing is written and no second audit row claims
  // something changed when nothing did.
  if (row.status === "PAUSED") {
    return successResponse({ zone: serialiseZone(row), changed: false }, ctx.locale, ctx.requestId);
  }
  if (row.status !== "ACTIVE") {
    // A draft has never carried an order and a retired zone never will; both are already "off" in
    // the only sense this switch means.
    return failureResponse({ code: "ZONE_INACTIVE", details: { zone_id: toHexId(id) } }, ctx.locale, ctx.requestId);
  }

  const live = await countLiveOrdersInZone(ctx.db, id);
  if (live > 0) {
    return failureResponse(
      { code: "ZONE_HAS_ACTIVE_ORDERS", details: { active_orders: live } },
      ctx.locale,
      ctx.requestId,
    );
  }

  const changed = await setZoneStatus(ctx.db, id, "ACTIVE", "PAUSED", sqlDatetime(new Date()));
  if (changed === 0) {
    // Somebody moved it between the read and the write. Report the state that won rather than
    // claiming a pause that did not happen.
    return failureResponse({ code: "ZONE_INACTIVE", details: { zone_id: toHexId(id) } }, ctx.locale, ctx.requestId);
  }

  await audit.appendAudit(ctx.db, {
    actorId: ctx.principal?.userId ?? null,
    actorType: actorTypeOf(ctx),
    actorRole: ctx.principal?.role ?? null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    action: "zone.pause",
    resourceType: "ZONE",
    resourceId: toHexId(id),
    subjectId: toHexId(id),
    before: { status: "ACTIVE" },
    after: { status: "PAUSED" },
    reason: parsed.note === null ? parsed.reasonCode : `${parsed.reasonCode}: ${parsed.note}`,
    severity: "WARNING",
  });

  const updated = await findAdminZone(ctx.db, id);
  return successResponse(
    { zone: updated === null ? serialiseZone(row) : serialiseZone(updated), changed: true },
    ctx.locale,
    ctx.requestId,
  );
}

/**
 * `POST /v1/zones/{id}/activate`.
 *
 * A retired zone is refused: retirement is the platform's word for "this area is gone", and an
 * operator reopening it by accident would put a dead area back on the map with its old polygon.
 */
async function activate(ctx: Ctx, idRaw: string, body: unknown): Promise<Response> {
  const id = parseId(ctx, idRaw);
  if (id instanceof Response) return id;

  const note = typeof body === "object" && body !== null ? (body as Record<string, unknown>)["note"] : undefined;
  if (note !== undefined && note !== null && (typeof note !== "string" || note.trim().length < 3 || note.trim().length > MAX_NOTE_LENGTH)) {
    return invalid(ctx, "note");
  }

  const row = await findAdminZone(ctx.db, id);
  if (row === null) {
    return failureResponse({ code: "ZONE_NOT_FOUND", details: { zone_id: toHexId(id) } }, ctx.locale, ctx.requestId);
  }
  if (row.status === "ACTIVE") {
    return successResponse({ zone: serialiseZone(row), changed: false }, ctx.locale, ctx.requestId);
  }
  if (row.status === "RETIRED") {
    return failureResponse({ code: "ZONE_INACTIVE", details: { zone_id: toHexId(id) } }, ctx.locale, ctx.requestId);
  }

  const from = row.status as ZoneStatus;
  const changed = await setZoneStatus(ctx.db, id, from, "ACTIVE", sqlDatetime(new Date()));
  if (changed === 0) {
    return failureResponse({ code: "ZONE_INACTIVE", details: { zone_id: toHexId(id) } }, ctx.locale, ctx.requestId);
  }

  const trimmed = typeof note === "string" ? note.trim() : null;
  await audit.appendAudit(ctx.db, {
    actorId: ctx.principal?.userId ?? null,
    actorType: actorTypeOf(ctx),
    actorRole: ctx.principal?.role ?? null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    action: "zone.activate",
    resourceType: "ZONE",
    resourceId: toHexId(id),
    subjectId: toHexId(id),
    before: { status: from },
    after: { status: "ACTIVE" },
    reason: trimmed === null ? "OPERATOR_REOPEN" : `OPERATOR_REOPEN: ${trimmed}`,
    severity: "NOTICE",
  });

  const updated = await findAdminZone(ctx.db, id);
  return successResponse(
    { zone: updated === null ? serialiseZone(row) : serialiseZone(updated), changed: true },
    ctx.locale,
    ctx.requestId,
  );
}

/** The zone routes. */
export const ZONE_ROUTES: readonly RouteDefinition[] = [
  { method: "GET", path: "/v1/zones", permission: "zone.list", group: "ADMIN_WRITE", run: (ctx) => listZones(ctx) },
  {
    method: "GET",
    path: "/v1/zones/{id}",
    permission: "zone.read",
    group: "ADMIN_WRITE",
    run: (ctx, input) => getZone(ctx, input.params["id"] as string),
  },
  {
    method: "POST",
    path: "/v1/zones/{id}/pause",
    permission: "zone.deactivate",
    write: true,
    group: "ADMIN_WRITE",
    maxBodyBytes: 2 * 1024,
    run: (ctx, input) => pause(ctx, input.params["id"] as string, input.body),
  },
  {
    method: "POST",
    path: "/v1/zones/{id}/activate",
    permission: "zone.activate",
    write: true,
    group: "ADMIN_WRITE",
    maxBodyBytes: 2 * 1024,
    run: (ctx, input) => activate(ctx, input.params["id"] as string, input.body),
  },
];
