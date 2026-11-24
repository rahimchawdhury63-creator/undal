/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The offers a rider is holding (`07 §?` no — `11 §7`, D113).
 *
 * An offer is a row with a 25-second life and one question attached: *will you take this delivery?* The row is
 * the record of having asked, and the answer is written once — `response IS NULL` in the update is what makes
 * a second answer impossible rather than merely unlikely.
 *
 * Two identities meet here and are easy to confuse, so they are named at the type: `order_offers.rider_id` is a
 * **riders row id**, while the token that claims carries a **user id**. The route translates once, before it
 * reads anything, and every statement below takes the row id.
 */

import type { Db } from "../db/client.ts";
import { parseDatetime, sqlDatetime } from "../db/time.ts";

/** One offer, with everything the claim decision needs. */
export interface OfferRow {
  readonly id: Uint8Array;
  readonly orderId: Uint8Array;
  /** The riders row id the offer was sent to. */
  readonly riderId: Uint8Array;
  readonly wave: number;
  /** `DATETIME(6)`: when the 25-second TTL runs out. */
  readonly expiresAt: string;
  /** `null` until the rider answers. */
  readonly response: string | null;
  readonly payoutPaisa: number;
}

/** What an assignment row records. */
export interface AssignmentInsert {
  readonly id: Uint8Array;
  readonly orderId: Uint8Array;
  readonly riderId: Uint8Array;
  readonly assignedAt: string;
}

const OFFER_COLUMNS = "`id`, `order_id`, `rider_id`, `wave`, `expires_at`, `response`, `payout_paisa`";

/** One offer by id, or `null`. */
export async function findOffer(db: Db, offerId: Uint8Array): Promise<OfferRow | null> {
  const row = await db.first<Record<string, unknown>>(
    `SELECT ${OFFER_COLUMNS} FROM \`order_offers\` WHERE \`id\` = ? LIMIT 1`,
    [offerId],
  );
  if (row === null) return null;
  return {
    id: new Uint8Array(row["id"] as Uint8Array),
    orderId: new Uint8Array(row["order_id"] as Uint8Array),
    riderId: new Uint8Array(row["rider_id"] as Uint8Array),
    wave: Number(row["wave"]),
    expiresAt: String(row["expires_at"]),
    response: row["response"] === null || row["response"] === undefined ? null : String(row["response"]),
    payoutPaisa: Number(row["payout_paisa"] ?? 0),
  };
}

/**
 * Record an answer, once.
 *
 * `WHERE response IS NULL` is the whole concurrency story for this table: two taps by one rider, or a tap racing
 * the expiry sweep, produce one row changed and one zero. The caller that gets zero has lost to an answer that
 * already exists, and is told which rather than overwriting it.
 */
export async function respondToOffer(db: Db, input: {
  readonly offerId: Uint8Array;
  readonly response: "ACCEPTED" | "REJECTED" | "EXPIRED" | "WITHDRAWN";
  readonly respondedAt: string;
  readonly rejectReason?: string | null;
}): Promise<number> {
  const result = await db.execute(
    "UPDATE `order_offers` SET `response` = ?, `responded_at` = ?, `reject_reason` = ? " +
      "WHERE `id` = ? AND `response` IS NULL",
    [input.response, input.respondedAt, input.rejectReason ?? null, input.offerId],
  );
  return result.affectedRows;
}

/**
 * Withdraw every other unanswered offer on the order.
 *
 * `11 §7.2`: a wave ends early the moment anyone claims, and the other riders' alarms must stop. Leaving their
 * offers `NULL` would keep those screens ringing for a delivery that is already someone else's — and would let
 * one of them claim an order that is no longer searching.
 */
export async function withdrawSiblingOffers(db: Db, input: {
  readonly orderId: Uint8Array;
  readonly exceptOfferId: Uint8Array;
  readonly respondedAt: string;
}): Promise<number> {
  const result = await db.execute(
    "UPDATE `order_offers` SET `response` = 'WITHDRAWN', `responded_at` = ? " +
      "WHERE `order_id` = ? AND `response` IS NULL AND `id` <> ?",
    [input.respondedAt, input.orderId, input.exceptOfferId],
  );
  return result.affectedRows;
}

/** Write the assignment row: which rider had this order, from when, and (later) why they stopped. */
export async function insertAssignment(db: Db, assignment: AssignmentInsert): Promise<void> {
  await db.execute(
    "INSERT INTO `order_assignments` (`id`, `order_id`, `rider_id`, `assigned_at`) VALUES (?, ?, ?, ?)",
    [assignment.id, assignment.orderId, assignment.riderId, assignment.assignedAt],
  );
}

/**
 * Count the rejection against the shift the rider is on (`06 §6`, `rider_shifts.orders_rejected`).
 *
 * `11 §9.2` says no reason carries a direct penalty and the consequence is statistical: a rider who rejects a
 * lot has a lower acceptance factor. That statistic is the shift's counter, so it is incremented in the same call
 * as the answer rather than derived later from a join nobody writes.
 */
export async function countRejectionOnShift(db: Db, riderId: Uint8Array): Promise<number> {
  const result = await db.execute(
    "UPDATE `rider_shifts` SET `orders_rejected` = `orders_rejected` + 1 WHERE `rider_id` = ? AND `ended_at` IS NULL",
    [riderId],
  );
  return result.affectedRows;
}

