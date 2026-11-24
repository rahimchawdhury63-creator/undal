/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../db/client.ts";
import { payloadDigest, toHex, type ChainBreak } from "./chain.ts";
import type { AuditEntry } from "./types.ts";

/** Bounded pages prevent unbounded response size. */
export const VERIFY_BATCH = 1_000;

interface LinkRow {
  readonly seq: unknown;
  readonly prev_hash: unknown;
  readonly hash: unknown;
}

/** A link-only diagnostic, never a complete proof of audit integrity. */
export interface VerifyReport {
  readonly status: "INCOMPLETE" | "BREAK";
  readonly fromSeq: number;
  readonly lastSeq: number | null;
  readonly rows: number;
  readonly breaks: readonly ChainBreak[];
  readonly lastHashHex: string | null;
  readonly payloadsVerified: false;
}

function sequence(value: unknown): number {
  if (typeof value !== "number" && !(typeof value === "string" && /^[1-9][0-9]*$/u.test(value))) {
    throw new RangeError("invalid audit sequence");
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new RangeError("invalid audit sequence");
  return number;
}

function hashBytes(value: unknown, nullable: boolean): Uint8Array | null {
  if (value === null && nullable) return null;
  if (!(value instanceof Uint8Array) || value.length !== 32) throw new RangeError("invalid audit hash");
  return value;
}

/**
 * Inspect stored links and sequence continuity only. Legacy writers hashed values (including
 * UUID spelling and IP) that cannot always be reconstructed from the stored row. Therefore
 * neither matching links nor an empty break list means the payload or chain is verified.
 * Partial ranges do not establish a trusted predecessor. No external anchor is checked.
 * Invalid or non-monotone database responses throw instead of reporting success.
 */
export async function verifyChain(db: Db, options: { fromSeq?: number; batchSize?: number } = {}): Promise<VerifyReport> {
  const fromSeq = sequence(options.fromSeq ?? 1);
  const batchSize = options.batchSize ?? VERIFY_BATCH;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > VERIFY_BATCH) throw new RangeError("invalid audit verification batch size");
  let cursor = fromSeq;
  let previousHash: Uint8Array | null = null;
  let lastSeq: number | null = null;
  let rows = 0;
  const breaks: ChainBreak[] = [];

  for (;;) {
    const page = await db.query<LinkRow>(
      "SELECT `seq`, `prev_hash`, `hash` FROM `audit_log` WHERE `seq` >= ? ORDER BY `seq` ASC LIMIT ?",
      [cursor, batchSize],
    );
    if (page.length > batchSize) throw new Error("audit page exceeds requested limit");
    if (page.length === 0) break;
    for (const row of page) {
      const seq = sequence(row.seq);
      if (seq < cursor) throw new Error("audit rows are not strictly increasing");
      if (seq !== cursor) breaks.push({ seq, expected: String(cursor), actual: String(seq), reason: "SEQUENCE" });
      const prev = hashBytes(row.prev_hash, true);
      const hash = hashBytes(row.hash, false)!;
      if (previousHash !== null && (prev === null || toHex(prev) !== toHex(previousHash))) {
        breaks.push({ seq, expected: toHex(previousHash), actual: prev === null ? "null" : toHex(prev), reason: "LINK" });
      } else if (rows === 0 && fromSeq === 1 && seq === 1 && prev !== null) {
        breaks.push({ seq, expected: "null", actual: toHex(prev), reason: "LINK" });
      }
      previousHash = hash.slice();
      lastSeq = seq;
      rows += 1;
      if (seq === Number.MAX_SAFE_INTEGER) throw new RangeError("audit sequence exhausted safe range");
      cursor = seq + 1;
    }
    if (page.length < batchSize) break;
  }

  return { status: breaks.length ? "BREAK" : "INCOMPLETE", fromSeq, lastSeq, rows, breaks,
    lastHashHex: previousHash === null ? null : toHex(previousHash), payloadsVerified: false };
}

/** Digest a supplied entry; it is not evidence that a persisted legacy row can be reconstructed. */
export async function digestOf(entry: AuditEntry): Promise<string> {
  return toHex(await payloadDigest(entry));
}
