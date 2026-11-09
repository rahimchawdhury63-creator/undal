/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { type Db } from "../../db/client.ts";
import { sqlDatetime } from "../../db/time.ts";
import { withTransaction, type Transactional } from "../../db/transaction.ts";
import { constantTimeEqual, newId, toHexId } from "../../lib/ids.ts";
import { canonicalCashJson, cashOperationUuid, type CashJsonObject, type CashOperationIdentity } from "./cash-operation-identity.ts";

/** A completed operation's stable data, not an HTTP envelope. */
export interface CashOperationReceipt {
  readonly operationId: string;
  readonly ledgerEntryId: string;
  readonly response: CashJsonObject;
}

/** Absence does not establish that an unacknowledged transaction cannot still commit. */
export type CashOperationLookup =
  | { readonly kind: "found"; readonly receipt: CashOperationReceipt }
  | { readonly kind: "conflict" }
  | { readonly kind: "missing" }
  | { readonly kind: "incomplete" };

/** Outcome of attempting an operation; a commit failure still throws an unknown-outcome error. */
export type CashOperationOutcome =
  | { readonly kind: "created" | "replayed"; readonly receipt: CashOperationReceipt }
  | { readonly kind: "conflict" | "unresolved" };

/** What transaction-only business work must return before the operation can commit. */
export interface CashOperationWorkResult {
  readonly ledgerEntryId: string;
  readonly response: unknown;
}

/** Internal signal: only a duplicate on the identity insert is treated as a replay. */
class DuplicateCashOperation extends Error {}

function exactDuplicate(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as { code?: unknown; errno?: unknown; details?: { code?: unknown } | null };
  return String(value.errno ?? value.code ?? value.details?.code ?? "") === "1062";
}

function validateIdentity(identity: CashOperationIdentity): void {
  if (!(identity.actorId instanceof Uint8Array) || identity.actorId.length !== 16 ||
      !(identity.targetId instanceof Uint8Array) || identity.targetId.length !== 16 ||
      !(identity.keyHash instanceof Uint8Array) || identity.keyHash.length !== 32 ||
      !(identity.requestHash instanceof Uint8Array) || identity.requestHash.length !== 32 ||
      (identity.action !== "SETTLEMENT_APPROVAL" && identity.action !== "CASH_WRITE_OFF")) {
    throw new RangeError("invalid cash operation identity");
  }
}

function snapshotIdentity(identity: CashOperationIdentity): CashOperationIdentity {
  validateIdentity(identity);
  return { actorId: identity.actorId.slice(), action: identity.action, targetId: identity.targetId.slice(),
    keyHash: identity.keyHash.slice(), requestHash: identity.requestHash.slice() };
}

function responseObject(input: unknown): { value: CashJsonObject; text: string } {
  const normalized = canonicalCashJson(input);
  if (normalized.value === null || typeof normalized.value !== "object" || Array.isArray(normalized.value)) {
    throw new RangeError("cash operation response must be an object");
  }
  return { value: normalized.value as CashJsonObject, text: normalized.text };
}

/** Find a committed receipt by actor, action and key; this does not prove an absent operation never committed. */
export async function lookupCashOperation(db: Db, identity: CashOperationIdentity): Promise<CashOperationLookup> {
  identity = snapshotIdentity(identity);
  const row = await db.first<Record<string, unknown>>(
    "SELECT `id`, `request_hash`, `ledger_entry_id`, `response_json`, `completed_at` " +
      "FROM `cash_financial_operations` WHERE `actor_user_id` = ? AND `action` = ? AND `key_hash` = ? LIMIT 1",
    [identity.actorId, identity.action, identity.keyHash],
  );
  if (row === null) return { kind: "missing" };
  if (!(row["request_hash"] instanceof Uint8Array) || row["request_hash"].length !== 32) return { kind: "incomplete" };
  if (!constantTimeEqual(row["request_hash"], identity.requestHash)) return { kind: "conflict" };
  if (!(row["id"] instanceof Uint8Array) || row["id"].length !== 16 ||
      !(row["ledger_entry_id"] instanceof Uint8Array) || row["ledger_entry_id"].length !== 16 ||
      typeof row["completed_at"] !== "string") return { kind: "incomplete" };
  try {
    // The TiDB driver decodes JSON, while some test/other clients return its text.
    const raw: unknown = typeof row["response_json"] === "string" ? JSON.parse(row["response_json"]) : row["response_json"];
    const response = responseObject(raw).value;
    return { kind: "found", receipt: { operationId: toHexId(row["id"]), ledgerEntryId: toHexId(row["ledger_entry_id"]), response } };
  } catch {
    return { kind: "incomplete" };
  }
}

/**
 * Reserve, perform and finish a cash operation in one transaction.
 *
 * The callback must only write via `tx`, await every statement, and have no external side
 * effects. A 1062 on the identity insert is resolved after rollback using the committed
 * receipt; duplicates from business work are not mistaken for a replay. No cash route uses
 * this yet. Uncertain commit/rollback outcomes propagate and require reconciliation.
 */
export async function runCashOperation(
  runner: Transactional,
  readDb: Db,
  identity: CashOperationIdentity,
  work: (tx: Db) => Promise<CashOperationWorkResult>,
  now: () => number = Date.now,
): Promise<CashOperationOutcome> {
  identity = snapshotIdentity(identity);
  const createdAt = now();
  const id = newId(createdAt);
  try {
    const receipt = await withTransaction(runner, async (tx) => {
      try {
        const inserted = await tx.execute(
          "INSERT INTO `cash_financial_operations` (`id`, `actor_user_id`, `action`, `key_hash`, `request_hash`, `target_id`, `created_at`) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
          [id, identity.actorId, identity.action, identity.keyHash, identity.requestHash, identity.targetId, sqlDatetime(new Date(createdAt))],
        );
        if (inserted.affectedRows !== 1) throw new Error("cash operation identity was not reserved");
      } catch (error) {
        if (exactDuplicate(error)) throw new DuplicateCashOperation();
        throw error;
      }
      const result = await work(tx);
      const ledgerId = cashOperationUuid(result.ledgerEntryId);
      const response = responseObject(result.response);
      const completed = await tx.execute(
        "UPDATE `cash_financial_operations` SET `ledger_entry_id` = ?, `response_json` = ?, `completed_at` = ? " +
          "WHERE `id` = ? AND `completed_at` IS NULL",
        [ledgerId, response.text, sqlDatetime(new Date(now())), id],
      );
      if (completed.affectedRows !== 1) throw new Error("cash operation receipt was not completed");
      return { operationId: toHexId(id), ledgerEntryId: toHexId(ledgerId), response: response.value };
    });
    return { kind: "created", receipt };
  } catch (error) {
    if (!(error instanceof DuplicateCashOperation)) throw error;
    const existing = await lookupCashOperation(readDb, identity);
    if (existing.kind === "found") return { kind: "replayed", receipt: existing.receipt };
    if (existing.kind === "conflict") return { kind: "conflict" };
    // Missing or malformed after a duplicate must never be treated as permission to do the work.
    return { kind: "unresolved" };
  }
}
