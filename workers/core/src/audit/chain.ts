/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { concatBytes, sha256 } from "../lib/ids.ts";

import type { AuditEntry } from "./types.ts";

/**
 * The audit chain: every row commits to the one before it, so removing or editing a
 * row in the middle is detectable without a copy of the table anywhere else.
 *
 * `hash = SHA-256(prev_hash ‖ payload_digest)` and `payload_digest` is the SHA-256 of
 * the row's own fields, canonically serialised. Two implementations compute this — this
 * one when a row is written, and `scripts/db/housekeeping.py` when the chain is
 * verified from a machine that has no Worker — so the canonical form is pinned by a
 * shared fixture (`db/fixtures/audit_chain_vectors.json`) that both must reproduce.
 */

/** The separator between fields. U+001F cannot appear in any field, so no value can shift another. */
export const FIELD_SEPARATOR = "\u001f";

/** JSON with object keys sorted at every depth, so two key orders hash the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
}

/** The fields that go into the digest, in this order and no other. */
export function digestInput(entry: AuditEntry): string {
  return [
    String(entry.seq),
    entry.occurredAt,
    entry.actorId ?? "",
    entry.actorType,
    entry.actorRole ?? "",
    entry.ip ?? "",
    entry.requestId,
    entry.action,
    entry.resourceType,
    entry.resourceId ?? "",
    entry.subjectId ?? "",
    // `null` and absent hash the same. Python's `if before is not None` already treated
    // them alike, and a chain that hashed a JSON `null` differently from a missing field
    // would report a break on every row a workflow wrote.
    entry.before == null ? "" : canonicalJson(entry.before),
    entry.after == null ? "" : canonicalJson(entry.after),
    entry.reason ?? "",
    entry.severity,
  ].join(FIELD_SEPARATOR);
}

/** The SHA-256 over the row's own fields: what the chain commits to. */
export async function payloadDigest(entry: AuditEntry): Promise<Uint8Array> {
  return sha256(digestInput(entry));
}

/** The chain link: `SHA-256(prev_hash ‖ payload_digest)`. */
export async function linkHash(prevHash: Uint8Array | null, digest: Uint8Array): Promise<Uint8Array> {
  return sha256(concatBytes(prevHash ?? new Uint8Array(32), digest));
}

/** A row's hash, computed from its fields and its predecessor. */
export async function hashOf(entry: AuditEntry): Promise<Uint8Array> {
  return linkHash(entry.prevHash, await payloadDigest(entry));
}

/**
 * Where a chain breaks: the sequence number and what was expected.
 *
 * `expected` and `actual` are hex so a log line can be compared with a database row by
 * eye, which is how a break is investigated at three in the morning.
 */
export interface ChainBreak {
  readonly seq: number;
  readonly expected: string;
  readonly actual: string;
  readonly reason: "LINK" | "PAYLOAD";
}

/** Lowercase hex, for the break report. */
export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
