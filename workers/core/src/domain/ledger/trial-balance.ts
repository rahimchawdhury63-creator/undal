/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../../db/client.ts";

import { byAccount } from "./closure.ts";
import { ledgerAccountKind } from "./balance.ts";
import { safeLedgerNumber, sqlLedgerInteger } from "./exact.ts";
import { naturalBalance } from "./accounts.ts";
import type { AccountKind, Posting } from "./types.ts";

/**
 * The trial balance: every account's signed total, and the proof that they sum to zero.
 *
 * Equal total debits and credits are necessary, but not sufficient for correctness: this
 * report alone cannot detect duplicates, offsetting errors, missing rows, or unbalanced
 * entries that cancel each other. It is not a substitute for entry-level reconciliation.
 */

/** One account's line in the balance. */
export interface TrialBalanceLine {
  readonly accountCode: string;
  /** Signed paisa: positive debit, negative credit. */
  readonly rawPaisa: number;
  /** The figure a human reads, sign-converted for the account's kind. */
  readonly naturalPaisa: number;
}

/** The balance, with its own proof attached. */
export interface TrialBalance {
  readonly lines: readonly TrialBalanceLine[];
  readonly debitTotalPaisa: number;
  readonly creditTotalPaisa: number;
  /** Always zero for a ledger that closes; the test asserts it, the panel shows it. */
  readonly differencePaisa: number;
}

/** Compute totals exactly, refusing results the number-based report cannot represent. */
function makeTrialBalance(totals: Iterable<readonly [string, number, AccountKind]>): TrialBalance {
  const lines: TrialBalanceLine[] = [];
  let debits = 0n;
  let credits = 0n;
  for (const [code, raw, kind] of totals) {
    lines.push({ accountCode: code, rawPaisa: raw, naturalPaisa: naturalBalance(kind, raw) });
    if (raw > 0) debits += BigInt(raw);
    else credits -= BigInt(raw);
  }
  return { lines, debitTotalPaisa: safeLedgerNumber(debits), creditTotalPaisa: safeLedgerNumber(credits),
    differencePaisa: safeLedgerNumber(debits - credits) };
}

/** Compute the balance from postings already in memory. */
export function trialBalance(postings: readonly Posting[], kinds: ReadonlyMap<string, AccountKind>): TrialBalance {
  const totals = byAccount(postings);
  return makeTrialBalance([...totals.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)).map(([code, raw]) => {
    return [code, raw, ledgerAccountKind(kinds.get(code))] as const;
  }));
}

/** Normalize a UTC DATETIME(6) boundary without losing microsecond precision. */
function reportBoundary(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z?$/u.exec(value);
  if (!match) throw new RangeError("invalid ledger report time boundary");
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  const y = Number(year), m = Number(month), d = Number(day), h = Number(hour), min = Number(minute), s = Number(second);
  if (y < 1000 || h > 23 || min > 59 || s > 59 || m < 1 || m > 12 || d < 1 || d > 31) {
    throw new RangeError("invalid ledger report time boundary");
  }
  const date = new Date(Date.UTC(y, m - 1, d, h, min, s));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m || date.getUTCDate() !== d) {
    throw new RangeError("invalid ledger report time boundary");
  }
  return `${year}-${month}-${day} ${hour}:${minute}:${second}.${fraction.padEnd(6, "0")}`;
}

/** The balance over a period, read from the database. */
export async function trialBalanceFromDb(
  db: Db,
  input: { fromIso: string; toIso: string },
): Promise<TrialBalance> {
  const from = reportBoundary(input.fromIso);
  const to = reportBoundary(input.toIso);
  if (from >= to) throw new RangeError("ledger report interval must be increasing");
  const rows = await db.query<{ code: string; kind: unknown; total: unknown }>(
    "SELECT a.`code`, a.`kind`, SUM(p.`amount_paisa`) AS total " +
      "FROM `ledger_postings` p JOIN `ledger_accounts` a ON a.`id` = p.`account_id` " +
      "JOIN `ledger_entries` e ON e.`id` = p.`entry_id` " +
      "WHERE e.`occurred_at` >= ? AND e.`occurred_at` < ? GROUP BY a.`code`, a.`kind` ORDER BY a.`code`",
    [from, to],
  );
  return makeTrialBalance(rows.map((row) => [row.code, sqlLedgerInteger(row.total), ledgerAccountKind(row.kind)] as const));
}
