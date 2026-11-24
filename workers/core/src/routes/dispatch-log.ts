/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `POST /internal/fcm/dispatches` — realtime reports what it rang, and core writes it down (D86).
 *
 * The split is the platform's, not a preference: `undal-realtime` holds the sockets and the only FCM service
 * account, and `05 §2.1` forbids it writes to TiDB. So the Worker that sends the push reports it, and the
 * Worker that owns the database records it. The report is a batch because one rung rings every device at
 * once: one call for one alarm, not one call per phone.
 *
 * The route is deliberately *not* in the path of a decision. It writes evidence and answers `{recorded}`;
 * nothing reads these rows to decide whether an order moves, because a delivery log is not an authority and
 * a lost row must not be able to hold an order hostage.
 *
 * A batch is audited once, at `INFO`, with the order and the attempt numbers — the per-device detail lives in
 * `fcm_dispatches`, where it belongs. An audit row per phone would add forty-five thousand rows a day to a
 * hash-linked chain that the admin panel reads end to end.
 *
 * `POST /internal/fcm/receipts` is the other half of the loop (`15 §8`): the device's `alarm_received` frame
 * arrives on the presence socket, the room forwards it, and this route fills in `received_at`. A receipt is
 * matched to the **latest unacknowledged** dispatch for that order and device, because that is the one the
 * device could have heard — and the `received_at IS NULL` in the update makes a repeated frame a no-op
 * rather than a second receipt.
 */

import * as audit from "../audit/write.ts";
import { sqlNow } from "../db/time.ts";
import { newId, toHexId } from "../lib/ids.ts";
import { failureResponse, successResponse } from "../middleware/envelope.ts";
import { ANONYMOUS, uuidBytes } from "../middleware/auth.ts";
import { requireInternalToken } from "../middleware/internal-token.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { findOrderByCode } from "../repositories/orders.ts";
import {
  deviceForToken,
  insertDispatch,
  latestUnacknowledged,
  markReceived,
  receiptDetails,
  tokensForDevice,
} from "../repositories/dispatches.ts";
import type { DispatchRow } from "../repositories/dispatches.ts";

/** The most devices one report may carry. A vendor may register five; the margin is for a retry merge. */
export const MAX_DISPATCHES_PER_REPORT = 20;

/** One entry of the report, as realtime sends it. */
interface ReportedDispatch {
  readonly orderCode?: unknown;
  readonly token?: unknown;
  readonly attempt?: unknown;
  readonly outcome?: unknown;
  readonly messageId?: unknown;
  readonly sentAtMs?: unknown;
}

/** Read the report, or `null` when it is not shaped like one. */
function readReport(body: unknown): readonly ReportedDispatch[] | null {
  const fields = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const entries = fields["dispatches"];
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_DISPATCHES_PER_REPORT) return null;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) return null;
    const row = entry as ReportedDispatch;
    if (typeof row.token !== "string" || row.token === "" || row.token.length > 512) return null;
    if (typeof row.attempt !== "number" || !Number.isInteger(row.attempt) || row.attempt < 1 || row.attempt > 9) return null;
    if (typeof row.outcome !== "string" || row.outcome === "" || row.outcome.length > 24) return null;
    if (row.messageId !== null && row.messageId !== undefined && typeof row.messageId !== "string") return null;
    if (typeof row.sentAtMs !== "number" || !Number.isFinite(row.sentAtMs)) return null;
    if (row.orderCode !== null && row.orderCode !== undefined && typeof row.orderCode !== "string") return null;
  }
  return entries as readonly ReportedDispatch[];
}

/** Record a batch of sends. */
async function record(ctx: Ctx, body: unknown): Promise<Response> {
  const refused = requireInternalToken(ctx);
  if (refused !== null) return refused;

  const report = readReport(body);
  if (report === null) {
    return failureResponse(
      { code: "VALIDATION_FAILED", details: { field: "dispatches" } },
      ctx.locale,
      ctx.requestId,
    );
  }

  const rows: DispatchRow[] = [];
  const orderIds = new Set<string>();
  for (const entry of report) {
    const token = entry.token as string;
    const orderCode = typeof entry.orderCode === "string" && entry.orderCode !== "" ? entry.orderCode : null;
    // A code that names no order still gets a row: the push happened, and an order that was deleted
    // afterwards is exactly the kind of thing the log exists to survive.
    const order = orderCode === null ? null : await findOrderByCode(ctx.db, orderCode);
    if (order !== null) orderIds.add(toHexId(order.id));
    rows.push({
      id: newId(),
      orderId: order === null ? null : order.id,
      deviceId: await deviceForToken(ctx.db, token),
      token,
      attempt: entry.attempt as number,
      outcome: entry.outcome as string,
      messageId: typeof entry.messageId === "string" ? entry.messageId : null,
      // `DATETIME(6)` in UTC, through the same helper every other column uses.
      sentAt: sqlNow(entry.sentAtMs as number),
    });
  }
  for (const row of rows) await insertDispatch(ctx.db, row);

  const attempts = [...new Set(rows.map((row) => row.attempt))].sort((left, right) => left - right);
  await audit.appendAudit(ctx.db, {
    actorId: null,
    actorType: "SYSTEM",
    actorRole: null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    action: "fcm.dispatch",
    resourceType: "ORDER",
    resourceId: [...orderIds][0] ?? null,
    subjectId: null,
    before: null,
    after: {
      orderCode: (report[0]?.orderCode as string | undefined) ?? null,
      attempts,
      sent: rows.filter((row) => row.outcome === "SENT").length,
      failed: rows.filter((row) => row.outcome !== "SENT").length,
    },
    reason: null,
    severity: "INFO",
  });

  return successResponse({ recorded: rows.length }, ctx.locale, ctx.requestId);
}

