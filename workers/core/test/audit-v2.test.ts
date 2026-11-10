/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { auditV2Hashes, auditV2Payload, encodeAuditV2Value, type AuditV2Record } from "../src/audit/canonical-v2.ts";

interface Vector {
  name: string;
  record: Record<string, unknown>;
  previousHex: string | null;
  payloadHex: string;
  payloadHashHex: string;
  hashHex: string;
}
const vectors = (JSON.parse(readFileSync(new URL("../../../db/fixtures/audit_v2_vectors.json", import.meta.url), "utf8")) as { vectors: Vector[] }).vectors;
const hex = (value: Uint8Array) => Buffer.from(value).toString("hex");
const fromHex = (value: string) => new Uint8Array(Buffer.from(value, "hex"));
function recordOf(vector: Vector): AuditV2Record {
  const record = { ...vector.record };
  for (const key of ["id", "actorId", "ip", "requestId", "subjectId"]) {
    if (record[key] !== null) record[key] = fromHex(record[key] as string);
  }
  return record as unknown as AuditV2Record;
}

test("v2 payload and domain-separated hashes match independent cross-language vectors", async () => {
  for (const vector of vectors) {
    const record = recordOf(vector);
    const previous = vector.previousHex === null ? null : fromHex(vector.previousHex);
    assert.equal(hex(auditV2Payload(record)), vector.payloadHex, vector.name);
    const result = await auditV2Hashes(record, previous);
    assert.equal(hex(result.payloadHash), vector.payloadHashHex, vector.name);
    assert.equal(hex(result.hash), vector.hashHex, vector.name);
  }
  assert.equal(vectors[1]?.previousHex, vectors[0]?.hashHex);
});

test("UTF-8 key order is stable and arrays, types and framing stay distinct", () => {
  const first = { "𐀀": 1, "\ue000": 2, a: "x" };
  const second = { a: "x", "\ue000": 2, "𐀀": 1 };
  assert.deepEqual(encodeAuditV2Value(first), encodeAuditV2Value(second));
  const text = new TextDecoder().decode(encodeAuditV2Value(first));
  assert.ok(text.indexOf("\ue000") < text.indexOf("𐀀"));
  const values: unknown[] = [null, false, true, 0, "0", [1, 2], [2, 1], { a: "bc" }, { ab: "c" }, "a\u001fb", ["a", "b"]];
  assert.equal(new Set(values.map((value) => hex(encodeAuditV2Value(value)))).size, values.length);
});

test("unsafe JSON values, hidden properties, accessors, cycles and excessive input are rejected", () => {
  const cycle: { self?: unknown } = {}; cycle.self = cycle;
  let getterCalls = 0;
  const getter = Object.defineProperty({}, "x", { enumerable: true, get() { getterCalls++; return 1; } });
  const array = [1]; Object.defineProperty(array, "hidden", { value: 1 });
  const object = Object.defineProperty({}, "hidden", { value: 1 });
  let depth: unknown = null; for (let i = 0; i < 18; i++) depth = [depth];
  for (const input of [undefined, NaN, Infinity, 1.5, -0, Number.MAX_SAFE_INTEGER + 1, 1n, new Date(), Array(2),
    cycle, getter, array, object, "\ud800", "\udc00", "x".repeat(8193), Array(2049).fill(0), depth,
    Array(10).fill("x".repeat(8192))]) {
    assert.throws(() => encodeAuditV2Value(input), RangeError);
  }
  assert.equal(getterCalls, 0);
  const child = { a: 1 };
  assert.doesNotThrow(() => encodeAuditV2Value([child, child])); // shared values are not cycles
});

