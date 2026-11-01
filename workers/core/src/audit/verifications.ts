/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../db/client.ts";
import { sqlDatetime } from "../db/time.ts";
import { newId } from "../lib/ids.ts";

import type { VerifyReport } from "./verify.ts";

/**
 * The record that a verification happened, and what it found.
 *
 * `audit_verifications` exists because "we verify the chain nightly" is a claim, and a claim
 * with no rows is a claim nobody can check. Each run writes its range, its last hash and its
 * break count, so the admin panel can show a green tick that means something and an auditor
 * can see when the chain was last proven rather than asserted.
 */

/** Which of the three outcomes a run had, matching the column's comment. */
export type VerificationResult = "OK" | "BREAK" | "ERROR";

/** What one verification run writes. */
export interface VerificationRecord {
  readonly fromSeq: number;
  readonly toSeq: number;
  readonly result: VerificationResult;
  /** The first sequence number that did not verify, when `result` is `BREAK`. */
  readonly breakSeq: number | null;
  readonly durationMs: number;
  readonly triggeredBy: "DEPLOY" | "ADMIN" | "NIGHTLY";
  readonly ranAt: Date;
}

/**
 * Build the record from a report.
 *
 * `ERROR` is distinct from `BREAK` on purpose: a run that could not read the table proved
 * nothing, and a dashboard that shows it as a passing verification is worse than one that
 * shows nothing at all.
 */
export function recordOf(
  report: VerifyReport,
  fromSeq: number,
  ranAt: Date,
  options: { durationMs: number; triggeredBy: VerificationRecord["triggeredBy"] },
): VerificationRecord {
  const firstBreak = report.breaks[0];
  return {
    fromSeq,
    toSeq: fromSeq + report.rows - 1,
    result: firstBreak === undefined ? "OK" : "BREAK",
    breakSeq: firstBreak === undefined ? null : firstBreak.seq,
    durationMs: options.durationMs,
    triggeredBy: options.triggeredBy,
    ranAt,
  };
}

/**
 * Persist a run.
 *
 * A run with a break is still written: the row is the evidence that the chain was broken and
 * when it was noticed, which is the first question in an incident review. Deleting the record
 * to keep a dashboard green would be the one unrecoverable mistake here.
 */
export async function saveVerification(db: Db, record: VerificationRecord): Promise<void> {
  await db.execute(
    "INSERT INTO `audit_verifications` (`id`, `ran_at`, `from_seq`, `to_seq`, `result`, `break_seq`, `duration_ms`, `trigger_by`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      newId(record.ranAt.getTime()),
      sqlDatetime(record.ranAt),
      record.fromSeq,
      record.toSeq,
      record.result,
      record.breakSeq,
      record.durationMs,
      record.triggeredBy,
    ],
  );
}

/** The most recent verification, for the trust panel. */
export async function lastVerification(db: Db): Promise<VerificationRecord | null> {
  const row = await db.first<{
    from_seq: number | string;
    to_seq: number | string;
    result: string;
    break_seq: number | string | null;
    duration_ms: number | string;
    trigger_by: string;
    ran_at: string;
  }>(
    "SELECT `from_seq`, `to_seq`, `result`, `break_seq`, `duration_ms`, `trigger_by`, `ran_at` " +
      "FROM `audit_verifications` ORDER BY `ran_at` DESC LIMIT 1",
  );
  if (row === null) return null;
  return {
    fromSeq: Number(row.from_seq),
    toSeq: Number(row.to_seq),
    result: row.result as VerificationResult,
    breakSeq: row.break_seq === null ? null : Number(row.break_seq),
    durationMs: Number(row.duration_ms),
    triggeredBy: row.trigger_by as VerificationRecord["triggeredBy"],
    ranAt: new Date(`${row.ran_at.replace(" ", "T")}Z`),
  };
}
