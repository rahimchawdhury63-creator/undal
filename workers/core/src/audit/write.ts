/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../db/client.ts";
import { sqlDatetime } from "../db/time.ts";
import { newId, toHexId } from "../lib/ids.ts";

import { hashOf } from "./chain.ts";
import type { AuditEntry, AuditEntryInput } from "./types.ts";

/** Why an append stopped before inserting because the stored tail cannot be trusted. */
export class AuditAppendRefusedError extends Error {
  readonly reason: "INVALID_TAIL_SEQUENCE" | "INVALID_TAIL_HASH";

  constructor(reason: "INVALID_TAIL_SEQUENCE" | "INVALID_TAIL_HASH") {
    super(
      reason === "INVALID_TAIL_SEQUENCE"
        ? "audit chain tail has an invalid or unsafe sequence; refusing append"
        : "audit chain tail has an invalid hash; refusing append",
    );
    this.name = "AuditAppendRefusedError";
    this.reason = reason;
  }
}

/**
 * Append one row to the audit chain.
 *
 * This reads the tail and then inserts the new row in a separate statement. Concurrent
 * callers can observe the same tail; the unique sequence index may reject one writer.
 * This is NOT an atomic audit append and cannot yet be used as proof that business state
 * and audit committed together. See D163–D166 before enabling cash financial writes.
 * New rows normalize UUID spelling and valid IPv4/IPv6 text before hashing and storing bytes;
 * missing or unparseable IP values become NULL in both places. This does not repair historical
 * rows or make the legacy JSON/delimiter format canonical. An existing tail with an invalid hash
 * or an unsafe sequence now fails closed instead of opening a new genesis link or rounding BIGINT.
 *
 * Requires `INSERT` and `SELECT` grants on `audit_log` and nothing else — no `UPDATE`,
 * no `DELETE` — which is the structural half of immutability; the chain is the other.
 */
export async function appendAudit(
  db: Db,
  input: AuditEntryInput,
  nowMs: number = Date.now(),
): Promise<AuditEntry> {
  // Hash exactly the canonical identities and address bytes that this row stores. This
  // makes new rows independent of UUID spelling and prevents IPv6 from becoming NULL.
  const normalizedIp = normalizeAuditIp(input.ip);
  const normalizedInput = {
    ...input,
    actorId: input.actorId === null ? null : canonicalUuid(input.actorId),
    requestId: canonicalUuid(input.requestId),
    subjectId: input.subjectId === null ? null : canonicalUuid(input.subjectId),
    ip: normalizedIp.text,
  };
  const tail = await db.first<{ seq: number | string; hash: Uint8Array | null }>(
    "SELECT `seq`, `hash` FROM `audit_log` ORDER BY `seq` DESC LIMIT 1",
  );
  let seq = 1;
  let prevHash: Uint8Array | null = null;
  if (tail !== null) {
    seq = nextAuditSequence(tail.seq);
    if (!(tail.hash instanceof Uint8Array) || tail.hash.byteLength !== 32) {
      throw new AuditAppendRefusedError("INVALID_TAIL_HASH");
    }
    prevHash = new Uint8Array(tail.hash);
  }

  const entry: AuditEntry = {
    ...normalizedInput,
    seq,
    occurredAt: sqlDatetime(new Date(nowMs)),
    prevHash,
  };
  const hash = await hashOf(entry);

  await db.execute(
    "INSERT INTO `audit_log` (`id`, `seq`, `occurred_at`, `actor_id`, `actor_type`, `actor_role`, `ip`, `user_agent`, " +
      "`request_id`, `action`, `resource_type`, `resource_id`, `subject_id`, `before`, `after`, `reason`, `severity`, `prev_hash`, `hash`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      newId(nowMs),
      seq,
      entry.occurredAt,
      entry.actorId === null ? null : uuidBytes(entry.actorId),
      entry.actorType,
      entry.actorRole,
      normalizedIp.bytes,
      typeof entry.userAgent === "string" ? entry.userAgent.slice(0, 512) : null,
      uuidBytes(entry.requestId),
      entry.action,
      entry.resourceType,
      entry.resourceId,
      entry.subjectId === null ? null : uuidBytes(entry.subjectId),
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.reason,
      entry.severity,
      prevHash,
      hash,
    ],
  );
  return entry;
}

