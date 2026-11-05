/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The rider rows a shift is about (`06 §6`, D109).
 *
 * A rider is addressed two ways and the difference matters: `riders.id` is the row everything references —
 * `rider_shifts.rider_id`, `orders.rider_id` in the *log* sense — while `riders.user_id` is the identity a
 * token carries and a stream resolves `self` to. The shift routes start from the token, so the first query
 * here is the translation, and it is a query rather than a convention because a `riders` row id in a token
 * would be a user able to name a rider they are not.
 */

import type { Db } from "../db/client.ts";

/** The rider a token resolves to, with the columns a shift start judges. */
export interface RiderRow {
  readonly id: Uint8Array;
  readonly code: string;
  /** `DRAFT` … `APPROVED` … `RETIRED` (`06 §6`). Only `APPROVED` may start a shift. */
  readonly status: string;
  /** `OFFLINE`, `VERIFYING`, `ONLINE`, `ON_ORDER`, `BREAK` or `CASH_LOCKED`. */
  readonly shiftState: string;
  readonly homeZoneId: Uint8Array;
  readonly vehicle: string;
}

/** A shift that has not ended, with the totals the rider's own screen shows. */
export interface OpenShiftRow {
  readonly id: Uint8Array;
  readonly zoneId: Uint8Array;
  readonly startedAt: string;
  readonly ordersCompleted: number;
  readonly distanceM: number;
}

/** What opening a shift writes. */
export interface ShiftInsert {
  readonly id: Uint8Array;
  readonly riderId: Uint8Array;
  readonly zoneId: Uint8Array;
  /** `DATETIME(6)` in the platform's format. */
  readonly startedAt: string;
  /** Where the app put the selfie; `VARCHAR(512)`, so the route validates the length first. */
  readonly selfieUrl: string;
  readonly startLatE7: number;
  readonly startLonE7: number;
}

const RIDER_COLUMNS = "`id`, `code`, `status`, `shift_state`, `home_zone_id`, `vehicle`";

/** The rider a user holds, or `null` when the user is not a rider. */
export async function findRiderByUserId(db: Db, userId: Uint8Array): Promise<RiderRow | null> {
  const row = await db.first<Record<string, unknown>>(
    `SELECT ${RIDER_COLUMNS} FROM \`riders\` WHERE \`user_id\` = ? LIMIT 1`,
    [userId],
  );
  if (row === null) return null;
  return {
    id: new Uint8Array(row["id"] as Uint8Array),
    code: String(row["code"]),
    status: String(row["status"]),
    shiftState: String(row["shift_state"]),
    homeZoneId: new Uint8Array(row["home_zone_id"] as Uint8Array),
    vehicle: String(row["vehicle"]),
  };
}

/**
 * The rider's open shift, or `null`.
 *
 * "Open" is `ended_at IS NULL` and nothing else: the schema's `zone_id_if_open` generated column exists so
 * dispatch can find the riders on duty with one index, and a shift that ends without clearing `ended_at`
 * would be an open shift forever. The lookup is by rider, which the `idx_shifts_rider` index covers.
 */
export async function openShiftFor(db: Db, riderId: Uint8Array): Promise<OpenShiftRow | null> {
  const row = await db.first<Record<string, unknown>>(
    "SELECT `id`, `zone_id`, `started_at`, `orders_completed`, `distance_m` FROM `rider_shifts` " +
      "WHERE `rider_id` = ? AND `ended_at` IS NULL ORDER BY `started_at` DESC LIMIT 1",
    [riderId],
  );
  if (row === null) return null;
  return {
    id: new Uint8Array(row["id"] as Uint8Array),
    zoneId: new Uint8Array(row["zone_id"] as Uint8Array),
    startedAt: String(row["started_at"]),
    ordersCompleted: Number(row["orders_completed"] ?? 0),
    distanceM: Number(row["distance_m"] ?? 0),
  };
}

/**
 * Write the shift row.
 *
 * `selfie_verified` is set true and that is a decision, not a shortcut: `19 §3.1` accepts the shift on the
 * on-device checks (a face is present, eyes open, liveness passed) and sends a sample of 10% plus every first
 * shift to a human afterwards. The column therefore means "accepted at the door", and a review that later
 * fails ends the shift rather than having blocked it — a rider who cannot start because of a camera heuristic
 * is a rider who cannot earn.
 */
