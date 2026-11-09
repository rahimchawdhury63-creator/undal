/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../../db/client.ts";

import { sumPaisa, LedgerImbalanceError } from "./closure.ts";
import { trialBalanceFromDb, type TrialBalance } from "./trial-balance.ts";

/**
 * The `LEDGER_IMBALANCE` exception of `21 §8.1`: CRITICAL, immediate, no default action.
 *
 * `24 §1` says a trial balance that is not zero raises this exception. It is the only alarm in
 * the platform whose cause is certainly Undal's own arithmetic, which is why it carries the
 * severity that wakes somebody: a customer can have a bad evening, a rider can steal a phone,
 * but the ledger only fails to balance when the code is wrong.
 *
 * The exception is a value, not a side effect — the alarm pipeline (R13) owns delivery, the
 * ledger owns detection — so the same object can be tested without a webhook and raised from a
 * cron sweep, an admin button and a test without three code paths.
 */

/** The trigger name exactly as `21 §8.1` writes it. */
export const LEDGER_IMBALANCE_TRIGGER = "LEDGER_IMBALANCE";

/** Severity and SLA, from the same table. */
export const LEDGER_IMBALANCE_SEVERITY = "CRITICAL";
/** Immediate: the alarm pipeline must page, not queue. */
export const LEDGER_IMBALANCE_SLA_SECONDS = 0;

/** One exception row, shaped for the alarm pipeline to store and page on. */
export interface LedgerException {
  readonly trigger: typeof LEDGER_IMBALANCE_TRIGGER;
  readonly severity: typeof LEDGER_IMBALANCE_SEVERITY;
  readonly slaSeconds: number;
  /** The accounts that drifted, largest first, so the page names a starting point. */
  readonly accounts: readonly { readonly code: string; readonly signedPaisa: number }[];
  readonly differencePaisa: number;
  readonly debitTotalPaisa: number;
  readonly creditTotalPaisa: number;
  readonly messageEn: string;
  readonly messageBn: string;
}

/**
 * Turn a trial-balance report into the exception, or null when the books balance.
 *
 * Null rather than a "no exception" object: the caller's `if (exception !== null)` is then the
 * only way to act, and there is no shape that can be stored by mistake.
 */
export function imbalanceException(report: TrialBalance): LedgerException | null {
  if (report.differencePaisa === 0) return null;

  const accounts = report.lines
    .filter((line) => line.rawPaisa !== 0)
    .map((line) => ({ code: line.accountCode, signedPaisa: line.rawPaisa }))
    .sort((left, right) => Math.abs(right.signedPaisa) - Math.abs(left.signedPaisa))
    .slice(0, 20);

  return {
    trigger: LEDGER_IMBALANCE_TRIGGER,
    severity: LEDGER_IMBALANCE_SEVERITY,
    slaSeconds: LEDGER_IMBALANCE_SLA_SECONDS,
    accounts,
    differencePaisa: report.differencePaisa,
    debitTotalPaisa: report.debitTotalPaisa,
    creditTotalPaisa: report.creditTotalPaisa,
    messageEn: `The ledger does not balance: debits ${report.debitTotalPaisa} paisa, credits ${report.creditTotalPaisa} paisa, drift ${report.differencePaisa} paisa.`,
    messageBn: `খতিয়ানের হিসাব মিলছে না: ডেবিট ${report.debitTotalPaisa} পয়সা, ক্রেডিট ${report.creditTotalPaisa} পয়সা, ব্যবধান ${report.differencePaisa} পয়সা।`,
  };
}

/**
 * Read the books and return the exception if they do not balance.
 *
 * The sweep the nightly job runs, exported so the admin panel's "verify now" button and the
 * R13 alarm can call the same function: two implementations of "does it balance" would be one
 * implementation and one opinion.
 */
export async function checkLedgerBalance(db: Db, period: { readonly fromIso: string; readonly toIso: string }): Promise<LedgerException | null> {
  return imbalanceException(await trialBalanceFromDb(db, period));
}

/**
 * The exception a caught `LedgerImbalanceError` would have produced.
 *
 * A posting set that fails closed in memory never reaches the database, so there is no trial
 * balance to read — but the event still has to be visible, because it means a builder is
 * wrong. This converts the thrown error into the same exception shape, with the offending
 * entry named, so one alarm covers both detection paths.
 */
export function exceptionFromImbalance(error: LedgerImbalanceError): LedgerException {
  return {
    trigger: LEDGER_IMBALANCE_TRIGGER,
    severity: LEDGER_IMBALANCE_SEVERITY,
    slaSeconds: LEDGER_IMBALANCE_SLA_SECONDS,
    accounts: error.postings
      .filter((posting) => posting.amountPaisa !== 0)
      .map((posting) => ({ code: posting.account.code, signedPaisa: posting.amountPaisa }))
      .sort((left, right) => Math.abs(right.signedPaisa) - Math.abs(left.signedPaisa))
      .slice(0, 20),
    differencePaisa: error.sumPaisa,
    debitTotalPaisa: sumPaisa(error.postings.filter((posting) => posting.amountPaisa > 0)),
    creditTotalPaisa: Math.abs(sumPaisa(error.postings.filter((posting) => posting.amountPaisa < 0))),
    messageEn: `A ${error.entryType} posting set did not close: ${error.sumPaisa} paisa over ${error.postings.length} postings.`,
    messageBn: `একটি ${error.entryType} পোস্টিং সেট মেলেনি: ${error.postings.length}টি পোস্টিংয়ে ${error.sumPaisa} পয়সা বেশি।`,
  };
}
