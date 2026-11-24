/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { concatBytes, sha256, toHexId } from "../lib/ids.ts";

/** Input values must represent exactly what a future v2 store persists, not an HTTP request. */
export interface AuditV2Record {
  readonly id: Uint8Array;
  readonly seq: number;
  readonly occurredAt: string;
  readonly actorId: Uint8Array | null;
  readonly actorType: "ADMIN" | "VENDOR" | "RIDER" | "CUSTOMER" | "SYSTEM";
  readonly actorRole: string | null;
  readonly ip: Uint8Array | null;
  readonly userAgent: string | null;
  readonly requestId: Uint8Array;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly subjectId: Uint8Array | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string | null;
  readonly severity: "INFO" | "NOTICE" | "WARNING" | "CRITICAL";
}

const encoder = new TextEncoder();
const PAYLOAD_DOMAIN = encoder.encode("undal.audit.payload.v2\0");
const LINK_DOMAIN = encoder.encode("undal.audit.link.v2\0");
const MAX_BYTES = 65_536;
const MAX_STRING_BYTES = 8_192;
const MAX_NODES = 2_048;
const MAX_DEPTH = 16;
const ACTORS: readonly string[] = ["ADMIN", "VENDOR", "RIDER", "CUSTOMER", "SYSTEM"];
const SEVERITIES: readonly string[] = ["INFO", "NOTICE", "WARNING", "CRITICAL"];
const RECORD_KEYS = ["id", "seq", "occurredAt", "actorId", "actorType", "actorRole", "ip", "userAgent", "requestId",
  "action", "resourceType", "resourceId", "subjectId", "before", "after", "reason", "severity"] as const;

function snapshotRecord(record: AuditV2Record): AuditV2Record {
  if (typeof record !== "object" || record === null || (Object.getPrototypeOf(record) !== Object.prototype && Object.getPrototypeOf(record) !== null) ||
      Object.getOwnPropertySymbols(record).length || Object.getOwnPropertyNames(record).length !== RECORD_KEYS.length) {
    throw new RangeError("invalid audit v2 record");
  }
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of RECORD_KEYS) {
    const property = Object.getOwnPropertyDescriptor(record, key);
    if (!property || !("value" in property) || !property.enumerable) throw new RangeError("invalid audit v2 record field");
    copy[key] = property.value;
  }
  return copy as unknown as AuditV2Record;
}

function text(value: unknown, limit: number, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || value.length > limit * 2 || [...value].length > limit) throw new RangeError("invalid audit v2 text");
  // TextEncoder replaces lone surrogates; accepting them would make distinct inputs collide.
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new RangeError("invalid audit v2 Unicode");
    } else if (c >= 0xdc00 && c <= 0xdfff) throw new RangeError("invalid audit v2 Unicode");
  }
  if (encoder.encode(value).length > MAX_STRING_BYTES) throw new RangeError("audit v2 text too large");
  return value;
}

function binary(value: unknown, sizes: readonly number[], nullable = false): string | null {
  if (value === null && nullable) return null;
  if (!(value instanceof Uint8Array) || !sizes.includes(value.length)) throw new RangeError("invalid audit v2 binary value");
  return toHexId(value);
}

function timestamp(value: unknown): string {
  const s = text(value, 26);
  if (s === null || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/u.test(s)) throw new RangeError("invalid audit v2 timestamp");
  const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10));
  const h = Number(s.slice(11, 13)), min = Number(s.slice(14, 16)), sec = Number(s.slice(17, 19));
  if (y < 1000 || m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59 || sec > 59) throw new RangeError("invalid audit v2 timestamp");
  const date = new Date(Date.UTC(y, m - 1, d, h, min, sec));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) throw new RangeError("invalid audit v2 timestamp");
  return s;
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
}

/**
 * Encode a bounded JSON-like value using a versioned, unambiguous byte grammar.
 * Tags: n/null, t/true, f/false, i<decimal>;, s<byte-length>:<UTF-8>,
 * a<count>:<values>, o<count>:<key-value pairs>. Object keys sort by UTF-8 bytes.
 * Rejects floats, unsafe integers, lone surrogates, sparse arrays, accessors and cycles.
 */
