/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Presence erases the live channel (`07 §6.1`, D99).
 *
 * The cases are the ones that decide whether the promise survives contact with a bad night: a device that
 * went silent erases at the instant its absence is published; a deployment without D1 publishes and erases
 * nothing; and a D1 failure is reported without taking the alarm down with it.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { absenceEraser } from "../src/d1/on-absence.ts";
import type { AbsenceRecord } from "../src/presence/ledger.ts";
import type { Erasure, PositionStore } from "../src/d1/store.ts";

const T0 = 1_793_612_345_678;

const absence = (overrides: Partial<AbsenceRecord> = {}): AbsenceRecord => ({
  actorId: "rider-1",
  deviceId: "device-1",
  reason: "HEARTBEAT_TIMEOUT",
  detectedAtMs: T0,
  publishedAtMs: T0 + 2_000,
  ...overrides,
});

interface Recorder extends PositionStore {
  readonly erased: string[];
}

function storeOf(options: { fail?: boolean } = {}): Recorder {
  const erased: string[] = [];
  return {
    erased,
    async context() {
      return null;
    },
    async newest() {
      return null;
    },
    async write() {},
    async erase(riderId: string): Promise<Erasure> {
      if (options.fail === true) throw new Error("d1 unavailable");
      erased.push(riderId);
      return { positions: 12, current: 1 };
    },
    async sweepStale(): Promise<{ riders: number; positions: number }> {
      return { riders: 0, positions: 0 };
    },
    async open(): Promise<void> {
      // The route that opens a shift is tested where it lives; these fakes only have to satisfy the port.
    },
  };
}

describe("an absence erases", () => {
  test("the actor's trail goes at the moment the absence is published", async () => {
    const store = storeOf();
    await absenceEraser(store)(absence());
    assert.deepEqual(store.erased, ["rider-1"]);
  });

  test("every reason erases: a timeout, a goodbye and a drop all mean the same thing to D1", async () => {
    const store = storeOf();
    const erase = absenceEraser(store);
    for (const reason of ["HEARTBEAT_TIMEOUT", "USER_OFFLINE", "TRANSPORT_CLOSED"] as const) {
      await erase(absence({ reason }));
    }
    assert.deepEqual(store.erased, ["rider-1", "rider-1", "rider-1"]);
  });

  test("the handler is idempotent, because the hub publishes each absence exactly once but the erase may race a shift end", async () => {
    const store = storeOf();
    const erase = absenceEraser(store);
    await erase(absence());
    await erase(absence());
    assert.equal(store.erased.length, 2, "the store's own DELETE is what makes the second one harmless");
  });
});

describe("a deployment without D1", () => {
  test("publishes the absence and erases nothing", async () => {
    // No throw, no work: presence is not allowed to depend on the live-position database existing.
    await absenceEraser(null)(absence());
    await absenceEraser(undefined)(absence());
  });
});

describe("a failing database", () => {
  test("does not throw, because the absence is already published and the alarm has other work", async () => {
    const failures: { record: AbsenceRecord; error: unknown }[] = [];
    const erase = absenceEraser(storeOf({ fail: true }), (record, error) => failures.push({ record, error }));
    await erase(absence());
    assert.equal(failures.length, 1);
    assert.equal(failures[0]!.record.actorId, "rider-1");
    assert.match(String(failures[0]!.error), /d1 unavailable/u);
  });

  test("a failure with no reporter is still swallowed rather than failing the alarm", async () => {
    await absenceEraser(storeOf({ fail: true }))(absence());
  });
});