/** One receipt, as realtime forwards it. */
interface ReportedReceipt {
  readonly orderCode?: unknown;
  readonly deviceId?: unknown;
  readonly receivedAtMs?: unknown;
  /** How long the device measured, in milliseconds. Optional: older clients send none. */
  readonly latencyMs?: unknown;
  /** `FCM`, `SOCKET` or `BOTH`, as the device names the path that woke it. */
  readonly path?: unknown;
}

/** The most receipts one report may carry. */
export const MAX_RECEIPTS_PER_REPORT = 10;

/** Read a receipt report, or `null` when it is not shaped like one. */
function readReceipts(body: unknown): readonly ReportedReceipt[] | null {
  const fields = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const entries = fields["receipts"];
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_RECEIPTS_PER_REPORT) return null;
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) return null;
    const row = entry as ReportedReceipt;
    if (typeof row.orderCode !== "string" || row.orderCode === "" || row.orderCode.length > 64) return null;
    if (typeof row.deviceId !== "string" || !/^[0-9a-f]{32}$/iu.test(row.deviceId)) return null;
    if (typeof row.receivedAtMs !== "number" || !Number.isFinite(row.receivedAtMs)) return null;
  }
  return entries as readonly ReportedReceipt[];
}

/**
 * Record that a device heard an alarm.
 *
 * A receipt for an order this Worker no longer has, or a device with no live token, is not an error: it is a
 * row that cannot be matched, and the answer says how many were. Nothing here can fail an alarm — the alarm
 * already happened.
 */
async function recordReceipts(ctx: Ctx, body: unknown): Promise<Response> {
  const refused = requireInternalToken(ctx);
  if (refused !== null) return refused;

  const report = readReceipts(body);
  if (report === null) {
    return failureResponse({ code: "VALIDATION_FAILED", details: { field: "receipts" } }, ctx.locale, ctx.requestId);
  }

  let recorded = 0;
  let firstOrderId: Uint8Array | null = null;
  for (const entry of report) {
    const order = await findOrderByCode(ctx.db, entry.orderCode as string);
    if (order === null) continue;
    firstOrderId ??= order.id;
    const deviceId = uuidBytes(entry.deviceId as string);
    const receivedAt = sqlNow(entry.receivedAtMs as number);
    for (const token of await tokensForDevice(ctx.db, deviceId)) {
      const dispatchId = await latestUnacknowledged(ctx.db, order.id, token);
      if (dispatchId === null) continue;
      const details = receiptDetails(entry.latencyMs, entry.path);
      if (await markReceived(ctx.db, dispatchId, receivedAt, details)) recorded += 1;
    }
  }

  if (recorded > 0) {
    await audit.appendAudit(ctx.db, {
      actorId: null,
      actorType: "SYSTEM",
      actorRole: null,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      action: "fcm.receipt",
      resourceType: "ORDER",
      resourceId: firstOrderId === null ? null : toHexId(firstOrderId),
      subjectId: null,
      before: null,
      after: { receipts: recorded },
      reason: null,
      severity: "INFO",
    });
  }

  return successResponse({ recorded }, ctx.locale, ctx.requestId);
}

/** The internal dispatch-log routes. */
export const DISPATCH_LOG_ROUTES: readonly RouteDefinition[] = [
  {
    method: "POST",
    path: "/internal/fcm/dispatches",
    permission: ANONYMOUS,
    group: "INTERNAL",
    write: true,
    maxBodyBytes: 8 * 1024,
    run: (ctx, input) => record(ctx, input.body),
  },
  {
    method: "POST",
    path: "/internal/fcm/receipts",
    permission: ANONYMOUS,
    group: "INTERNAL",
    write: true,
    maxBodyBytes: 4 * 1024,
    run: (ctx, input) => recordReceipts(ctx, input.body),
  },
];
