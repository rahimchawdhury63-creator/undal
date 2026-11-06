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
  /**
   * What the platform actually accepted, which is the claim itself unless a reviewer took a partial payment (D147).
   *
   * `null` on anything not accepted — a rejected or escalated row, or a `CONFIRMED` one written before migration `022`.
   * Null means "not stated", never zero: an approval of nothing that released a rider would be the one reading this
   * column must not produce.
   */
  readonly approvedPaisa: number | null;
  readonly method: string;
  readonly trxId: string | null;
  readonly status: string;
  readonly createdAt: string;
  /** Why a rejection was made, in the register's vocabulary. Null on anything not rejected. */
  readonly rejectionReason: string | null;
  /** The reviewer's own sentence, which the rider's screen shows beneath the code. */
  readonly rejectionNote: string | null;
  /**
   * When the claim was escalated to a senior reviewer, or `null` (D146).
   *
   * A timestamp rather than a status, because an escalation is not a verdict: the claim is still `PENDING` and still
   * waiting for somebody to decide whether the money arrived. What the timestamp changes is whether the rider waits too.
   */
  readonly escalatedAt: string | null;
  /** Why it was escalated, for the reviewer who inherits it. */
  readonly escalationNote: string | null;
}

const SETTLEMENT_COLUMNS =
  "`id`, `rider_id`, `amount_paisa`, `approved_paisa`, `method`, `trx_id`, `status`, `created_at`, `rejection_reason`, "
  "`rejection_note`, " +
  "`escalated_at`, `escalation_note`";

