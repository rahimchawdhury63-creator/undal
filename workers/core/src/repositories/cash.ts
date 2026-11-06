/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The rows of `rider_cash_settlements` (D141).
 *
 * Three reads and one write, and the reads exist because of two rules in `25 §5` that are about the *history* of a
 * claim rather than about the claim itself:
 *
 * **A transaction ID is unique across every settlement ever.** Not per rider, not per day: a bKash TrxID is the payment,
 * and `uq_cash_settlement_trx` enforces it across the table. This module checks before writing so the rider gets
 * `CASH_TRXID_DUPLICATE` — a message about their input — rather than a driver error about a constraint.
 *
 * **A submission is idempotent.** The app queues offline and retries, so the same claim can arrive twice; the second one
 * must answer with the first rather than creating a second pending settlement that a reviewer would read as two
 * payments. That is why the duplicate read returns the row and the route compares its rider.
 */

import type { Db } from "../db/client.ts";
import { sqlDatetime } from "../db/time.ts";
import { newId, toHexId } from "../lib/ids.ts";
import type { SettlementMethod } from "../domain/rider/cash.ts";

/** A settlement as stored, as much of it as a caller needs to answer with. */
export interface SettlementRow {
  readonly id: Uint8Array;
  readonly riderId: string;
  readonly amountPaisa: number;
  readonly method: string;
  readonly trxId: string | null;
  readonly status: string;
  readonly createdAt: string;
}

const SETTLEMENT_COLUMNS =
  "`id`, `rider_id`, `amount_paisa`, `method`, `trx_id`, `status`, `created_at`";

/** One row, as the driver returns it. */
function rowOf(raw: Record<string, unknown>): SettlementRow {
  return {
    id: raw["id"] instanceof Uint8Array ? raw["id"] : new Uint8Array(16),
    riderId: raw["rider_id"] instanceof Uint8Array ? toHexId(raw["rider_id"]) : "",
    amountPaisa: Number(raw["amount_paisa"] ?? 0),
    method: String(raw["method"] ?? ""),
    trxId: typeof raw["trx_id"] === "string" ? raw["trx_id"] : null,
    status: String(raw["status"] ?? ""),
    createdAt: String(raw["created_at"] ?? ""),
  };
}

/** The settlement that already holds this transaction ID, or `null`. */
export async function settlementByTrx(db: Db, trxId: string): Promise<SettlementRow | null> {
  const row = await db.first<Record<string, unknown>>(
    `SELECT ${SETTLEMENT_COLUMNS} FROM \`rider_cash_settlements\` WHERE \`trx_id\` = ? LIMIT 1`,
    [trxId],
  );
  return row === null ? null : rowOf(row);
}

/**
 * The rider's settlement still waiting for a decision, or `null`.
 *
 * `PENDING` is the only status that blocks a second submission: a `CONFIRMED` row is history, and a `REJECTED` one is
 * precisely the state in which the rider is expected to submit again with corrected evidence (`25 §6.1`).
 */
export async function pendingSettlement(db: Db, riderId: Uint8Array): Promise<SettlementRow | null> {
  const row = await db.first<Record<string, unknown>>(
    `SELECT ${SETTLEMENT_COLUMNS} FROM \`rider_cash_settlements\` ` +
      "WHERE `rider_id` = ? AND `status` = 'PENDING' ORDER BY `created_at` DESC LIMIT 1",
    [riderId],
  );
  return row === null ? null : rowOf(row);
}

/** The most recent settlement of any status, which is what the cash screen shows under "last time". */
export async function latestSettlement(db: Db, riderId: Uint8Array): Promise<SettlementRow | null> {
  const row = await db.first<Record<string, unknown>>(
    `SELECT ${SETTLEMENT_COLUMNS} FROM \`rider_cash_settlements\` WHERE \`rider_id\` = ? ` +
      "ORDER BY `created_at` DESC LIMIT 1",
    [riderId],
  );
  return row === null ? null : rowOf(row);
}

/** The payout identity a claim is compared against: the number and the name the platform has on file. */
export interface PayoutIdentity {
  readonly payoutNumber: string | null;
  readonly payoutName: string | null;
  readonly fullName: string | null;
}

/** The rider's payout number and name, or an identity with nothing in it. */
export async function payoutIdentity(db: Db, riderId: Uint8Array): Promise<PayoutIdentity> {
  const row = await db.first<{ payout_number: unknown; payout_name: unknown; full_name: unknown }>(
    "SELECT `payout_number`, `payout_name`, `full_name` FROM `riders` WHERE `id` = ? LIMIT 1",
    [riderId],
  );
  if (row === null) return { payoutNumber: null, payoutName: null, fullName: null };
  return {
    payoutNumber: typeof row.payout_number === "string" && row.payout_number.length > 0 ? row.payout_number : null,
    payoutName: typeof row.payout_name === "string" && row.payout_name.length > 0 ? row.payout_name : null,
    fullName: typeof row.full_name === "string" && row.full_name.length > 0 ? row.full_name : null,
  };
}

/**
 * The shift the cash came from, or `null`.
 *
 * The settlement is submitted at the end of a shift, and by then the shift is already closed — so "the current shift"
 * is the wrong question and the most recently started one is the right one. It is stored for the reviewer's context
 * (`25 §6` shows the orders that generated the cash), not for any rule.
 */
