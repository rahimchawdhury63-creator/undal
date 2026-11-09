/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../../db/client.ts";
import { sqlDatetime } from "../../db/time.ts";
import { constantTimeEqual, newId, toHexId } from "../../lib/ids.ts";
import { assertClosed } from "./closure.ts";
import { uuidBytes } from "./repositories/accounts.ts";
import type { PostEntryInput } from "./post-entry.ts";
import type { Account } from "./types.ts";

const MAX_POSTINGS = 100;

function ownerId(account: Account): Uint8Array | null {
  if (account.ownerType === "PLATFORM") {
    if (account.ownerId !== undefined) throw new RangeError("platform account cannot have an owner id");
    return null;
  }
  if (account.ownerId === undefined) throw new RangeError("owned account requires an owner id");
  return uuidBytes(account.ownerId);
}

function sameOwner(left: Uint8Array | null, right: Uint8Array | null): boolean {
  return left === null ? right === null : right !== null && constantTimeEqual(left, right);
}

/**
 * Write and verify a balanced entry using a caller-owned transaction.
 *
 * The caller MUST provide the Db from withTransaction/runCashOperation, await the call,
 * and let any exception abort that whole transaction. This function does not start or
 * commit one; passing an ordinary autocommit Db is unsafe. It performs no compensating
 * deletes. Accounts must already exist: their metadata is checked and locked in sorted
 * code order. Account provisioning and all surrounding balance, case, and audit changes
 * need their own atomic design. No production route currently uses this function.
 */
export async function postEntryInTransaction(tx: Db, input: PostEntryInput): Promise<{ entryId: string }> {
  if (input.postings.length > MAX_POSTINGS) throw new RangeError("too many ledger postings");
  // Avoid a caller mutating amounts or account metadata while database reads are in flight.
  input = { ...input, postings: input.postings.map((posting) => ({ ...posting, account: { ...posting.account } })),
    ...(input.occurredAt instanceof Date ? { occurredAt: new Date(input.occurredAt.getTime()) } : {}) };
  assertClosed(input.entryType, input.postings);

  const accounts = new Map<string, { account: Account; owner: Uint8Array | null }>();
  for (const posting of input.postings) {
    const account = posting.account;
    if (!["ASSET", "LIABILITY", "REVENUE", "EXPENSE", "EQUITY"].includes(account.kind) ||
        !["PLATFORM", "VENDOR", "RIDER", "CUSTOMER"].includes(account.ownerType)) {
      throw new RangeError("invalid ledger account metadata");
    }
    if (typeof account.code !== "string" || account.code.length === 0 || account.code.length > 48) throw new RangeError("invalid account code");
    const owner = ownerId(account);
    const previous = accounts.get(account.code);
    if (previous !== undefined && (previous.account.kind !== account.kind || previous.account.ownerType !== account.ownerType || !sameOwner(previous.owner, owner))) {
      throw new RangeError("conflicting account metadata in posting set");
    }
    accounts.set(account.code, { account, owner });
  }

  const ids = new Map<string, Uint8Array>();
  for (const code of [...accounts.keys()].sort()) {
    const expected = accounts.get(code)!;
    const row = await tx.first<{ id: unknown; code: unknown; kind: unknown; owner_type: unknown; owner_id: unknown; currency: unknown }>(
      "SELECT `id`, `code`, `kind`, `owner_type`, `owner_id`, `currency` FROM `ledger_accounts` WHERE `code` = ? FOR UPDATE", [code],
    );
    if (row === null || !(row.id instanceof Uint8Array) || row.id.length !== 16 || row.code !== code ||
        row.kind !== expected.account.kind || row.owner_type !== expected.account.ownerType || row.currency !== "BDT" ||
        !(row.owner_id === null || (row.owner_id instanceof Uint8Array && row.owner_id.length === 16)) ||
        !sameOwner(row.owner_id as Uint8Array | null, expected.owner)) {
      throw new Error(`missing or mismatched ledger account ${code}`);
    }
    ids.set(code, row.id.slice());
  }

  const nowMs = input.nowMs ?? Date.now();
  const occurredAt = input.occurredAt === undefined ? new Date(nowMs) :
    input.occurredAt instanceof Date ? input.occurredAt : new Date(input.occurredAt);
  const entryId = newId(nowMs);
  const inserted = await tx.execute(
    "INSERT INTO `ledger_entries` (`id`, `entry_type`, `order_id`, `invoice_id`, `settlement_id`, `description`, " +
      "`occurred_at`, `created_at`, `created_by`, `reverses_id`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [entryId, input.entryType, input.orderId === undefined ? null : uuidBytes(input.orderId),
      input.invoiceId === undefined ? null : uuidBytes(input.invoiceId), input.settlementId === undefined ? null : uuidBytes(input.settlementId),
      input.description, sqlDatetime(occurredAt), sqlDatetime(new Date(nowMs)),
      input.createdBy === undefined ? null : uuidBytes(input.createdBy), input.reversesId === undefined ? null : uuidBytes(input.reversesId)],
  );
  if (inserted.affectedRows !== 1) throw new Error("ledger entry insert did not affect exactly one row");

  const tuples = input.postings.map(() => "(?, ?, ?, ?, ?)").join(", ");
  const params: unknown[] = [];
  for (const posting of input.postings) {
    params.push(newId(nowMs), entryId, ids.get(posting.account.code)!, posting.amountPaisa, sqlDatetime(new Date(nowMs)));
  }
  const written = await tx.execute(
    `INSERT INTO \`ledger_postings\` (\`id\`, \`entry_id\`, \`account_id\`, \`amount_paisa\`, \`created_at\`) VALUES ${tuples}`, params,
  );
  if (written.affectedRows !== input.postings.length) throw new Error("ledger posting insert affected unexpected row count");

  const actual = await tx.first<{ posting_count: unknown; total: unknown }>(
    "SELECT COUNT(*) AS posting_count, SUM(`amount_paisa`) AS total FROM `ledger_postings` WHERE `entry_id` = ?", [entryId],
  );
  // DECIMAL/BIGINT results from TiDB may be strings. Never coerce a missing, malformed,
  // floating, or imprecise value to zero; COUNT alone is not proof of closure.
  if (actual === null || !(typeof actual.posting_count === "number" || typeof actual.posting_count === "string") ||
      String(actual.posting_count) !== String(input.postings.length) ||
      !(actual.total === 0 || (typeof actual.total === "string" && /^-?0+(?:\.0+)?$/u.test(actual.total)))) {
    throw new Error("ledger stored postings failed count or closure verification");
  }
  return { entryId: toHexId(entryId) };
}