/** One row, as the driver returns it. */
function rowOf(raw: Record<string, unknown>): SettlementRow {
  return {
    id: raw["id"] instanceof Uint8Array ? raw["id"] : new Uint8Array(16),
    riderId: raw["rider_id"] instanceof Uint8Array ? toHexId(raw["rider_id"]) : "",
    amountPaisa: Number(raw["amount_paisa"] ?? 0),
    approvedPaisa: raw["approved_paisa"] === null || raw["approved_paisa"] === undefined ? null : Number(raw["approved_paisa"]),
    method: String(raw["method"] ?? ""),
    trxId: typeof raw["trx_id"] === "string" ? raw["trx_id"] : null,
    status: String(raw["status"] ?? ""),
    createdAt: String(raw["created_at"] ?? ""),
    rejectionReason: typeof raw["rejection_reason"] === "string" ? raw["rejection_reason"] : null,
    rejectionNote: typeof raw["rejection_note"] === "string" ? raw["rejection_note"] : null,
    escalatedAt: typeof raw["escalated_at"] === "string" ? raw["escalated_at"] : null,
    escalationNote: typeof raw["escalation_note"] === "string" ? raw["escalation_note"] : null,
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
  approvedPaisa: number,
  nowMs: number,
): Promise<boolean> {
  const result = await db.execute(
    "UPDATE `rider_cash_settlements` SET `status` = 'CONFIRMED', `confirmed_by` = ?, `confirmed_at` = ?, " +
      "`approved_paisa` = ? WHERE `id` = ? AND `status` = 'PENDING'",
    [confirmedBy, sqlDatetime(new Date(nowMs)), approvedPaisa, id],
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
    "UPDATE `rider_cash_settlements` SET `status` = 'PENDING', `confirmed_by` = NULL, `confirmed_at` = NULL, " +
      "`approved_paisa` = NULL WHERE `id` = ? AND `status` = 'CONFIRMED'",
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

/**
 * Record a refusal: the one statement a rejection needs.
 *
 * Unlike approval this touches no balance and posts no entry — a refusal moves no money, which is the whole difference
 * between the two decisions and the reason this route needs no compensation path. It rewrites the same `PENDING` guard,
 * so a reviewer who approves while another rejects gets one answer and one audit row rather than two verdicts in the
 * table.
 */
export async function rejectSettlement(
  db: Db,
  id: Uint8Array,
  confirmedBy: Uint8Array,
  reason: string,
  note: string | null,
  nowMs: number,
): Promise<boolean> {
  const result = await db.execute(
    "UPDATE `rider_cash_settlements` SET `status` = 'REJECTED', `confirmed_by` = ?, `confirmed_at` = ?, " +
      "`rejection_reason` = ?, `rejection_note` = ? WHERE `id` = ? AND `status` = 'PENDING'",
    [confirmedBy, sqlDatetime(new Date(nowMs)), reason, note, id],
  );
  return result.affectedRows > 0;
}

/** One row of the reviewer's queue: the claim, the evidence, and who made it. */
export interface QueueRow {
  readonly id: string;
  readonly riderId: string;
  readonly riderName: string | null;
  readonly riderCode: string | null;
  readonly amountPaisa: number;
  readonly method: string;
  readonly trxId: string | null;
  readonly submittedAt: string;
  readonly numberMatches: boolean | null;
  readonly nameMatches: boolean | null;
  readonly screenshotUrl: string | null;
  readonly selfieUrl: string | null;
  /** Set when a reviewer escalated the claim: still pending, but no longer making the rider wait (D146). */
  readonly escalatedAt: string | null;
  readonly escalationNote: string | null;
}

/**
 * The claims waiting for a human, oldest first.
 *
 * Oldest first because the queue's ordering *is* its fairness rule: `25 §8` auto-lifts a claim after two hours, so the
 * top of this list is the claim closest to being released without review. Newest-first — the natural ORDER BY a
 * developer writes — would show the reviewer the claims with the most slack and let the urgent ones age out of sight.
 *
 * The evidence columns come along because the reviewer's decision is about them (`§6`): a number that matches and a
 * screenshot that shows the transaction are what separates an approval from a refusal, and a queue that made the
 * reviewer fetch each row separately would be a queue nobody works through.
 */
export async function pendingSettlements(db: Db, limit: number): Promise<QueueRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    "SELECT s.`id`, s.`rider_id`, r.`full_name`, r.`code`, s.`amount_paisa`, s.`method`, s.`trx_id`, s.`created_at`, " +
      "s.`number_matches`, s.`name_matches`, s.`screenshot_url`, s.`selfie_url`, s.`escalated_at`, s.`escalation_note` " +
      "FROM `rider_cash_settlements` s JOIN `riders` r ON r.`id` = s.`rider_id` " +
      "WHERE s.`status` = 'PENDING' ORDER BY s.`created_at` ASC LIMIT ?",
    [limit],
  );
  return rows.map((raw) => ({
    id: raw["id"] instanceof Uint8Array ? toHexId(raw["id"]) : "",
    riderId: raw["rider_id"] instanceof Uint8Array ? toHexId(raw["rider_id"]) : "",
    riderName: typeof raw["full_name"] === "string" ? raw["full_name"] : null,
    riderCode: typeof raw["code"] === "string" ? raw["code"] : null,
    amountPaisa: Number(raw["amount_paisa"] ?? 0),
    method: String(raw["method"] ?? ""),
    trxId: typeof raw["trx_id"] === "string" ? raw["trx_id"] : null,
    submittedAt: String(raw["created_at"] ?? ""),
    numberMatches: raw["number_matches"] === null ? null : Boolean(raw["number_matches"]),
    nameMatches: raw["name_matches"] === null ? null : Boolean(raw["name_matches"]),
    screenshotUrl: typeof raw["screenshot_url"] === "string" ? raw["screenshot_url"] : null,
    selfieUrl: typeof raw["selfie_url"] === "string" ? raw["selfie_url"] : null,
    escalatedAt: typeof raw["escalated_at"] === "string" ? raw["escalated_at"] : null,
    escalationNote: typeof raw["escalation_note"] === "string" ? raw["escalation_note"] : null,
  }));
}

/**
 * Escalate a claim to a senior reviewer, and release the rider while it is reviewed (`25 §6.1`, D146).
 *
 * One statement, guarded twice: `status = 'PENDING'` so a claim somebody already approved cannot be escalated, and
 * `escalated_at IS NULL` so a second escalation is refused rather than overwriting the note the first one left. No
 * money moves — the debt stays on the books as outstanding, because releasing a rider is not forgiving a debt.
 */
export async function escalateSettlement(
  db: Db,
  id: Uint8Array,
  escalatedBy: Uint8Array,
  note: string | null,
  nowMs: number,
): Promise<boolean> {
  const result = await db.execute(
    "UPDATE `rider_cash_settlements` SET `escalated_at` = ?, `escalated_by` = ?, `escalation_note` = ? " +
      "WHERE `id` = ? AND `status` = 'PENDING' AND `escalated_at` IS NULL",
    [sqlDatetime(new Date(nowMs)), escalatedBy, note, id],
  );
  return result.affectedRows > 0;
}
