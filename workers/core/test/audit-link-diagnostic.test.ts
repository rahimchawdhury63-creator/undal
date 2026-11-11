/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { type Db, stubDb } from "../src/db/client.ts";
import { verifyChain } from "../src/audit/verify.ts";
import { lastVerification, recordOf, saveVerification } from "../src/audit/verifications.ts";
import { appendAudit } from "../src/audit/write.ts";

interface Link { seq: number; prev: string | null; hash: string }
const vectors = JSON.parse(readFileSync(new URL("../../../db/fixtures/audit_link_vectors.json", import.meta.url), "utf8")) as {
  cases: { name: string; rows: Link[]; status: string; reasons: string[] }[];
};
const bytes = (value: string | null) => value === null ? null : new Uint8Array(Buffer.from(value, "hex"));
const row = (link: Link) => ({ seq: link.seq, prev_hash: bytes(link.prev), hash: bytes(link.hash) });
function pagedDb(rows: readonly unknown[]): Db {
  return {
    async query<T>(_sql: string, params: readonly unknown[] = []) {
      return rows.filter((item) => Number((item as { seq: unknown }).seq) >= Number(params[0])).slice(0, Number(params[1])) as T[];
    },
    async first<T>() { return null as T | null; },
    async execute() { throw new Error("must not write"); },
    async batch() { throw new Error("must not write"); },
  };
}

test("shared link vectors report breaks or incomplete, never verified", async () => {
  for (const fixture of vectors.cases) {
    const report = await verifyChain(pagedDb(fixture.rows.map(row)), { batchSize: 1 });
    assert.equal(report.status, fixture.status, fixture.name);
    assert.deepEqual(report.breaks.map((x) => x.reason), fixture.reasons, fixture.name);
    assert.equal(report.payloadsVerified, false);
    assert.equal(report.rows, fixture.rows.length);
  }
});

test("partial ranges have no trusted predecessor and cannot produce OK records", async () => {
  const fixture = vectors.cases[1]!;
  const report = await verifyChain(pagedDb(fixture.rows.map(row)), { fromSeq: 2, batchSize: 1 });
  assert.equal(report.fromSeq, 2); assert.equal(report.lastSeq, 2); assert.equal(report.status, "INCOMPLETE");
  const record = recordOf(report, 2, new Date("2026-01-01T00:00:00Z"), { durationMs: 1, triggeredBy: "ADMIN" });
  assert.equal(record.result, "ERROR"); assert.equal(record.toSeq, 2); assert.equal(record.breakSeq, null);
  assert.throws(() => recordOf(report, 1, new Date(), { durationMs: 1, triggeredBy: "ADMIN" }), RangeError);
  const gap = await verifyChain(pagedDb(vectors.cases[2]!.rows.map(row)));
  assert.equal(recordOf(gap, 1, new Date(), { durationMs: 1, triggeredBy: "ADMIN" }).result, "BREAK");
  assert.equal(recordOf(gap, 1, new Date(), { durationMs: 1, triggeredBy: "ADMIN" }).toSeq, 3);
});

test("unversioned verifier cannot persist an OK record", async () => {
  const db = stubDb([]);
  await assert.rejects(saveVerification(db, { fromSeq: 1, toSeq: 1, result: "OK", breakSeq: null,
    durationMs: 1, triggeredBy: "ADMIN", ranAt: new Date() }), /cannot establish OK/u);
  assert.equal(db.calls.length, 0);
});

test("unversioned historical verification records never become trusted OK or BREAK", async () => {
  for (const result of ["OK", "BREAK", "ERROR"]) {
    const db = stubDb([{ match: /FROM `audit_verifications`/u, rows: [{ from_seq: 1, to_seq: 3, result, break_seq: 2,
      duration_ms: 5, trigger_by: "NIGHTLY", ran_at: "2026-01-01 00:00:00.000000" }] }]);
    const record = await lastVerification(db);
    assert.equal(record?.result, "ERROR"); assert.equal(record?.breakSeq, null);
  }
});

