/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../../../db/client.ts";

/**
 * Reading ledger entries back.
 *
 * Writes go through `post-entry.ts`, which asserts closure; reads live here so a finance
 * screen never has to construct SQL. Everything is ordered by `seq`, because `seq` is the
 * order the entries were posted in and `created_at` can tie within a millisecond.
 */

/** The columns of a `ledger_entries` row this repository returns. */
export interface EntryRow {
  readonly id: Uint8Array;
  readonly seq: number;
  readonly entry_type: string;
  readonly description: string;
  readonly order_id: Uint8Array | null;
  readonly invoice_id: Uint8Array | null;
  readonly settlement_id: Uint8Array | null;
  readonly reverses_id: Uint8Array | null;
  readonly occurred_at: string;
  readonly created_at: string;
}

/** The columns of a `ledger_postings` row this repository returns. */
export interface PostingRow {
  readonly account_id: Uint8Array;
  readonly code: string;
  readonly kind: string;
  readonly amount_paisa: number | string;
}

/** Read one entry, or null. */
export async function findEntry(db: Db, entryId: Uint8Array): Promise<EntryRow | null> {
  return db.first<EntryRow>(
    "SELECT `id`, `seq`, `entry_type`, `description`, `order_id`, `invoice_id`, `settlement_id`, `reverses_id`, `occurred_at`, `created_at` FROM `ledger_entries` WHERE `id` = ?",
    [entryId],
  );
}

/** Read an entry's postings joined to their account codes, in code order for stable output. */
export async function listPostings(db: Db, entryId: Uint8Array): Promise<PostingRow[]> {
  return db.query<PostingRow>(
    `SELECT p.\`account_id\` AS \`account_id\`, a.\`code\` AS \`code\`, a.\`kind\` AS \`kind\`, p.\`amount_paisa\` AS \`amount_paisa\`
       FROM \`ledger_postings\` p
       JOIN \`ledger_accounts\` a ON a.\`id\` = p.\`account_id\`
      WHERE p.\`entry_id\` = ?
      ORDER BY a.\`code\``,
    [entryId],
  );
}

/** The most recent entries, newest first, for the admin ledger browser. */
export async function recentEntries(db: Db, limit: number): Promise<EntryRow[]> {
  const bounded = Math.min(Math.max(1, Math.trunc(limit)), 200);
  return db.query<EntryRow>(
    "SELECT `id`, `seq`, `entry_type`, `description`, `order_id`, `invoice_id`, `settlement_id`, `reverses_id`, `occurred_at`, `created_at` FROM `ledger_entries` ORDER BY `seq` DESC LIMIT ?",
    [bounded],
  );
}
