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
import { parseDatetime, sqlNow } from "../db/time.ts";

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

/**
 * A push that failed and is still worth repeating: one row of a retry pass (`15 §8`, D131).
 *
 * Everything needed to rebuild the alarm is here, because the ranking pass that built the first one is gone by the
 * time the retry runs — the wave was planned in another request. `expiresAtMs` is the offer's, not the wave's, so a
 * retried alarm counts down to the same deadline the rider's screen does.
 */
export interface PushRetryCandidate {
  readonly orderId: Uint8Array;
  readonly orderCode: string;
  readonly token: string;
  /** The attempt the failed send recorded; the retry writes `attempt + 1`. */
  readonly attempt: number;
  /** The offer row the rider still holds, as the alarm names it. */
  readonly offerId: Uint8Array;
  readonly payoutPaisa: number;
  readonly expiresAtMs: number;
}

/** What one retry pass asks the log for. */
export interface RetryQuery {
  readonly nowMs: number;
  readonly maxAttempts: number;
  readonly retryAfterMs: number;
  readonly minRemainingMs: number;
  readonly limit: number;
}

/**
 * The failed sends whose offer is still live, newest failure first.
 *
 * The joins are the policy. `order_offers` unanswered and unexpired is "the rider can still take this"; `devices` and
 * `device_tokens` on `valid = 1` is "this phone can still be reached" — which is how a token pruned after a 404 stops
 * being retried without a second table. `NOT EXISTS` a later row for the same token is what stops a pass from
 * re-sending an alarm that has already been delivered since, and it also means one candidate per token per order
 * rather than one per historical failure.
 */
export async function retryCandidates(db: Db, query: RetryQuery): Promise<readonly PushRetryCandidate[]> {
  const rows = await db.query<{
    order_id: Uint8Array;
    code: string;
    fcm_token: string;
    attempt: number;
    offer_id: Uint8Array;
    payout_paisa: number;
    expires_at: string;
  }>(
    "SELECT d.`order_id`, o.`code`, d.`fcm_token`, d.`attempt`, f.`id` AS `offer_id`, f.`payout_paisa`, " +
      "f.`expires_at` FROM `fcm_dispatches` d " +
      "JOIN `orders` o ON o.`id` = d.`order_id` " +
      "JOIN `order_offers` f ON f.`order_id` = d.`order_id` " +
      "JOIN `riders` r ON r.`id` = f.`rider_id` " +
      "JOIN `devices` v ON v.`user_id` = r.`user_id` " +
      "JOIN `device_tokens` t ON t.`device_id` = v.`id` AND t.`fcm_token` = d.`fcm_token` AND t.`valid` = 1 " +
      "WHERE d.`outcome` = 'FAILED' AND d.`attempt` < ? AND d.`sent_at` <= ? " +
      "AND f.`response` IS NULL AND f.`expires_at` > ? " +
      "AND NOT EXISTS (SELECT 1 FROM `fcm_dispatches` n WHERE n.`order_id` = d.`order_id` " +
      "AND n.`fcm_token` = d.`fcm_token` AND n.`sent_at` > d.`sent_at`) " +
      "ORDER BY d.`sent_at` LIMIT ?",
    [
      query.maxAttempts,
      sqlNow(query.nowMs - query.retryAfterMs),
      sqlNow(query.nowMs + query.minRemainingMs),
      query.limit,
    ],
  );
  return rows.map((row) => ({
    orderId: new Uint8Array(row.order_id),
    orderCode: String(row.code),
    token: String(row.fcm_token),
    attempt: Number(row.attempt),
    offerId: new Uint8Array(row.offer_id),
    payoutPaisa: Number(row.payout_paisa),
    expiresAtMs: parseDatetime(row.expires_at)?.getTime() ?? 0,
  }));
}

/**
 * Retire a token Google says is gone.
 *
 * Written once and never un-written: a token that FCM answered 404 for is dead for good, and the `valid` flag is
 * what every later wave reads before deciding who to ring. `valid = 1` in the `WHERE` keeps a second prune from
 * overwriting the timestamp of the first, which is the one support wants when the question is "when did that phone
 * stop receiving orders?".
 */
export async function invalidateToken(db: Db, token: string, reason: string, atMs: number): Promise<boolean> {
  const result = await db.execute(
    "UPDATE `device_tokens` SET `valid` = false, `invalidated_at` = ?, `invalid_reason` = ? " +
      "WHERE `fcm_token` = ? AND `valid` = 1",
    [sqlNow(atMs), reason, token],
  );
  return result.affectedRows === 1;
}
