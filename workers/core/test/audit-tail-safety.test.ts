/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { AuditEntryInput } from "../src/audit/types.ts";
import { AuditAppendRefusedError, appendAudit } from "../src/audit/write.ts";
import { stubDb } from "../src/db/client.ts";

const REQUEST_ID = "0193f2a1-7c3e-7890-abcd-ef0123456789";
const input: AuditEntryInput = {
  actorId: null,
  actorType: "SYSTEM",
  actorRole: null,
  ip: null,
  userAgent: null,
  requestId: REQUEST_ID,
  action: "test.audit.append",
  resourceType: "test",
  resourceId: null,
  subjectId: null,
  reason: null,
  severity: "INFO",
};

function tailDb(seq: number | string, hash: Uint8Array | null): ReturnType<typeof stubDb> {
  return stubDb([{ match: /SELECT `seq`/u, rows: [{ seq, hash }] }]);
}

test("audit append refuses an invalid tail hash before inserting", async () => {
  for (const hash of [null, new Uint8Array(31), new Uint8Array(33)]) {
    const db = tailDb(7, hash);
    await assert.rejects(
      appendAudit(db, input, 1700000000000),
      (error: unknown) =>
        error instanceof AuditAppendRefusedError && error.reason === "INVALID_TAIL_HASH",
    );
    assert.equal(db.calls.length, 1, "invalid tail must fail before INSERT");
  }
});

test("audit append refuses invalid or unsafe BIGINT sequence values before inserting", async () => {
  const invalidSequences: (number | string)[] = [
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER + 1,
    "0",
    "-1",
    "1.0",
    "9007199254740991",
    "9007199254740992",
    "18446744073709551616",
  ];
  for (const seq of invalidSequences) {
    const db = tailDb(seq, new Uint8Array(32));
    await assert.rejects(
      appendAudit(db, input, 1700000000000),
      (error: unknown) =>
        error instanceof AuditAppendRefusedError && error.reason === "INVALID_TAIL_SEQUENCE",
      String(seq),
    );
    assert.equal(db.calls.length, 1, `unsafe sequence ${String(seq)} must fail before INSERT`);
  }
});

test("audit append parses exact driver BIGINT strings without rounding", async () => {
  const previousHash = new Uint8Array(32).fill(9);
  const db = stubDb([
    { match: /SELECT `seq`/u, rows: [{ seq: "41", hash: previousHash }] },
    { match: /INSERT INTO `audit_log`/u, affectedRows: 1 },
  ]);
  const entry = await appendAudit(db, input, 1700000000000);
  assert.equal(entry.seq, 42);
  assert.deepEqual(entry.prevHash, previousHash);
  assert.equal(db.calls[1]!.params[1], 42);

  const boundaryDb = stubDb([
    { match: /SELECT `seq`/u, rows: [{ seq: "9007199254740990", hash: previousHash }] },
    { match: /INSERT INTO `audit_log`/u, affectedRows: 1 },
  ]);
  const boundaryEntry = await appendAudit(boundaryDb, input, 1700000000000);
  assert.equal(boundaryEntry.seq, Number.MAX_SAFE_INTEGER);
});