test("record validation refuses malformed stored fields and invalid predecessor semantics", async () => {
  const base = recordOf(vectors[0]!);
  const bad: Partial<AuditV2Record>[] = [
    { id: new Uint8Array(15) }, { actorId: new Uint8Array(3) }, { ip: new Uint8Array(5) }, { requestId: new Uint8Array(1) },
    { seq: 0 }, { seq: 1.5 }, { seq: Number.MAX_SAFE_INTEGER + 1 }, { occurredAt: "2026-02-29 00:00:00.000000" },
    { occurredAt: "2026-01-01T00:00:00Z" }, { actorType: "UNKNOWN" as never }, { severity: "INVALID" as never },
    { action: "x".repeat(65) }, { userAgent: "x".repeat(513) }, { before: undefined }, { after: 0.1 },
  ];
  for (const change of bad) assert.throws(() => auditV2Payload({ ...base, ...change }), RangeError);
  assert.throws(() => auditV2Payload({ ...base, extra: 1 } as never), RangeError);
  let called = false;
  const accessor = { ...base }; Object.defineProperty(accessor, "action", { enumerable: true, get() { called = true; return "x"; } });
  assert.throws(() => auditV2Payload(accessor), RangeError); assert.equal(called, false);
  await assert.rejects(auditV2Hashes(base, new Uint8Array(32)), RangeError);
  await assert.rejects(auditV2Hashes({ ...base, seq: 2 }, null), RangeError);
  await assert.rejects(auditV2Hashes({ ...base, seq: 2 }, new Uint8Array(31)), RangeError);
});

test("every persisted field affects the hash and previous bytes are snapshotted", async () => {
  const base = recordOf(vectors[0]!);
  const original = hex((await auditV2Hashes(base, null)).hash);
  const changes: Partial<AuditV2Record>[] = [
    { id: new Uint8Array(16) }, { occurredAt: "2026-02-28 23:59:59.123457" }, { actorId: null },
    { actorType: "SYSTEM" }, { actorRole: null }, { ip: null }, { userAgent: null }, { requestId: new Uint8Array(16) },
    { action: "other" }, { resourceType: "other" }, { resourceId: null }, { subjectId: new Uint8Array(16) },
    { before: null }, { after: null }, { reason: null }, { severity: "WARNING" },
  ];
  for (const change of changes) assert.notEqual(hex((await auditV2Hashes({ ...base, ...change }, null)).hash), original);
  const later = { ...base, seq: 2 }; const previous = new Uint8Array(32).fill(7);
  const expected = hex((await auditV2Hashes(later, previous)).hash);
  const pending = auditV2Hashes(later, previous); previous.fill(8);
  assert.equal(hex((await pending).hash), expected);
  assert.notEqual(expected, hex((await auditV2Hashes(later, new Uint8Array(32).fill(8))).hash));
  assert.notEqual(expected, original);
});

test("two implementations agree over deterministic generated nested values", () => {
  let seed = 0x156234;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const strings = ["", "a", "বাংলা", "𝄞", "\ue000", "𐀀", "\u0000\n", "x:y;"];
  const generate = (depth: number): unknown => {
    const which = next() % (depth > 0 ? 7 : 5);
    if (which === 0) return null;
    if (which === 1) return Boolean(next() % 2);
    if (which === 2) return (next() % 200000) - 100000;
    if (which === 3 || which === 4) return strings[next() % strings.length];
    if (which === 5) return [generate(depth - 1), generate(depth - 1)];
    return { [strings[next() % strings.length]!]: generate(depth - 1), nested: generate(depth - 1) };
  };
  const values = Array.from({ length: 200 }, () => generate(4));
  const script = "import json,sys;sys.path.insert(0,sys.argv[1]);import audit_v2;print(json.dumps([audit_v2.encode_value(v).hex() for v in json.load(sys.stdin)]))";
  const directory = fileURLToPath(new URL("../../../scripts/db/", import.meta.url));
  const python = JSON.parse(execFileSync("python3", ["-c", script, directory], { input: JSON.stringify(values), encoding: "utf8" })) as string[];
  assert.deepEqual(values.map((value) => hex(encodeAuditV2Value(value))), python);
});
