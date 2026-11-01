/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../../../db/client.ts";
import { newId } from "../../../lib/ids.ts";
import { sqlDatetime } from "../../../db/time.ts";
import type { Account, AccountKind, OwnerType } from "../types.ts";

/**
 * Reading and creating `ledger_accounts` rows.
 *
 * Accounts are created on first use rather than seeded, because a vendor id is not known
 * until a vendor exists and a seed row with a fixed id would be demo data in a production
 * path. `INSERT IGNORE` on the unique `(owner_type, owner_id, code)` index makes the
 * creation idempotent under concurrency, which is why it can run inside the same request
 * that posts the first entry for a rider.
 */

/** The row shape this repository reads. */
export interface AccountRow {
  readonly id: Uint8Array;
  readonly code: string;
  readonly kind: string;
  readonly owner_type: string;
  readonly owner_id: Uint8Array | null;
}

/** Map a row to the domain shape, validating the two CHECK'd strings. */
export function toAccount(row: AccountRow): Account {
  const ownerId = row.owner_id === null ? undefined : uuidText(new Uint8Array(row.owner_id));
  return {
    code: row.code,
    kind: row.kind as AccountKind,
    ownerType: row.owner_type as OwnerType,
    ...(ownerId === undefined ? {} : { ownerId }),
  };
}

/** A UUID string from 16 stored bytes. */
function uuidText(bytes: Uint8Array): string {
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The account for a code, or `null`. */
export async function findAccount(db: Db, code: string): Promise<Account | null> {
  const row = await db.first<AccountRow>(
    "SELECT `id`, `code`, `kind`, `owner_type`, `owner_id` FROM `ledger_accounts` WHERE `code` = ?",
    [code],
  );
  return row === null ? null : toAccount(row);
}

/**
 * Ensure every account in the set exists, creating the missing ones.
 *
 * Runs before the entry is written so the foreign key from `ledger_postings` cannot fail
 * after money has been decided: an account created mid-transaction would be a second write
 * whose failure leaves the entry unposted but the caller believing it succeeded.
 */
export async function ensureAccounts(db: Db, accounts: readonly Account[], nowMs: number = Date.now()): Promise<void> {
  const seen = new Set<string>();
  for (const account of accounts) {
    if (seen.has(account.code)) continue;
    seen.add(account.code);
    await db.execute(
      "INSERT IGNORE INTO `ledger_accounts` (`id`, `code`, `kind`, `owner_type`, `owner_id`, `created_at`) VALUES (?, ?, ?, ?, ?, ?)",
      [
        newId(nowMs),
        account.code,
        account.kind,
        account.ownerType,
        account.ownerId === undefined ? null : uuidBytes(account.ownerId),
        sqlDatetime(new Date(nowMs)),
      ],
    );
  }
}

/** Every account, for the admin account list. */
export async function listAccounts(db: Db, limit = 200): Promise<Account[]> {
  const rows = await db.query<AccountRow>(
    "SELECT `id`, `code`, `kind`, `owner_type`, `owner_id` FROM `ledger_accounts` ORDER BY `code` ASC LIMIT ?",
    [limit],
  );
  return rows.map(toAccount);
}

/** A UUID string as the bytes a `BINARY(16)` column stores. */
export function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/gu, "");
  if (!/^[0-9a-f]{32}$/iu.test(hex)) throw new RangeError(`not a UUID: ${uuid}`);
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}