export function encodeAuditV2Value(value: unknown): Uint8Array {
  const chunks: Uint8Array[] = [];
  const seen = new Set<object>();
  let size = 0;
  let nodes = 0;
  const add = (chunk: Uint8Array): void => {
    size += chunk.length;
    if (size > MAX_BYTES) throw new RangeError("audit v2 payload too large");
    chunks.push(chunk);
  };
  const ascii = (s: string): void => add(encoder.encode(s));
  function visit(item: unknown, depth: number): void {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw new RangeError("audit v2 payload too complex");
    if (item === null) { ascii("n"); return; }
    if (typeof item === "boolean") { ascii(item ? "t" : "f"); return; }
    if (typeof item === "number") {
      if (!Number.isSafeInteger(item) || Object.is(item, -0)) throw new RangeError("invalid audit v2 integer");
      ascii(`i${item};`); return;
    }
    if (typeof item === "string") {
      const valid = text(item, MAX_STRING_BYTES)!;
      const data = encoder.encode(valid);
      ascii(`s${data.length}:`); add(data); return;
    }
    if (typeof item !== "object" || seen.has(item)) throw new RangeError("invalid audit v2 value");
    seen.add(item);
    try {
      if (Array.isArray(item)) {
        if (item.length > MAX_NODES || Object.getOwnPropertySymbols(item).length ||
            Object.getOwnPropertyNames(item).length !== item.length + 1) throw new RangeError("invalid audit v2 array");
        ascii(`a${item.length}:`);
        for (let i = 0; i < item.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, i);
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new RangeError("invalid audit v2 array");
          visit(descriptor.value, depth + 1);
        }
        return;
      }
      const proto = Object.getPrototypeOf(item) as unknown;
      if (proto !== Object.prototype && proto !== null) throw new RangeError("invalid audit v2 object");
      if (Object.getOwnPropertySymbols(item).length) throw new RangeError("invalid audit v2 object");
      const names = Object.getOwnPropertyNames(item);
      if (names.length > MAX_NODES) throw new RangeError("audit v2 object too complex");
      const keys = names.map((key) => {
        const valid = text(key, MAX_STRING_BYTES)!;
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new RangeError("invalid audit v2 property");
        return { key: valid, data: encoder.encode(valid), value: descriptor.value };
      }).sort((a, b) => compareBytes(a.data, b.data));
      ascii(`o${keys.length}:`);
      for (const item of keys) { visit(item.key, depth + 1); visit(item.value, depth + 1); }
    } finally { seen.delete(item); }
  }
  visit(value, 0);
  return concatBytes(...chunks);
}

/** Construct canonical bytes from persisted values. This function does not write or verify a database row. */
export function auditV2Payload(record: AuditV2Record): Uint8Array {
  record = snapshotRecord(record);
  if (!Number.isSafeInteger(record.seq) || record.seq < 1) throw new RangeError("invalid audit v2 sequence");
  if (!ACTORS.includes(record.actorType) || !SEVERITIES.includes(record.severity)) throw new RangeError("invalid audit v2 classification");
  return encodeAuditV2Value([
    "undal.audit.v2", binary(record.id, [16]), record.seq, timestamp(record.occurredAt),
    binary(record.actorId, [16], true), record.actorType, text(record.actorRole, 48, true),
    binary(record.ip, [4, 16], true), text(record.userAgent, 512, true), binary(record.requestId, [16]),
    text(record.action, 64), text(record.resourceType, 48), text(record.resourceId, 64, true),
    binary(record.subjectId, [16], true), record.before, record.after, text(record.reason, 512, true), record.severity,
  ]);
}

/** Domain-separated v2 hashes. A null predecessor is allowed only for sequence one. */
export async function auditV2Hashes(record: AuditV2Record, previous: Uint8Array | null): Promise<{ payloadHash: Uint8Array; hash: Uint8Array }> {
  record = snapshotRecord(record);
  const payload = auditV2Payload(record);
  if ((record.seq === 1 && previous !== null) || (record.seq !== 1 && previous === null) ||
      (previous !== null && (!(previous instanceof Uint8Array) || previous.length !== 32))) {
    throw new RangeError("invalid audit v2 predecessor");
  }
  const prior = previous === null ? new Uint8Array([0]) : concatBytes(new Uint8Array([1]), previous.slice());
  const payloadHash = await sha256(concatBytes(PAYLOAD_DOMAIN, payload));
  const hash = await sha256(concatBytes(LINK_DOMAIN, prior, payloadHash));
  return { payloadHash, hash };
}
