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
export async function markReceived(db: Db, dispatchId: Uint8Array, receivedAt: string): Promise<boolean> {
  const result = await db.execute(
    "UPDATE `fcm_dispatches` SET `received_at` = ? WHERE `id` = ? AND `received_at` IS NULL",
    [receivedAt, dispatchId],
  );
  return result.affectedRows === 1;
}
