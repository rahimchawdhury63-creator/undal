/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The push log: one row per send (`15 §8`).
 *
 * The rows are evidence, not state. Nothing in the platform reads them to make a decision about an order —
 * the ladder decides, from its own record — and that is deliberate: a delivery log that gated a transition
 * would make a lost row a lost order. What they are for is the question support actually gets asked ("why
 * did I not see the alarm?"), and the answer is a timestamped list of what was sent to which device with
 * what result.
 */

import type { Db } from "../db/client.ts";
import { sqlNow } from "../db/time.ts";

/** One send, as core receives it from realtime. */
export interface DispatchInput {
  readonly orderCode: string | null;
  readonly token: string;
  readonly attempt: number;
  readonly outcome: string;
  readonly messageId: string | null;
  readonly sentAtMs: number;
}

/** A row that has been resolved against the order and the device it belongs to. */
export interface DispatchRow {
  readonly id: Uint8Array;
  readonly orderId: Uint8Array | null;
  readonly deviceId: Uint8Array | null;
  readonly token: string;
  readonly attempt: number;
  readonly outcome: string;
  readonly messageId: string | null;
  readonly sentAt: string;
}

/** The device a token belongs to, or `null` when the token is not registered. */
export async function deviceForToken(db: Db, token: string): Promise<Uint8Array | null> {
  const row = await db.first<{ device_id: Uint8Array }>(
    "SELECT `device_id` FROM `device_tokens` WHERE `fcm_token` = ? LIMIT 1",
    [token],
  );
  return row === null ? null : new Uint8Array(row.device_id);
}

/** Append one send. */
export async function insertDispatch(db: Db, row: DispatchRow): Promise<void> {
  await db.execute(
    "INSERT INTO `fcm_dispatches` (`id`, `order_id`, `device_id`, `fcm_token`, `attempt`, `outcome`, " +
      "`message_id`, `sent_at`, `received_at`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [row.id, row.orderId, row.deviceId, row.token, row.attempt, row.outcome, row.messageId, row.sentAt, null],
  );
}

/** The tokens a device currently holds. A device may have refreshed its token; both stay valid for a while. */
export async function tokensForDevice(db: Db, deviceId: Uint8Array): Promise<readonly string[]> {
  const rows = await db.query<{ fcm_token: string }>(
    "SELECT `fcm_token` FROM `device_tokens` WHERE `device_id` = ? AND `valid` = true",
    [deviceId],
  );
  return rows.map((row) => row.fcm_token);
}

/**
 * The most recent dispatch to this token for this order that has not been acknowledged.
 *
 * "Most recent" rather than "any": an alarm rings three times, and the receipt that comes back is for the
 * one the device heard — which is the latest one it could have heard. Acknowledging an older row would leave
 * the newest send looking undelivered, and the newest is the one the delivery matrix reads.
 */
export async function latestUnacknowledged(
  db: Db,
  orderId: Uint8Array,
  token: string,
): Promise<Uint8Array | null> {
  const row = await db.first<{ id: Uint8Array }>(
    "SELECT `id` FROM `fcm_dispatches` WHERE `order_id` = ? AND `fcm_token` = ? AND `received_at` IS NULL " +
      "ORDER BY `sent_at` DESC LIMIT 1",
    [orderId, token],
  );
  return row === null ? null : new Uint8Array(row.id);
}

/**
 * Fill in the receipt.
 *
 * `received_at IS NULL` in the `WHERE` is what makes a receipt idempotent: a device that reports the same
 * alarm twice — a reconnect, a retried frame — updates one row once and the second write matches nothing.
 */
/** The paths a device may name as the one that woke it. Anything else is dropped, not stored. */
export const DEVICE_PATHS: readonly string[] = ["FCM", "SOCKET", "BOTH"];

/** The longest latency a device may claim. Ten minutes is generous; longer is a broken clock. */
export const MAX_DEVICE_LATENCY_MS = 600_000;

/** What the device said about its own delivery, already filtered (`15 §8`, D88). */
export interface ReceiptDetails {
  /** The device's own measurement, or null when it sent none or sent a nonsense one. */
  readonly latencyMs: number | null;
  /** The path the device believes woke it, from `DEVICE_PATHS`, or null. */
  readonly path: string | null;
}

/** The details of a receipt that carried no measurement at all. */
export const NO_DETAILS: ReceiptDetails = { latencyMs: null, path: null };

/**
 * Filter the device's claims.
 *
 * A measurement that is not a number, is negative, or claims more than ten minutes is dropped rather than
 * refused: the receipt is the load-bearing half of the frame, and losing a real delivery record because a
 * phone's clock is wrong would punish the platform's evidence for the phone's bug. The accepted path names
 * are a closed set, so an unrecognised one is a client that invented a channel.
 */
export function receiptDetails(latencyMs: unknown, path: unknown): ReceiptDetails {
  const latency =
    typeof latencyMs === "number" && Number.isFinite(latencyMs) && latencyMs >= 0 && latencyMs <= MAX_DEVICE_LATENCY_MS
      ? Math.round(latencyMs)
      : null;
  const named = typeof path === "string" && DEVICE_PATHS.includes(path) ? path : null;
  return { latencyMs: latency, path: named };
}

/**
 * Fill in a receipt.
 *
 * `received_at IS NULL` is what makes a repeated frame a no-op instead of a second receipt, and the device's
 * own claims are written in the same statement — a second `UPDATE` would be a row that could be stamped by
 * one caller and measured by another.
 */
export async function markReceived(
  db: Db,
  dispatchId: Uint8Array,
  receivedAt: string,
  details: ReceiptDetails = NO_DETAILS,
): Promise<boolean> {
  const result = await db.execute(
    "UPDATE `fcm_dispatches` SET `received_at` = ?, `device_latency_ms` = ?, `device_path` = ? " +
      "WHERE `id` = ? AND `received_at` IS NULL",
    [receivedAt, details.latencyMs, details.path, dispatchId],
  );
  return result.affectedRows === 1;
}
