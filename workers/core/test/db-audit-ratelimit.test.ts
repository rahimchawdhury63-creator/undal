/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { hashOf, payloadDigest, linkHash, toHex } from "../src/audit/chain.ts";
import { classifyError, isRetryable, pinTimeZone, stubDb } from "../src/db/client.ts";
import { backoffDelay, withTransaction } from "../src/db/transaction.ts";
import { charge } from "../src/ratelimit/kv.ts";
import { LIMIT_COUNT, LIMITS, isLimited, limitsFor } from "../src/ratelimit/limits.ts";
import { enforce } from "../src/ratelimit/coordinated.ts";
import { verifyChain } from "../src/audit/verify.ts";
import { FakeKv } from "./support.ts";

/**
 * The three guarantees the foundation makes that no single request proves: the audit chain
 * hashes what the Python verifier hashes, a bucket refills arithmetically, and a deadlock
 * is retried rather than reported.
 */

const VECTORS = JSON.parse(
  readFileSync(new URL("../../../db/fixtures/audit_chain_vectors.json", import.meta.url), "utf8"),
) as {
  vectors: {
    entry: Record<string, unknown>;
    payloadDigestHex: string;
    hashHex: string;
  }[];
};

interface VectorEntry {
  seq: number;
  occurredAt: string;
  actorId: string | null;
  actorType: string;
  actorRole: string | null;
  requestId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  subjectId: string | null;
  before?: unknown;
  after?: unknown;
  reason: string | null;
  severity: string;
}

describe("the audit chain", () => {
  test("reproduces the shared vectors byte for byte", async () => {
    let previous: Uint8Array | null = null;
    for (const vector of VECTORS.vectors) {
      const entry = vector.entry as unknown as VectorEntry;
      const digest = await payloadDigest({ ...entry, prevHash: previous, ip: null, userAgent: null } as never);
      assert.equal(toHex(digest), vector.payloadDigestHex);
      const hash = await linkHash(previous, digest);
      assert.equal(toHex(hash), vector.hashHex);
      previous = hash;
    }
  });

  test("a row whose payload was edited is reported as a PAYLOAD break", async () => {
    const entries = [
      { seq: 1, occurred_at: "2026-11-01 04:00:00.000000", actor_id: null, actor_type: "SYSTEM", actor_role: null, ip: null, request_id: new Uint8Array(16), action: "a.b.c", resource_type: "x", resource_id: null, subject_id: null, before: null, after: null, reason: null, severity: "INFO", prev_hash: null, hash: new Uint8Array(32) },
    ];
    const hash = await hashOf({
      seq: 1,
      occurredAt: "2026-11-01 04:00:00.000000",
      actorId: null,
      actorType: "SYSTEM",
      actorRole: null,
      requestId: toHex(new Uint8Array(16)).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, "$1-$2-$3-$4-$5"),
      action: "a.b.c",
      ip: null,
      resourceType: "x",
      resourceId: null,
      subjectId: null,
      reason: null,
      severity: "INFO",
      prevHash: null,
    });
    const db = stubDb([{ match: /FROM `audit_log`/u, rows: [{ ...entries[0], hash }] }]);
    const clean = await verifyChain(db);
    assert.equal(clean.breaks.length, 0);

    const tampered = stubDb([{ match: /FROM `audit_log`/u, rows: [{ ...entries[0], hash: new Uint8Array(32) }] }]);
    const broken = await verifyChain(tampered);
    assert.equal(broken.breaks[0]?.reason, "PAYLOAD");
  });
});

describe("rate limits", () => {
  test("the table holds 27 buckets and an absent cell means unthrottled", () => {
    assert.equal(LIMITS.length, LIMIT_COUNT);
    assert.equal(LIMIT_COUNT, 27);
    assert.equal(limitsFor("AUTH", "ANONYMOUS").length, 2);
    assert.equal(isLimited("ADMIN_WRITE", "ANONYMOUS"), false);
  });

  test("a bucket refills with time and refuses when empty", async () => {
    const kv = new FakeKv();
    const limit = { group: "AUTH" as const, actor: "ANONYMOUS" as const, perWindow: 2, windowSeconds: 60, keyedBy: "IP" as const };
    assert.equal((await charge(kv as never, limit, "1.2.3.4", 0)).allowed, true);
    assert.equal((await charge(kv as never, limit, "1.2.3.4", 0)).allowed, true);
    const refused = await charge(kv as never, limit, "1.2.3.4", 0);
    assert.equal(refused.allowed, false);
    assert.ok(refused.retryAfterSeconds >= 1);
    assert.equal((await charge(kv as never, limit, "1.2.3.4", 61_000)).allowed, true);
  });

  test("an anonymous login charges both the IP and the phone bucket", async () => {
    const kv = new FakeKv();
    const verdict = await enforce(kv as never, "AUTH", "ANONYMOUS", { ip: "1.2.3.4", phone: "+8801712345678" }, 0);
    assert.equal(verdict.allowed, true);
    assert.equal(kv.entries.size, 2);
    const missingPhone = await enforce(kv as never, "AUTH", "ANONYMOUS", { ip: "5.6.7.8" }, 0);
    assert.equal(missingPhone.allowed, false);
  });
});

describe("the database client", () => {
  test("classifies the errors that mean retry and the ones that mean stop", () => {
    assert.equal(classifyError({ code: "1213" }), "DEADLOCK");
    assert.equal(classifyError({ code: "1205" }), "LOCK_TIMEOUT");
    assert.equal(classifyError({ code: "1062" }), "DUPLICATE");
    assert.equal(isRetryable("DEADLOCK"), true);
    assert.equal(isRetryable("DUPLICATE"), false);
  });

  test("pins UTC on a DSN, once", () => {
    assert.equal(pinTimeZone("mysql://h/db"), "mysql://h/db?time_zone=%2B00%3A00");
    assert.equal(pinTimeZone("mysql://h/db?x=1"), "mysql://h/db?x=1&time_zone=%2B00%3A00");
    assert.equal(pinTimeZone("mysql://h/db?time_zone=%2B00%3A00"), "mysql://h/db?time_zone=%2B00%3A00");
  });

  test("retries a deadlock and gives up on a constraint failure", async () => {
    let attempts = 0;
    const runner = {
      async begin() {
        attempts += 1;
        const tx = {
          query: async () => [],
          first: async () => null,
          execute: async () => ({ affectedRows: 0 }),
          batch: async () => undefined,
          commit: async () => undefined,
          rollback: async () => undefined,
        };
        return tx;
      },
    };
    const value = await withTransaction(runner as never, async () => {
      if (attempts === 1) throw { code: "1213" };
      return "done";
    }, { sleepFn: async () => undefined, random: () => 0 });
    assert.equal(value, "done");
    assert.equal(attempts, 2);

    let second = 0;
    await assert.rejects(
      withTransaction(
        { async begin() { second += 1; return { query: async () => [], first: async () => null, execute: async () => ({ affectedRows: 0 }), batch: async () => undefined, commit: async () => undefined, rollback: async () => undefined }; } } as never,
        async () => {
          throw { code: "1452" };
        },
        { sleepFn: async () => undefined },
      ),
    );
    assert.equal(second, 1);
  });

  test("the backoff is full jitter and never negative", () => {
    assert.equal(backoffDelay(0, () => 0), 0);
    assert.equal(backoffDelay(3, () => 1), 200);
    assert.ok(backoffDelay(4) <= 400);
  });
});