/** An offer as the rider's reconciliation screen sees it. */
export interface LiveOffer {
  readonly offerId: string;
  readonly orderCode: string;
  readonly orderId: string;
  readonly wave: number;
  readonly expiresAtMs: number;
  readonly payoutPaisa: number;
}

/**
 * The offers a rider still has to answer (`08 §8`, D115).
 *
 * The push is authoritative and this is reconciliation — the app calls it when a notification was missed or a
 * screen was backgrounded — so the predicate is the same one the claim route enforces: unanswered and inside its
 * TTL. An expired offer is not a pending one; it is excluded here even before the sweep writes `EXPIRED` on it,
 * because the rider's screen must never show a delivery they can no longer take.
 */
export async function liveOffersFor(db: Db, riderId: Uint8Array, nowMs: number): Promise<readonly LiveOffer[]> {
  const rows = await db.query<Record<string, unknown>>(
    "SELECT o.`id`, o.`order_id`, o.`wave`, o.`expires_at`, o.`payout_paisa`, ord.`code` FROM `order_offers` o " +
      "JOIN `orders` ord ON ord.`id` = o.`order_id` " +
      "WHERE o.`rider_id` = ? AND o.`response` IS NULL AND o.`expires_at` > ? ORDER BY o.`expires_at` ASC LIMIT 20",
    [riderId, sqlDatetime(new Date(nowMs))],
  );
  return rows.map((row) => ({
    offerId: new Uint8Array(row["id"] as Uint8Array).reduce((hex, byte) => hex + byte.toString(16).padStart(2, "0"), ""),
    orderId: new Uint8Array(row["order_id"] as Uint8Array).reduce((hex, byte) => hex + byte.toString(16).padStart(2, "0"), ""),
    orderCode: String(row["code"]),
    wave: Number(row["wave"]),
    expiresAtMs: parseDatetime(String(row["expires_at"]))?.getTime() ?? 0,
    payoutPaisa: Number(row["payout_paisa"] ?? 0),
  }));
}

/** What an expiry sweep changed. */
export interface ExpiredOffers {
  readonly expired: number;
  /** The waves those offers belonged to, so a caller can tell a whole wave timing out from one rider being slow. */
  readonly waves: readonly number[];
  /**
   * The orders left without a live offer by this sweep, by code (D130).
   *
   * A sweep that reported only counts would leave the caller unable to ask the next question — *whose wave expired?* —
   * and the answer is what dispatch advances. Codes rather than ids because the advance route is addressed by code
   * (`08 §6`), and a caller holding ids would have to look them up again.
   */
  readonly orders: readonly string[];
  /**
   * The zones those orders belong to, by hex id (D135).
   *
   * The training pass is per zone, because the model is per zone: an expiry in Sylhet must not teach Moulvibazar's
   * coefficients anything. Hex rather than bytes because the sweep's other answer is codes, and a caller that had to
   * unpack ids here would be doing the repository's job.
   */
  readonly zones: readonly string[];
}

/**
 * Mark every unanswered offer whose TTL has passed as expired (`11 §9.3`, D116).
 *
 * This is the statement that makes the TTL real. Without it an offer that nobody answered stays `response IS
 * NULL` for ever: the rider's list excludes it by time, the claim route refuses it by time, and the row still
 * says the delivery is pending — three answers to one question, two of them computed. `11 §9.3` then counts an
 * expiry against the rider's acceptance at half the weight of a refusal, and it cannot count what is not written.
 *
 * `LIMIT` is absent on purpose: an unexpired offer is the *majority* of the table during a lunch rush, and the
 * predicate is on an indexed column (`idx_offers_rider` covers `rider_id`, not `expires_at`; the wave sweep is
 * small enough that a scan of the pending rows is cheaper than a second index nobody else needs).
 */
export async function expireOffers(db: Db, nowMs: number): Promise<ExpiredOffers> {
  const now = sqlDatetime(new Date(nowMs));
  const waves = await db.query<{ wave: number | string }>(
    "SELECT DISTINCT `wave` FROM `order_offers` WHERE `response` IS NULL AND `expires_at` <= ?",
    [now],
  );
  // Read before the update, because the update is what erases the evidence of which orders needed a next wave.
  const due = await db.query<{ code: string }>(
    "SELECT DISTINCT `o`.`code` AS `code` FROM `order_offers` `f` JOIN `orders` `o` ON `o`.`id` = `f`.`order_id` " +
      "WHERE `f`.`response` IS NULL AND `f`.`expires_at` <= ?",
    [now],
  );
  // Read before the update for the same reason: after it, the rows say when they expired, not that they were due.
  const zones = await db.query<{ zone_id: Uint8Array }>(
    "SELECT DISTINCT `o`.`zone_id` AS `zone_id` FROM `order_offers` `f` JOIN `orders` `o` ON `o`.`id` = `f`.`order_id` " +
      "WHERE `f`.`response` IS NULL AND `f`.`expires_at` <= ?",
    [now],
  );
  const result = await db.execute(
    "UPDATE `order_offers` SET `response` = 'EXPIRED', `responded_at` = ? WHERE `response` IS NULL AND `expires_at` <= ?",
    [now, now],
  );
  return {
    expired: result.affectedRows,
    waves: waves.map((row) => Number(row.wave)),
    orders: due.map((row) => String(row.code)),
    zones: zones.map((row) => Buffer.from(row.zone_id).toString("hex")),
  };
}
