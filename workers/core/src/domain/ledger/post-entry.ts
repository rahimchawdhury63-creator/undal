/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../../db/client.ts";
import { sqlDatetime } from "../../db/time.ts";
import { newId } from "../../lib/ids.ts";

import { assertClosed, sumPaisa, LedgerImbalanceError } from "./closure.ts";
import { ensureAccounts, uuidBytes } from "./repositories/accounts.ts";
import type { EntryType, Posting, PostingSet } from "./types.ts";

/**
 * Legacy autocommit posting path. The in-memory closure check precedes the entry and
 * multi-row postings writes; a later SQL sum check may attempt compensating deletes.
 * These statements are NOT atomic: failures and ambiguous acknowledgements can leave
 * partial state. The returned count-derived sequence is neither persisted nor safe as a
 * unique ordering. Do not use this path as evidence of financial production readiness.
 */

/** What a caller supplies to post an entry. */
export interface PostEntryInput extends PostingSet {
  /** When the money moved. Defaults to now, which is right for every live path. */
  readonly occurredAt?: Date | number;
  readonly createdBy?: string;
  /** The entry this one reverses, when it is a reversal. */
  readonly reversesId?: string;
  readonly nowMs?: number;
}

/** The result: the entry id and the postings, with their new ids. */
export interface PostedEntry {
  readonly entryId: string;
  readonly seq: number;
  readonly sumPaisa: number;
}

/** A sequence number for the entry, taken from the count so the ledger keeps an order. */
async function nextEntrySeq(db: Db): Promise<number> {
  const row = await db.first<{ entries: number | string }>("SELECT COUNT(*) AS entries FROM `ledger_entries`");
  return Number(row?.entries ?? 0) + 1;
}

/**
 * Post an entry.
 *
 * The SQL sum check and compensating delete are best effort, not a transaction. They
 * cannot establish atomicity or prove what happened after a lost acknowledgement.
 */
export async function postEntry(db: Db, input: PostEntryInput): Promise<PostedEntry> {
  assertClosed(input.entryType, input.postings);
  const nowMs = input.nowMs ?? Date.now();
  const occurredAt =
    input.occurredAt === undefined ? new Date(nowMs) : input.occurredAt instanceof Date ? input.occurredAt : new Date(input.occurredAt);
  const entryId = newId(nowMs);

  await ensureAccounts(db, input.postings.map((posting) => posting.account), nowMs);
  const seq = await nextEntrySeq(db);

  await db.execute(
    "INSERT INTO `ledger_entries` (`id`, `entry_type`, `order_id`, `invoice_id`, `settlement_id`, `description`, " +
      "`occurred_at`, `created_at`, `created_by`, `reverses_id`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      entryId,
      input.entryType,
      input.orderId === undefined ? null : uuidBytes(input.orderId),
      input.invoiceId === undefined ? null : uuidBytes(input.invoiceId),
      input.settlementId === undefined ? null : uuidBytes(input.settlementId),
      input.description,
      sqlDatetime(occurredAt),
      sqlDatetime(new Date(nowMs)),
      input.createdBy === undefined ? null : uuidBytes(input.createdBy),
      input.reversesId === undefined ? null : uuidBytes(input.reversesId),
    ],
  );

  const accountIds: Uint8Array[] = [];
  for (const posting of input.postings) accountIds.push(await accountIdFor(db, posting));

  const tuples = input.postings.map(() => "(?, ?, ?, ?, ?)").join(", ");
  const params: unknown[] = [];
  input.postings.forEach((posting, index) => {
    params.push(newId(nowMs), entryId, accountIds[index], posting.amountPaisa, sqlDatetime(new Date(nowMs)));
  });
  await db.execute(
    `INSERT INTO \`ledger_postings\` (\`id\`, \`entry_id\`, \`account_id\`, \`amount_paisa\`, \`created_at\`) VALUES ${tuples}`,
    params,
  );

  const total = await sumFromDatabase(db, entryId);
  if (total !== 0) {
    await discardEntry(db, entryId);
    throw new LedgerImbalanceError(input.entryType, total, input.postings);
  }

  return { entryId: uuidText(entryId), seq, sumPaisa: total };
}

/** The 16 bytes of an account id, which the posting insert needs and the domain shape lacks. */
async function accountIdFor(db: Db, posting: Posting): Promise<Uint8Array> {
  const row = await db.first<{ id: Uint8Array }>("SELECT `id` FROM `ledger_accounts` WHERE `code` = ?", [posting.account.code]);
  if (row === null) throw new Error(`account ${posting.account.code} disappeared before its posting was written`);
  return new Uint8Array(row.id);
}

/** The sum the database holds for an entry — not the sum the caller computed. */
async function sumFromDatabase(db: Db, entryId: Uint8Array): Promise<number> {
  const row = await db.first<{ total: number | string | null }>(
    "SELECT SUM(`amount_paisa`) AS total FROM `ledger_postings` WHERE `entry_id` = ?",
    [entryId],
  );
  return Number(row?.total ?? 0);
}

/** Remove an entry that failed its post-write assertion, postings first. */
async function discardEntry(db: Db, entryId: Uint8Array): Promise<void> {
  await db.execute("DELETE FROM `ledger_postings` WHERE `entry_id` = ?", [entryId]);
  await db.execute("DELETE FROM `ledger_entries` WHERE `id` = ?", [entryId]);
}

/** 16 bytes as the dashed UUID the API returns. */
function uuidText(bytes: Uint8Array): string {
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The sum a caller expects to see, exposed for the tests and the reconciliation report. */
export function expectedSum(postings: readonly Posting[]): number {
  return sumPaisa(postings);
}

/**
 * Whether an entry type may be reversed.
 *
 * Every type may, including an adjustment: a correction that was itself wrong has to be
 * correctable, and the chain of `reverses_id` links is what keeps the history readable.
 */
export function isReversible(_entryType: EntryType): boolean {
  return true;
}