/** Parse a driver BIGINT without losing precision, and reserve one safe JS number for the next row. */
function nextAuditSequence(value: number | string): number {
  let current: bigint;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new AuditAppendRefusedError("INVALID_TAIL_SEQUENCE");
    current = BigInt(value);
  } else {
    // TiDB's signed BIGINT is at most 19 decimal digits. Bound parsing before BigInt
    // and refuse alternate spellings rather than silently normalizing corrupt metadata.
    if (!/^[1-9][0-9]{0,18}$/u.test(value))
      throw new AuditAppendRefusedError("INVALID_TAIL_SEQUENCE");
    current = BigInt(value);
  }
  const next = current + 1n;
  if (next > BigInt(Number.MAX_SAFE_INTEGER))
    throw new AuditAppendRefusedError("INVALID_TAIL_SEQUENCE");
  return Number(next);
}

/**
 * A UUID string as the 16 bytes the column stores.
 *
 * Written here rather than imported so the audit module has no dependency on the
 * request layer: an audit row is written by workflows and alarms as well as by
 * handlers, and the alarm path must not pull in the HTTP stack.
 */
function canonicalUuid(uuid: string): string {
  const hex = uuid.replace(/-/gu, "").toLowerCase();
  if (hex.length !== 32 || !/^[0-9a-f]{32}$/u.test(hex))
    throw new RangeError(`not a UUID: ${uuid}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A UUID as the 16 canonical bytes stored by the database. */
function uuidBytes(uuid: string): Uint8Array {
  const hex = canonicalUuid(uuid).replace(/-/gu, "");
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1)
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

interface NormalizedIp {
  readonly text: string | null;
  readonly bytes: Uint8Array | null;
}

/** Canonical textual IPv4/IPv6 plus the exact network bytes stored in VARBINARY(16). */
function normalizeAuditIp(ip: string | null): NormalizedIp {
  if (ip === null || ip === "" || ip.toLowerCase() === "unknown")
    return { text: null, bytes: null };
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(ip);
  if (ipv4 !== null) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return { text: null, bytes: null };
    return { text: octets.join("."), bytes: new Uint8Array(octets) };
  }

  if (ip.includes(":") && !ip.includes("%")) {
    try {
      const hostname = new URL(`http://[${ip}]/`).hostname;
      if (!hostname.startsWith("[") || !hostname.endsWith("]")) return { text: null, bytes: null };
      const text = hostname.slice(1, -1);
      return { text, bytes: ipv6Bytes(text) };
    } catch {
      // The schema stores network bytes, not arbitrary header text. Keep an unsupported
      // value out of the digest too, rather than hashing data the database cannot retain.
      return { text: null, bytes: null };
    }
  }
  return { text: null, bytes: null };
}

/** Convert a normalized, URL-canonical IPv6 address to the bytes stored in VARBINARY. */
function ipv6Bytes(ip: string): Uint8Array {
  const halves = ip.split("::");
  if (halves.length > 2) throw new RangeError("invalid audit IP address");
  const left = halves[0] === "" ? [] : halves[0]!.split(":");
  const right = halves.length === 1 || halves[1] === "" ? [] : halves[1]!.split(":");
  const zeros = 8 - left.length - right.length;
  if ((halves.length === 1 && zeros !== 0) || (halves.length === 2 && zeros < 1)) {
    throw new RangeError("invalid audit IP address");
  }
  const groups = [...left, ...Array<string>(zeros).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/iu.test(group))) {
    throw new RangeError("invalid audit IP address");
  }
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    const word = Number.parseInt(group, 16);
    bytes[index * 2] = word >> 8;
    bytes[index * 2 + 1] = word & 0xff;
  });
  return bytes;
}

/** A request id for a path that has no HTTP request — an alarm or a workflow. */
export function syntheticRequestId(nowMs: number = Date.now()): string {
  return toHexId(newId(nowMs));
}