export async function insertShift(db: Db, shift: ShiftInsert): Promise<void> {
  await db.execute(
    "INSERT INTO `rider_shifts` (`id`, `rider_id`, `zone_id`, `started_at`, `selfie_url`, `selfie_verified`, " +
      "`start_lat_e7`, `start_lon_e7`) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
    [shift.id, shift.riderId, shift.zoneId, shift.startedAt, shift.selfieUrl, shift.startLatE7, shift.startLonE7],
  );
}

/** Move the rider's own state. `riders.shift_state` is the flag dispatch reads through its zone index. */
export async function setShiftState(db: Db, riderId: Uint8Array, state: string): Promise<number> {
  const result = await db.execute("UPDATE `riders` SET `shift_state` = ? WHERE `id` = ?", [state, riderId]);
  return result.affectedRows;
}

/** Remove a shift that never really opened. Used only to unwind a start whose live row could not be written. */
export async function deleteShift(db: Db, shiftId: Uint8Array): Promise<number> {
  const result = await db.execute("DELETE FROM `rider_shifts` WHERE `id` = ?", [shiftId]);
  return result.affectedRows;
}

/**
 * Whether the rider may work in a zone that is not their home one.
 *
 * `rider_zone_assignments` is the grant (`06 §6`); `home_zone_id` is always allowed and needs no row, which
 * is why the route checks this only for a zone the body names. An assignment ends by `ended_at`, so a moved
 * rider keeps their history.
 */
export async function zoneIsAssigned(db: Db, riderId: Uint8Array, zoneId: Uint8Array): Promise<boolean> {
  const row = await db.first<Record<string, unknown>>(
    "SELECT `id` FROM `rider_zone_assignments` WHERE `rider_id` = ? AND `zone_id` = ? AND `ended_at` IS NULL LIMIT 1",
    [riderId, zoneId],
  );
  return row !== null;
}

/** What closing a shift writes. `end_reason` is constrained by the schema's own `CHECK` (`06 §6`). */
export interface ShiftClose {
  readonly shiftId: Uint8Array;
  readonly endedAt: string;
  readonly reason: string;
  readonly endLatE7: number | null;
  readonly endLonE7: number | null;
  readonly onlineSeconds: number;
}

/**
 * Close the shift, and only if it is still open.
 *
 * `WHERE ended_at IS NULL` is what makes this the decision rather than a write: two ends racing produce one
 * affected row and one zero, and the caller that gets zero is told the shift was already closed instead of
 * overwriting the moment it actually ended.
 */
export async function closeShift(db: Db, close: ShiftClose): Promise<number> {
  const result = await db.execute(
    "UPDATE `rider_shifts` SET `ended_at` = ?, `end_reason` = ?, `end_lat_e7` = ?, `end_lon_e7` = ?, " +
      "`online_seconds` = ? WHERE `id` = ? AND `ended_at` IS NULL",
    [close.endedAt, close.reason, close.endLatE7, close.endLonE7, close.onlineSeconds, close.shiftId],
  );
  return result.affectedRows;
}

/**
 * Orders the rider is still on the hook for.
 *
 * `RIDER_ASSIGNED`, `PICKED_UP` and `ARRIVED` are the three states in which food is in the rider's hands or
 * about to be (`11 §4`). Ending a shift in any of them leaves a customer watching a marker that stopped moving
 * and a meal nobody is bringing, so the end is refused rather than the order reassigned behind the rider.
 */
export async function countActiveOrders(db: Db, riderId: Uint8Array): Promise<number> {
  const row = await db.first<{ n: number | string }>(
    "SELECT COUNT(*) AS `n` FROM `orders` WHERE `rider_id` = ? AND `state` IN ('RIDER_ASSIGNED', 'PICKED_UP', 'ARRIVED')",
    [riderId],
  );
  return row === null ? 0 : Number(row.n);
}

/**
 * What the rider still owes in cash, in paisa. `0` when they owe nothing or have no balance row yet.
 *
 * The column is generated (`collected − deposited`) and the table holds one row per rider, so this is one
 * primary-key-ish read rather than arithmetic over orders (`25 §2`).
 */
export async function cashOutstandingPaisa(db: Db, riderId: Uint8Array): Promise<number> {
  const row = await db.first<{ outstanding_paisa: number | string | null }>(
    "SELECT `outstanding_paisa` FROM `rider_cash_balances` WHERE `rider_id` = ? LIMIT 1",
    [riderId],
  );
  const value = row === null ? null : row.outstanding_paisa;
  return value === null || value === undefined ? 0 : Math.max(0, Number(value));
}
