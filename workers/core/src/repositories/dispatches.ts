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
