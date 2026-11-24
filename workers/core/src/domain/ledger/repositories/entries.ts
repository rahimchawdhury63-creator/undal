/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../../../db/client.ts";

/**
 * Reading ledger entries back.
 *
 * `ledger_entries` has no sequence column. Creation time and ID give a stable display
 * order but are not a commit order, an audit sequence, or a historical snapshot boundary.
 */

/** The columns of a `ledger_entries` row this repository returns. */
export interface EntryRow {
  readonly id: Uint8Array;
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
    "SELECT `id`, `entry_type`, `description`, `order_id`, `invoice_id`, `settlement_id`, `reverses_id`, `occurred_at`, `created_at` FROM `ledger_entries` WHERE `id` = ?",
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
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("ledger entry limit must be a positive integer");
  const bounded = Math.min(limit, 200);
  return db.query<EntryRow>(
    "SELECT `id`, `entry_type`, `description`, `order_id`, `invoice_id`, `settlement_id`, `reverses_id`, `occurred_at`, `created_at` FROM `ledger_entries` ORDER BY `created_at` DESC, `id` DESC LIMIT ?",
    [bounded],
  );
}
