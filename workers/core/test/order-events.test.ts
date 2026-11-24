/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Appending an order's event, when two transitions race for the same number (`06 §3`, D102).
 *
 * The failure this module exists to prevent is quiet: the `UPDATE … WHERE state = ?` won the race, so the order
 * moved; the `MAX(seq)+1` was computed before the other request inserted, so the unique index refuses the event
 * row. Without a retry the caller gets an error about a change that did happen, and the order's log is missing
 * the row that explains it.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { MAX_EVENT_APPEND_ATTEMPTS, appendEvent, moveState } from "../src/repositories/orders.ts";
import type { Db } from "../src/db/client.ts";

const ORDER_ID = new Uint8Array(16).fill(7);
const EVENT_ID = new Uint8Array(16).fill(3);

/** A database that answers by statement shape and can refuse an insert a fixed number of times. */
function fakeDb(options: {
  readonly last?: number;
  readonly insertFailures?: number;
  readonly code?: string;
  readonly updates?: number;
} = {}): Db & { readonly calls: { sql: string; params: readonly unknown[] }[]; readonly insertedSeqs: number[] } {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const insertedSeqs: number[] = [];
  let failures = options.insertFailures ?? 0;
  let last = options.last ?? 0;
  return {
    calls,
    insertedSeqs,
    async query() {
      return [];
    },
    async first<T>(sql: string): Promise<T | null> {
      calls.push({ sql, params: [] });
      if (/MAX\(`seq`\)/u.test(sql)) return { last } as unknown as T;
      return null;
    },
    async execute(sql: string, params: readonly unknown[] = []) {
      calls.push({ sql, params });
      if (sql.startsWith("UPDATE")) return { affectedRows: options.updates ?? 1 };
      if (!sql.startsWith("INSERT")) return { affectedRows: 0 };
      const seq = Number(params[2]);
      if (failures > 0) {
        failures -= 1;
        // The one number this request asked for is taken, so the *next* MAX has moved past it.
        last = Math.max(last, seq);
        const message =
          options.code === undefined ? "Duplicate entry for key 'uq_order_events_seq'" : "Lock wait timeout exceeded";
        const error = new Error(message) as Error & { code: string };
        error.code = options.code ?? "1062";
        throw error;
      }
      insertedSeqs.push(seq);
      last = Math.max(last, seq);
      return { affectedRows: 1 };
    },
    async batch() {},
  };
}

const input = {
  orderId: ORDER_ID,
  eventId: EVENT_ID,
  from: "PLACED" as const,
  to: "ACCEPTED" as const,
  actor: "VENDOR",
  actorUserId: null,
  event: "order.accepted",
  reasonCode: null,
  reasonText: null,
  now: "2026-11-05 10:00:00.000000",
};

describe("the append", () => {
  test("the first event of an order is sequence 1", async () => {
    const db = fakeDb({ last: 0 });
    assert.equal(await appendEvent(db, input), 1);
    assert.deepEqual(db.insertedSeqs, [1]);
  });

  test("the sequence continues from the order's own log", async () => {
    const db = fakeDb({ last: 6 });
    assert.equal(await appendEvent(db, input), 7);
    assert.equal(db.insertedSeqs[0], 7);
  });
});

describe("a race for the same number", () => {
  test("a duplicate is retried with the next sequence rather than failing the transition", async () => {
    const db = fakeDb({ last: 4, insertFailures: 1 });
    const seq = await appendEvent(db, input);
    assert.equal(seq, 6, "the first attempt lost 5 to another request, so this one took 6");
    assert.deepEqual(db.insertedSeqs, [6]);
  });

  test("several lost races in a row are still just a slower append", async () => {
    const db = fakeDb({ last: 9, insertFailures: 3 });
    assert.equal(await appendEvent(db, input), 13);
    assert.deepEqual(db.insertedSeqs, [13]);
  });

  test("a duplicate that never clears is thrown, because five attempts is not contention any more", async () => {
    const db = fakeDb({ last: 0, insertFailures: MAX_EVENT_APPEND_ATTEMPTS });
    await assert.rejects(() => appendEvent(db, input), /Duplicate entry/u);
    assert.deepEqual(db.insertedSeqs, [], "nothing was appended");
  });

  test("a database that is down is not retried as if it were a duplicate", async () => {
    const db = fakeDb({ last: 2, insertFailures: 5, code: "1205" });
    const attempts = db.calls.length;
    await assert.rejects(() => appendEvent(db, input), /Lock wait timeout/u);
    // One attempt, not five: a lock timeout is not the index telling us to take another number.
    assert.equal(db.calls.length - attempts, 2, "one SELECT and one INSERT");
  });
});

describe("the move that wins the race", () => {
  test("a state row that did not match appends no event", async () => {
    const db = fakeDb({ updates: 0 });
    const moved = await moveState(db, {
      orderId: ORDER_ID,
      eventId: EVENT_ID,
      from: "PLACED",
      to: "ACCEPTED",
      actor: "VENDOR",
      actorUserId: null,
      event: "order.accepted",
      reasonCode: null,
      reasonText: null,
      nowMs: 1_762_000_000_000,
    });
    assert.deepEqual(moved, { applied: false, seq: 0 });
    assert.deepEqual(db.insertedSeqs, []);
    assert.equal(
      db.calls.some((call) => call.sql.startsWith("INSERT")),
      false,
      "an order another request already moved has nothing to log",
    );
  });

  test("a move that applied reports the sequence it wrote, which is what the stream carries", async () => {
    const db = fakeDb({ last: 2 });
    const moved = await moveState(db, {
      orderId: ORDER_ID,
      eventId: EVENT_ID,
      from: "PLACED",
      to: "ACCEPTED",
      actor: "VENDOR",
      actorUserId: null,
      event: "order.accepted",
      reasonCode: null,
      reasonText: null,
      nowMs: 1_762_000_000_000,
    });
    assert.deepEqual(moved, { applied: true, seq: 3 });
  });
});
