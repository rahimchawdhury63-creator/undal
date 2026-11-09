/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../../db/client.ts";

import { sumPaisa } from "./closure.ts";
import { sqlLedgerCount, sqlLedgerInteger } from "./exact.ts";
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
  const signed = sumPaisa(postings);
  const first = postings[0];
  if (first && postings.some((posting) => posting.account.code !== first.account.code || posting.account.kind !== first.account.kind)) {
    throw new RangeError("account balance includes different accounts");
  }
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
  if (options.asOfSequence !== undefined) throw new RangeError("historical ledger sequence is not available");
  const rows = await db.query<{ code: string; kind: string; signed: unknown; postings: unknown }>(
    `SELECT a.\`code\` AS \`code\`, a.\`kind\` AS \`kind\`,
            COALESCE(SUM(p.\`amount_paisa\`), 0) AS \`signed\`,
            COUNT(p.\`id\`) AS \`postings\`
       FROM \`ledger_accounts\` a
       LEFT JOIN \`ledger_postings\` p ON p.\`account_id\` = a.\`id\`
      GROUP BY a.\`code\`, a.\`kind\`
      ORDER BY a.\`code\``,
  );

  return rows.map((row) => {
    const signed = sqlLedgerInteger(row.signed);
    const kind = ledgerAccountKind(row.kind);
    return {
      code: row.code,
      kind,
      signedPaisa: signed,
      naturalPaisa: naturalBalance(kind, signed),
      postings: sqlLedgerCount(row.postings),
    };
  });
}

/** The balance of one account, or null when the account has never been used. */
export async function balanceOf(db: Db, code: string): Promise<AccountBalance | null> {
  const kind = kindOfCode(code);
  const rows = await db.query<{ kind: unknown; signed: unknown; postings: unknown }>(
    `SELECT a.\`kind\` AS \`kind\`, COALESCE(SUM(p.\`amount_paisa\`), 0) AS \`signed\`, COUNT(p.\`id\`) AS \`postings\`
       FROM \`ledger_accounts\` a
       LEFT JOIN \`ledger_postings\` p ON p.\`account_id\` = a.\`id\`
      WHERE a.\`code\` = ? GROUP BY a.\`code\`, a.\`kind\``,
    [code],
  );
  const row = rows[0];
  if (row === undefined) return null;
  if (ledgerAccountKind(row.kind) !== kind) throw new RangeError("ledger account kind disagrees with its code");
  const signed = sqlLedgerInteger(row.signed);
  return {
    code,
    kind,
    signedPaisa: signed,
    naturalPaisa: naturalBalance(kind, signed),
    postings: sqlLedgerCount(row.postings),
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

/** Reject corrupt or unexpected account kinds instead of silently presenting an asset. */
export function ledgerAccountKind(value: unknown): AccountKind {
  if (value !== "ASSET" && value !== "LIABILITY" && value !== "REVENUE" && value !== "EXPENSE" && value !== "EQUITY") {
    throw new RangeError("invalid ledger account kind");
  }
  return value;
}
