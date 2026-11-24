/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../../db/client.ts";
import { uuidBytes } from "./repositories/accounts.ts";

import { sqlLedgerInteger } from "./exact.ts";
import { postEntry, type PostedEntry } from "./post-entry.ts";
import type { EntryType, Posting } from "./types.ts";

/**
 * Reversal, never deletion.
 *
 * A wrong entry is corrected by posting its mirror image and linking the two. The original
 * stays in the ledger because the ledger's job is to record what was believed at the time,
 * and because an append-only table with `INSERT`-only grants has no other option — the
 * grant is the enforcement, and this module is the procedure that works within it.
 */

/** The mirror of a posting set: same accounts, every amount negated. */
export function reversePostings(postings: readonly Posting[]): Posting[] {
  return postings.map((posting) => ({ account: posting.account, amountPaisa: -posting.amountPaisa }));
}

/** The row shape a reversal reads. */
interface EntryRow {
  readonly id: Uint8Array;
  readonly entry_type: string;
  readonly description: string;
  readonly order_id: Uint8Array | null;
  readonly invoice_id: Uint8Array | null;
  readonly settlement_id: Uint8Array | null;
}

/** The posting rows of an entry. */
interface PostingRow {
  readonly code: string;
  readonly kind: string;
  readonly owner_type: string;
  readonly owner_id: Uint8Array | null;
  readonly amount_paisa: number | string;
}

/** Whether an entry has already been reversed, which must never happen twice. */
export async function isReversed(db: Db, entryId: string): Promise<boolean> {
  const row = await db.first<{ id: Uint8Array }>("SELECT `id` FROM `ledger_entries` WHERE `reverses_id` = ? LIMIT 1", [
    uuidBytes(entryId),
  ]);
  return row !== null;
}

/**
 * Reverse an entry by its id.
 *
 * Three refusals, each a way money goes wrong twice: an entry that does not exist, an entry
 * that is already reversed (the second reversal would double the correction), and a
 * reversal of a reversal (which would make the chain unwalkable and hide the original).
 */
export async function reverseEntry(
  db: Db,
  input: { entryId: string; reason: string; createdBy?: string; nowMs?: number },
): Promise<PostedEntry> {
  if (input.reason.trim().length < 8) throw new RangeError("a reversal needs a reason of at least eight characters");
  const entry = await db.first<EntryRow>(
    "SELECT `id`, `entry_type`, `description`, `order_id`, `invoice_id`, `settlement_id` FROM `ledger_entries` WHERE `id` = ?",
    [uuidBytes(input.entryId)],
  );
  if (entry === null) throw new RangeError(`entry ${input.entryId} does not exist`);
  if (await isReversed(db, input.entryId)) throw new RangeError(`entry ${input.entryId} is already reversed`);

  const rows = await db.query<PostingRow>(
    "SELECT a.`code`, a.`kind`, a.`owner_type`, a.`owner_id`, p.`amount_paisa` " +
      "FROM `ledger_postings` p JOIN `ledger_accounts` a ON a.`id` = p.`account_id` WHERE p.`entry_id` = ?",
    [entry.id],
  );
  if (rows.length === 0) throw new RangeError(`entry ${input.entryId} has no postings`);

  const postings: Posting[] = rows.map((row) => ({
    account: {
      code: row.code,
      kind: row.kind as Posting["account"]["kind"],
      ownerType: row.owner_type as Posting["account"]["ownerType"],
      ...(row.owner_id === null ? {} : { ownerId: hexUuid(new Uint8Array(row.owner_id)) }),
    },
    amountPaisa: -sqlLedgerInteger(row.amount_paisa),
  }));

  const nowMs = input.nowMs ?? Date.now();
  return postEntry(db, {
    entryType: entry.entry_type as EntryType,
    description: `Reversal of ${entry.entry_type}: ${input.reason.trim()}`.slice(0, 256),
    postings,
    occurredAt: new Date(nowMs),
    reversesId: input.entryId,
    ...(input.createdBy === undefined ? {} : { createdBy: input.createdBy }),
    ...(entry.order_id === null ? {} : { orderId: hexUuid(new Uint8Array(entry.order_id)) }),
    ...(entry.invoice_id === null ? {} : { invoiceId: hexUuid(new Uint8Array(entry.invoice_id)) }),
    ...(entry.settlement_id === null ? {} : { settlementId: hexUuid(new Uint8Array(entry.settlement_id)) }),
    nowMs,
  });
}

/** 16 bytes as a dashed UUID. */
function hexUuid(bytes: Uint8Array): string {
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