export async function lastShiftId(db: Db, riderId: Uint8Array): Promise<Uint8Array | null> {
  const row = await db.first<{ id: unknown }>(
    "SELECT `id` FROM `rider_shifts` WHERE `rider_id` = ? ORDER BY `started_at` DESC LIMIT 1",
    [riderId],
  );
  return row !== null && row.id instanceof Uint8Array ? row.id : null;
}

/** What one submission writes. The claim and the verdict on it, in one row. */
export interface SettlementWrite {
  readonly riderId: Uint8Array;
  readonly shiftId: Uint8Array | null;
  readonly amountPaisa: number;
  readonly method: SettlementMethod;
  readonly trxId: string;
  readonly bkashNumber: string;
  readonly accountName: string;
  readonly screenshotUrl: string;
  readonly selfieUrl: string;
  readonly numberMatches: boolean | null;
  readonly nameMatches: boolean | null;
}

/**
 * Write the submission as `PENDING` and return its id.
 *
 * `proof_media_id` stays null: the screenshot arrives as a Cloudinary URL rather than as a `media` row, because the
 * upload happens on the device and the settlement screen must work while the media pipeline is cold. The URL is the
 * evidence a reviewer opens (`25 §6`), and `selfie_url` is the second one.
 */
export async function writeSettlement(db: Db, write: SettlementWrite, nowMs: number): Promise<Uint8Array> {
  const id = newId(nowMs);
  await db.execute(
    "INSERT INTO `rider_cash_settlements` (`id`, `rider_id`, `shift_id`, `amount_paisa`, `method`, `trx_id`, " +
      "`bkash_number`, `account_name`, `screenshot_url`, `proof_media_id`, `selfie_url`, `number_matches`, " +
      "`name_matches`, `status`, `created_at`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)",
    [
      id,
      write.riderId,
      write.shiftId,
      write.amountPaisa,
      write.method,
      write.trxId,
      write.bkashNumber,
      write.accountName,
      write.screenshotUrl,
      null,
      write.selfieUrl,
      write.numberMatches === null ? null : write.numberMatches ? 1 : 0,
      write.nameMatches === null ? null : write.nameMatches ? 1 : 0,
      sqlDatetime(new Date(nowMs)),
    ],
  );
  return id;
}

/** A settlement as a reviewer reads it: the claim, its status, and who decided it. */
export interface ReviewRow extends SettlementRow {
  readonly confirmedAt: string | null;
}

/** One settlement by id, whatever its status — the row an approval is about. */
export async function settlementById(db: Db, id: Uint8Array): Promise<ReviewRow | null> {
  const row = await db.first<Record<string, unknown>>(
    `SELECT ${SETTLEMENT_COLUMNS}, \`confirmed_at\` FROM \`rider_cash_settlements\` WHERE \`id\` = ? LIMIT 1`,
    [id],
  );
  if (row === null) return null;
  return { ...rowOf(row), confirmedAt: row["confirmed_at"] === null ? null : String(row["confirmed_at"]) };
}

/**
 * Take the decision, and learn whether this request took it.
 *
 * `AND status = 'PENDING'` is the whole concurrency story: two reviewers opening the same claim at 09:00 and 09:01 both
 * see it pending, and exactly one of them gets `affectedRows = 1`. The loser is told the settlement is already settled
 * rather than silently posting a second entry — which is what a plain `UPDATE ... WHERE id = ?` would do.
 */
export async function claimSettlement(
  db: Db,
  id: Uint8Array,
  confirmedBy: Uint8Array,
  nowMs: number,
): Promise<boolean> {
  const result = await db.execute(
    "UPDATE `rider_cash_settlements` SET `status` = 'CONFIRMED', `confirmed_by` = ?, `confirmed_at` = ? " +
      "WHERE `id` = ? AND `status` = 'PENDING'",
    [confirmedBy, sqlDatetime(new Date(nowMs)), id],
  );
  return result.affectedRows > 0;
}

/**
 * Give the claim back, for the one case where the platform could not finish.
 *
 * Approving is three statements — the status, the deposit, the ledger entry — and TiDB autocommits each, so a failure in
 * the third leaves a `CONFIRMED` row with no ledger entry behind it: a rider released against money the books never saw.
 * Rather than leave that, the route unwinds and answers `500`; a reviewer retries and the retry takes the claim cleanly.
 */
export async function releaseClaim(db: Db, id: Uint8Array): Promise<void> {
  await db.execute(
    "UPDATE `rider_cash_settlements` SET `status` = 'PENDING', `confirmed_by` = NULL, `confirmed_at` = NULL " +
      "WHERE `id` = ? AND `status` = 'CONFIRMED'",
    [id],
  );
}

/**
 * Credit the deposit that the approval recognises.
 *
 * `deposited_paisa` is the only mutable column: `outstanding_paisa` is generated as `collected - deposited`, so the
 * balance and the block both follow from this one update rather than being recomputed and written by hand. `false`
 * means the rider has no balance row at all, which is a data question rather than a state: the route unwinds.
 */
export async function creditDeposit(db: Db, riderId: Uint8Array, amountPaisa: number, nowMs: number): Promise<boolean> {
  const result = await db.execute(
    "UPDATE `rider_cash_balances` SET `deposited_paisa` = `deposited_paisa` + ?, `updated_at` = ? WHERE `rider_id` = ?",
    [amountPaisa, sqlDatetime(new Date(nowMs)), riderId],
  );
  return result.affectedRows > 0;
}