test("invalid bounds, malformed hashes, out-of-order pages and duplicates fail closed", async () => {
  const empty = pagedDb([]);
  for (const fromSeq of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(verifyChain(empty, { fromSeq }), RangeError);
  for (const batchSize of [0, -1, 1.5, 1001, NaN]) await assert.rejects(verifyChain(empty, { batchSize }), RangeError);
  for (const bad of [null, new Uint8Array(2), "not bytes"]) {
    await assert.rejects(verifyChain(pagedDb([{ seq: 1, prev_hash: null, hash: bad }])), RangeError);
  }
  const unordered = pagedDb([{ seq: 2, prev_hash: null, hash: new Uint8Array(32) }, { seq: 1, prev_hash: null, hash: new Uint8Array(32) }]);
  await assert.rejects(verifyChain(unordered), /strictly increasing/u);
  const duplicate = pagedDb([{ seq: 1, prev_hash: null, hash: new Uint8Array(32) }, { seq: 1, prev_hash: null, hash: new Uint8Array(32) }]);
  await assert.rejects(verifyChain(duplicate), /strictly increasing/u);
});

test("new audit writes canonicalize UUID spellings and persist IPv6 before hashing", async () => {
  const id = "0193f2a1-7c3e-7890-abcd-ef0123456789";
  const input = { actorId: id, actorType: "ADMIN" as const, actorRole: "FINANCE", ip: "2001:0DB8:0:0:0:0:0:1", userAgent: null,
    requestId: id, action: "example.action", resourceType: "test", resourceId: null, subjectId: id, reason: null, severity: "INFO" as const };
  const make = () => stubDb([{ match: /SELECT `seq`/u, rows: [] }, { match: /INSERT INTO `audit_log`/u, affectedRows: 1 }]);
  const left = make(), right = make();
  const entry = await appendAudit(left, input, 1700000000000);
  await appendAudit(right, { ...input, actorId: id.toUpperCase().replaceAll("-", ""),
    requestId: id.toUpperCase().replaceAll("-", ""), subjectId: id.toUpperCase().replaceAll("-", ""), ip: "2001:db8::1" }, 1700000000000);
  const a = left.calls[1]!.params, b = right.calls[1]!.params;
  assert.equal(entry.actorId, id);
  assert.equal(entry.ip, "2001:db8::1");
  assert.deepEqual(a[3], b[3]);
  assert.deepEqual(a[6], new Uint8Array([0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]));
  assert.deepEqual(a[6], b[6]);
  assert.deepEqual(a[8], b[8]);
  assert.deepEqual(a[12], b[12]);
  assert.deepEqual(a[18], b[18]);
});

test("new audit writes normalize IPv4 octets to the exact stored bytes", async () => {
  const id = "0193f2a1-7c3e-7890-abcd-ef0123456789";
  const input = { actorId: id, actorType: "ADMIN" as const, actorRole: "FINANCE", ip: "192.000.002.009", userAgent: null,
    requestId: id, action: "example.action", resourceType: "test", resourceId: null, subjectId: null, reason: null, severity: "INFO" as const };
  const make = () => stubDb([{ match: /SELECT `seq`/u, rows: [] }, { match: /INSERT INTO `audit_log`/u, affectedRows: 1 }]);
  const expanded = make(), canonical = make();
  const entry = await appendAudit(expanded, input, 1700000000000);
  await appendAudit(canonical, { ...input, ip: "192.0.2.9" }, 1700000000000);
  assert.equal(entry.ip, "192.0.2.9");
  assert.deepEqual(expanded.calls[1]!.params[6], new Uint8Array([192, 0, 2, 9]));
  assert.deepEqual(expanded.calls[1]!.params[18], canonical.calls[1]!.params[18]);
});

test("invalid audit IPs and the missing-IP sentinel normalize to NULL before hashing", async () => {
  const id = "0193f2a1-7c3e-7890-abcd-ef0123456789";
  const input = { actorId: id, actorType: "ADMIN" as const, actorRole: "FINANCE", ip: "unknown", userAgent: null,
    requestId: id, action: "example.action", resourceType: "test", resourceId: null, subjectId: null, reason: null, severity: "INFO" as const };
  const make = () => stubDb([{ match: /SELECT `seq`/u, rows: [] }, { match: /INSERT INTO `audit_log`/u, affectedRows: 1 }]);
  const invalid = make(), unknown = make(), missing = make();
  await appendAudit(invalid, { ...input, ip: "999.1.2.3" }, 1700000000000);
  await appendAudit(unknown, input, 1700000000000);
  await appendAudit(missing, { ...input, ip: null }, 1700000000000);
  assert.equal(invalid.calls[1]!.params[6], null);
  assert.equal(unknown.calls[1]!.params[6], null);
  assert.equal(missing.calls[1]!.params[6], null);
  assert.deepEqual(invalid.calls[1]!.params[18], missing.calls[1]!.params[18]);
  assert.deepEqual(unknown.calls[1]!.params[18], missing.calls[1]!.params[18]);
});
