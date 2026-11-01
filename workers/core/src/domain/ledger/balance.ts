/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../../db/client.ts";

import { ALL_PLATFORM_ACCOUNTS, naturalBalance, parseAccountCode } from "./accounts.ts";
import type { AccountKind, Posting } from "./types.ts";

/**
 * What an account holds right now.
 *
 * The balance is a sum over the postings table and never a stored column: a cached balance is
 * a second source of truth, and the first time it drifts by a paisa nobody can say which of
 * the two the auditor should believe. The daily reconciliation compares these sums against
 * the provider's statement, so the sum has to be the definition.
 */

/** One account's signed total and its natural-side figure. */
export interface AccountBalance {
  readonly code: string;
  readonly kind: AccountKind | null;
  readonly signedPaisa: number;
  /** Positive when the account sits on the side its kind implies. */
  readonly naturalPaisa: number;
  readonly postings: number;
}

/** Sum postings in memory, for a test or a report that already has the rows. */
export function accountBalance(postings: readonly Posting[]): AccountBalance {
  let signed = 0;
  for (const posting of postings) signed += posting.amountPaisa;
  const kind = postings[0]?.account.kind ?? null;
  return {
    code: postings[0]?.account.code ?? "",
    kind,
    signedPaisa: signed,
    naturalPaisa: kind === null ? signed : naturalBalance(kind, signed),
    postings: postings.length,
  };
}

/**
 * Read every account's balance from the database.
 *
 * One grouped query, not one per account: a platform with four thousand vendors would
 * otherwise make a finance screen issue four thousand round trips over the HTTP driver,
 * which is both slow and a way to exhaust the connection pool during a payout run.
 */
export async function balancesFromDb(db: Db, options: { readonly asOfSequence?: number } = {}): Promise<AccountBalance[]> {
  const rows = await db.query<{ code: string; kind: string; signed: number | string; postings: number }>(
    `SELECT a.\`code\` AS \`code\`, a.\`kind\` AS \`kind\`,
            COALESCE(SUM(p.\`amount_paisa\`), 0) AS \`signed\`,
            COUNT(p.\`id\`) AS \`postings\`
       FROM \`ledger_accounts\` a
       LEFT JOIN \`ledger_postings\` p ON p.\`account_id\` = a.\`id\`
      WHERE (? = 0 OR p.\`entry_id\` IN (SELECT \`id\` FROM \`ledger_entries\` WHERE \`seq\` <= ?))
      GROUP BY a.\`code\`, a.\`kind\`
      ORDER BY a.\`code\``,
    [options.asOfSequence ?? 0, options.asOfSequence ?? 0],
  );

  return rows.map((row) => {
    const signed = Number(row.signed);
    const kind = row.kind as AccountKind;
    return {
      code: row.code,
      kind,
      signedPaisa: signed,
      naturalPaisa: naturalBalance(kind, signed),
      postings: Number(row.postings),
    };
  });
}

/** The balance of one account, or null when the account has never been used. */
export async function balanceOf(db: Db, code: string): Promise<AccountBalance | null> {
  const kind = kindOfCode(code);
  const rows = await db.query<{ signed: number | string; postings: number }>(
    `SELECT COALESCE(SUM(p.\`amount_paisa\`), 0) AS \`signed\`, COUNT(p.\`id\`) AS \`postings\`
       FROM \`ledger_postings\` p
       JOIN \`ledger_accounts\` a ON a.\`id\` = p.\`account_id\`
      WHERE a.\`code\` = ?`,
    [code],
  );
  const row = rows[0];
  if (row === undefined) return null;
  const signed = Number(row.signed);
  return {
    code,
    kind,
    signedPaisa: signed,
    naturalPaisa: naturalBalance(kind, signed),
    postings: Number(row.postings),
  };
}

/**
 * The kind an account code implies, without a database round trip.
 *
 * A platform code is looked up in the fourteen-account table; an owned code takes its kind
 * from its prefix, which is the only thing that decides it (`RIDER_CASH` is an asset because
 * the cash is in the rider's hand, everything else owned by a counterparty is a liability).
 */
export function kindOfCode(code: string): AccountKind {
  const platform = ALL_PLATFORM_ACCOUNTS.find((account) => account.code === code);
  if (platform !== undefined) return platform.kind;
  switch (parseAccountCode(code).prefix) {
    case "RIDER_CASH":
      return "ASSET";
    case "VENDOR":
    case "RIDER":
    case "CUSTOMER":
      return "LIABILITY";
    default:
      throw new RangeError(`unknown account code ${code}`);
  }
}
