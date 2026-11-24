/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The vendor routes an operator uses.
 *
 * Two readers and two switches. The readers are a filtered list and a single profile; the switches
 * are pause and resume, which are the only two things an operator may do to a live kitchen without
 * going through onboarding. Everything else about a vendor — documents, bank account, commission,
 * hours — has its own permission and its own route, and none of it is bundled here where a single
 * mistake would grant all of it at once.
 *
 * A pause is a promise with an end (`vendors.paused_until`): the catalogue hides a paused kitchen
 * and the customer is told when it comes back. An operator cannot pause indefinitely, because an
 * indefinite pause is a suspension wearing the wrong name and the owner would wait for a switch
 * nobody intends to flip.
 */

import { failureResponse, successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { uuidBytes } from "../middleware/auth.ts";
import { toHexId } from "../lib/ids.ts";
import { decodeCursor, encodeCursor } from "../lib/cursor.ts";
import { sqlDatetime } from "../db/time.ts";
import * as audit from "../audit/write.ts";
import type { ActorType } from "../audit/types.ts";
import {
  findAdminVendor,
  isVendorStatus,
  listAdminVendors,
  pauseVendor,
  resumeVendor,
  type AdminVendorRow,
} from "../repositories/vendors.ts";

/**
 * The audit register's word for the caller.
 *
 * `Principal` says `VENDOR_OWNER` because that is what the account column holds; the audit trail
 * says `VENDOR` because it is recording an actor class, not a job title. Translating here keeps
 * both vocabularies honest instead of bending one to the other.
 */
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

/** The longest pause an operator may set, in minutes: one day. */
const MAX_PAUSE_MINUTES = 1_440;

/** The page sizes the list accepts. */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

/** A vendor as the console reads it. Money is absent on purpose; see `vendor.view_finance`. */
function serialiseVendor(row: AdminVendorRow): Record<string, unknown> {
  return {
    id: toHexId(row.id),
    kind: row.kind,
    slug: row.slug,
    name: row.name,
    nameBn: row.name_bn,
    tagline: row.tagline,
    phone: row.phone,
    zoneId: toHexId(row.zone_id),
    status: row.status,
    openState: row.open_state,
    busyLevel: Number(row.busy_level),
    pausedUntil: row.paused_until,
    pauseReason: row.pause_reason,
    commissionBps: Number(row.commission_bps),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** A `422` that names the field the caller has to fix. */
function invalid(ctx: Ctx, field: string): Response {
  return failureResponse({ code: "VALIDATION_FAILED", details: { field } }, ctx.locale, ctx.requestId);
}

/** `GET /v1/vendors`: the operator's list. */
async function listVendors(ctx: Ctx): Promise<Response> {
  const params = ctx.url.searchParams;

  const rawStatus = params.get("status");
  if (rawStatus !== null && !isVendorStatus(rawStatus.toUpperCase())) return invalid(ctx, "status");
  const status = rawStatus === null ? null : rawStatus.toUpperCase();

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

  const rows = await listAdminVendors(ctx.db, {
    status: status as Parameters<typeof listAdminVendors>[1]["status"],
    q: params.get("q"),
    zoneId,
    cursor,
    limit,
  });
  const last = rows[rows.length - 1];
  return successResponse(
    {
      vendors: rows.map(serialiseVendor),
      // Only a full page can have a successor: an empty cursor on a short page tells a client to
      // stop, and claiming there might be more is how a console loops.
      nextCursor: rows.length === limit && last !== undefined ? encodeCursor(last.created_at, toHexId(last.id)) : null,
    },
    ctx.locale,
    ctx.requestId,
  );
}

/** `GET /v1/vendors/{id}`: one profile. */
async function getVendor(ctx: Ctx, idRaw: string): Promise<Response> {
  let id: Uint8Array;
  try {
    id = uuidBytes(idRaw);
  } catch {
    return failureResponse({ code: "VALIDATION_ID_MALFORMED", field: "id" }, ctx.locale, ctx.requestId);
  }
  const row = await findAdminVendor(ctx.db, id);
  if (row === null) return failureResponse({ code: "CATALOG_VENDOR_NOT_FOUND" }, ctx.locale, ctx.requestId);
  return successResponse({ vendor: serialiseVendor(row) }, ctx.locale, ctx.requestId);
}

/** Read the pause body: `{ minutes, reason }`, both mandatory, both bounded. */
function readPauseBody(body: unknown): { readonly minutes: number; readonly reason: string } | { readonly field: string } {
  if (typeof body !== "object" || body === null) return { field: "minutes" };
  const record = body as Record<string, unknown>;
  const minutes = record["minutes"];
  const reason = record["reason"];
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > MAX_PAUSE_MINUTES) {
    return { field: "minutes" };
  }
  if (typeof reason !== "string" || reason.trim().length < 3 || reason.trim().length > 128) return { field: "reason" };
  return { minutes, reason: reason.trim() };
}

/**
 * `POST /v1/vendors/{id}/pause`.
 *
 * Only an `APPROVED` kitchen can be paused: pausing a draft is meaningless, and pausing a suspended
 * vendor would overwrite the reason a suspension exists to record.
 */
async function pause(ctx: Ctx, idRaw: string, body: unknown): Promise<Response> {
  let id: Uint8Array;
  try {
    id = uuidBytes(idRaw);
  } catch {
    return failureResponse({ code: "VALIDATION_ID_MALFORMED", field: "id" }, ctx.locale, ctx.requestId);
  }
  const parsed = readPauseBody(body);
  if ("field" in parsed) return invalid(ctx, parsed.field);

  const row = await findAdminVendor(ctx.db, id);
  if (row === null) return failureResponse({ code: "CATALOG_VENDOR_NOT_FOUND" }, ctx.locale, ctx.requestId);
  if (row.status !== "APPROVED") {
    // The catalogue's own word for "not usable yet", reused so the partner app renders the sentence
    // it already has instead of a new one nobody translated.
    return failureResponse({ code: "CATALOG_VENDOR_NOT_VERIFIED" }, ctx.locale, ctx.requestId);
  }

  const nowMs = Date.now();
  const untilMs = nowMs + parsed.minutes * 60_000;
  const untilSql = sqlDatetime(new Date(untilMs));
  const changed = await pauseVendor(ctx.db, id, untilSql, parsed.reason);
  if (changed === 0) {
    // The row moved between the read and the write: somebody suspended or deleted it.
    return failureResponse({ code: "CATALOG_VENDOR_NOT_FOUND" }, ctx.locale, ctx.requestId);
  }

  const updated = await findAdminVendor(ctx.db, id);
  await audit.appendAudit(ctx.db, {
    actorId: ctx.principal?.userId ?? null,
    actorType: actorTypeOf(ctx),
    actorRole: ctx.principal?.role ?? null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    action: "vendor.pause",
    resourceType: "VENDOR",
    resourceId: toHexId(id),
    subjectId: toHexId(id),
    before: { openState: row.open_state, pausedUntil: row.paused_until, pauseReason: row.pause_reason },
    after: { openState: "PAUSED", pausedUntil: new Date(untilMs).toISOString(), pauseReason: parsed.reason },
    reason: "OPERATOR_PAUSE",
    severity: "NOTICE",
  });

  return successResponse(
    { vendor: updated === null ? serialiseVendor(row) : serialiseVendor(updated), pausedUntil: new Date(untilMs).toISOString() },
    ctx.locale,
    ctx.requestId,
  );
}

/** `POST /v1/vendors/{id}/resume`. */
async function resume(ctx: Ctx, idRaw: string): Promise<Response> {
  let id: Uint8Array;
  try {
    id = uuidBytes(idRaw);
  } catch {
    return failureResponse({ code: "VALIDATION_ID_MALFORMED", field: "id" }, ctx.locale, ctx.requestId);
  }
  const row = await findAdminVendor(ctx.db, id);
  if (row === null) return failureResponse({ code: "CATALOG_VENDOR_NOT_FOUND" }, ctx.locale, ctx.requestId);

  // Resuming a vendor that was never paused succeeds and writes nothing: the operator's intent is
  // "open", the vendor is open, and a refusal here would only invite a second click.
  if (row.open_state === "PAUSED" || row.paused_until !== null) {
    await resumeVendor(ctx.db, id);
    await audit.appendAudit(ctx.db, {
      actorId: ctx.principal?.userId ?? null,
      actorType: actorTypeOf(ctx),
      actorRole: ctx.principal?.role ?? null,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      action: "vendor.resume",
      resourceType: "VENDOR",
      resourceId: toHexId(id),
      subjectId: toHexId(id),
      before: { openState: row.open_state, pausedUntil: row.paused_until, pauseReason: row.pause_reason },
      after: { openState: "OPEN", pausedUntil: null, pauseReason: null },
      reason: "OPERATOR_RESUME",
      severity: "NOTICE",
    });
  }

  const updated = await findAdminVendor(ctx.db, id);
  return successResponse({ vendor: updated === null ? serialiseVendor(row) : serialiseVendor(updated) }, ctx.locale, ctx.requestId);
}

/** The vendor routes. */
export const VENDOR_ROUTES: readonly RouteDefinition[] = [
  { method: "GET", path: "/v1/vendors", permission: "vendor.list", group: "ADMIN_WRITE", run: (ctx) => listVendors(ctx) },
  {
    method: "GET",
    path: "/v1/vendors/{id}",
    permission: "vendor.read",
    group: "ADMIN_WRITE",
    run: (ctx, input) => getVendor(ctx, input.params["id"] as string),
  },
  {
    method: "POST",
    path: "/v1/vendors/{id}/pause",
    permission: "vendor.pause",
    write: true,
    group: "ADMIN_WRITE",
    maxBodyBytes: 4 * 1024,
    run: (ctx, input) => pause(ctx, input.params["id"] as string, input.body),
  },
  {
    method: "POST",
    path: "/v1/vendors/{id}/resume",
    permission: "vendor.resume",
    write: true,
    group: "ADMIN_WRITE",
    maxBodyBytes: 2 * 1024,
    run: (ctx, input) => resume(ctx, input.params["id"] as string),
  },
];
