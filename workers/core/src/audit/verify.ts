/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../db/client.ts";

import { hashOf, payloadDigest, toHex, type ChainBreak } from "./chain.ts";
import type { AuditEntry } from "./types.ts";

/**
 * Walk the chain and report every break, batched.
 *
 * Batched because the table is append-only and years long: the nightly job reads a page
 * of rows, verifies each against the previous row's hash, and carries the last hash
 * across the page boundary. A single query over a million rows would time out at the
 * HTTP gateway rather than at the database, and a timeout is indistinguishable from an
 * empty result to a caller that does not check.
 */

/** Rows per round trip. One thousand keeps a page under the gateway's response limit. */
export const VERIFY_BATCH = 1_000;

/** The row shape the walk reads. */
interface AuditRow {
  readonly seq: number | string;
  readonly occurred_at: string;
  readonly actor_id: Uint8Array | null;
  readonly actor_type: string;
  readonly actor_role: string | null;
  readonly ip: Uint8Array | null;
  readonly request_id: Uint8Array;
  readonly action: string;
  readonly resource_type: string;
  readonly resource_id: string | null;
  readonly subject_id: Uint8Array | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string | null;
  readonly severity: string;
  readonly prev_hash: Uint8Array | null;
  readonly hash: Uint8Array;
}

function hexUuid(bytes: Uint8Array): string {
  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A database row as the entry the chain hashes.
 *
 * JSON columns come back as strings from the driver when they were written as strings
 * and as objects when TiDB parsed them; both are normalised here, because a chain that
 * hashes differently depending on how a column was read is a chain that reports a false
 * break on every deployment.
 */
export function toEntry(row: AuditRow): AuditEntry {
  const parse = (value: unknown): unknown => {
    if (value === null || value === undefined) return undefined;
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  };
  return {
    seq: Number(row.seq),
    occurredAt: String(row.occurred_at),
    actorId: row.actor_id === null ? null : hexUuid(new Uint8Array(row.actor_id)),
    actorType: row.actor_type as AuditEntry["actorType"],
    actorRole: row.actor_role,
    ip: null,
    requestId: hexUuid(new Uint8Array(row.request_id)),
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    subjectId: row.subject_id === null ? null : hexUuid(new Uint8Array(row.subject_id)),
    ...(parse(row.before) === undefined ? {} : { before: parse(row.before) }),
    ...(parse(row.after) === undefined ? {} : { after: parse(row.after) }),
    reason: row.reason,
    severity: row.severity as AuditEntry["severity"],
    prevHash: row.prev_hash === null ? null : new Uint8Array(row.prev_hash),
  };
}

/** What a verification run found. */
export interface VerifyReport {
  readonly rows: number;
  readonly breaks: readonly ChainBreak[];
  readonly lastHashHex: string | null;
}

/** Walk the whole chain, from `fromSeq` (inclusive) to the end. */
export async function verifyChain(db: Db, options: { fromSeq?: number; batchSize?: number } = {}): Promise<VerifyReport> {
  const batchSize = options.batchSize ?? VERIFY_BATCH;
  let cursor = options.fromSeq ?? 1;
  let previousHash: Uint8Array | null = null;
  let rows = 0;
  const breaks: ChainBreak[] = [];

  for (;;) {
    const page = await db.query<AuditRow>(
      "SELECT `seq`, `occurred_at`, `actor_id`, `actor_type`, `actor_role`, `ip`, `request_id`, `action`, `resource_type`, " +
        "`resource_id`, `subject_id`, `before`, `after`, `reason`, `severity`, `prev_hash`, `hash` " +
        "FROM `audit_log` WHERE `seq` >= ? ORDER BY `seq` ASC LIMIT ?",
      [cursor, batchSize],
    );
    if (page.length === 0) break;

    for (const row of page) {
      const entry = toEntry(row);
      const expectedLink = previousHash ?? entry.prevHash ?? new Uint8Array(32);
      const storedPrev = entry.prevHash ?? new Uint8Array(32);
      if (toHex(storedPrev) !== toHex(expectedLink) && previousHash !== null) {
        breaks.push({ seq: entry.seq, expected: toHex(expectedLink), actual: toHex(storedPrev), reason: "LINK" });
      }
      const recomputed = await hashOf({ ...entry, prevHash: storedPrev });
      if (toHex(recomputed) !== toHex(new Uint8Array(row.hash))) {
        breaks.push({ seq: entry.seq, expected: toHex(recomputed), actual: toHex(new Uint8Array(row.hash)), reason: "PAYLOAD" });
      }
      previousHash = new Uint8Array(row.hash);
      rows += 1;
    }
    if (page.length < batchSize) break;
    cursor = Number(page[page.length - 1]?.seq ?? cursor) + 1;
  }

  return { rows, breaks, lastHashHex: previousHash === null ? null : toHex(previousHash) };
}

/** The digest of one row, for the verification table that stores a periodic checkpoint. */
export async function digestOf(entry: AuditEntry): Promise<string> {
  return toHex(await payloadDigest(entry));
}
