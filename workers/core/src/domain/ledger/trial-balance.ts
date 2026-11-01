/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../../db/client.ts";

import { byAccount } from "./closure.ts";
import { naturalBalance } from "./accounts.ts";
import type { AccountKind, Posting } from "./types.ts";

/**
 * The trial balance: every account's signed total, and the proof that they sum to zero.
 *
 * A ledger that closes entry by entry still has to close in aggregate, and the aggregate is
 * what catches the bug closure cannot: an entry posted twice with a compensating correction
 * that landed on the wrong account. The property test runs this over a hundred thousand
 * postings; the nightly job runs it over the whole table.
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

/** Compute the balance from postings already in memory. */
export function trialBalance(postings: readonly Posting[], kinds: ReadonlyMap<string, AccountKind>): TrialBalance {
  const totals = byAccount(postings);
  const lines: TrialBalanceLine[] = [];
  let debits = 0;
  let credits = 0;

  for (const [code, raw] of [...totals.entries()].sort(([left], [right]) => (left < right ? -1 : 1))) {
    const kind = kinds.get(code) ?? "ASSET";
    lines.push({ accountCode: code, rawPaisa: raw, naturalPaisa: naturalBalance(kind, raw) });
    if (raw > 0) debits += raw;
    else credits += -raw;
  }

  return { lines, debitTotalPaisa: debits, creditTotalPaisa: credits, differencePaisa: debits - credits };
}

/** The balance over a period, read from the database. */
export async function trialBalanceFromDb(
  db: Db,
  input: { fromIso: string; toIso: string },
): Promise<TrialBalance> {
  const rows = await db.query<{ code: string; kind: string; total: number | string | null }>(
    "SELECT a.`code`, a.`kind`, SUM(p.`amount_paisa`) AS total " +
      "FROM `ledger_postings` p JOIN `ledger_accounts` a ON a.`id` = p.`account_id` " +
      "JOIN `ledger_entries` e ON e.`id` = p.`entry_id` " +
      "WHERE e.`occurred_at` >= ? AND e.`occurred_at` < ? GROUP BY a.`code`, a.`kind` ORDER BY a.`code`",
    [input.fromIso, input.toIso],
  );

  const kinds = new Map<string, AccountKind>();
  const lines: TrialBalanceLine[] = [];
  let debits = 0;
  let credits = 0;
  for (const row of rows) {
    const raw = Number(row.total ?? 0);
    const kind = row.kind as AccountKind;
    kinds.set(row.code, kind);
    lines.push({ accountCode: row.code, rawPaisa: raw, naturalPaisa: naturalBalance(kind, raw) });
    if (raw > 0) debits += raw;
    else credits += -raw;
  }
  return { lines, debitTotalPaisa: debits, creditTotalPaisa: credits, differencePaisa: debits - credits };
}
