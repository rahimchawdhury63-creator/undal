/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The two statements, without a database (`07 §5`, D97).
 *
 * A fake D1 is enough to catch the defect that actually happens here: a statement's placeholder count drifting
 * away from the list of values bound to it, which D1 reports at runtime as "wrong number of parameters" on the
 * one flush that mattered. Every statement this module builds is checked for `?`-to-value parity, and the ring
 * insert is checked for `OR REPLACE`, because without it the trail grows until the shift ends.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { d1Positions } from "../src/d1/store.ts";
import type { D1Like } from "../src/d1/store.ts";

interface Captured {
  readonly sql: string;
  readonly values: readonly unknown[];
}

function fakeD1(rows: readonly Record<string, unknown>[] = []): { db: D1Like; captured: Captured[]; batched: number } {
  const captured: Captured[] = [];
  const state = { batched: 0 };
  const db: D1Like = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          captured.push({ sql, values });
          return {
            async run() {
              return { results: rows };
            },
          };
        },
      };
    },
    async batch(statements: readonly { run(): Promise<unknown> }[]) {
      state.batched += statements.length;
      for (const statement of statements) await statement.run();
      return [];
    },
  };
  return {
    db,
    captured,
    get batched() {
      return state.batched;
    },
  };
}

const placeholders = (sql: string): number => (sql.match(/\?/gu) ?? []).length;

const accepted = (overrides: Record<string, unknown> = {}) => ({
  latE7: 248_942_150,
  lonE7: 918_689_120,
  accuracyM: 12,
  bearingDeg: 90,
  recordedAtMs: 1_762_000_120_000,
  receivedAtMs: 1_762_000_130_000,
  isMock: false,
  ...overrides,
});

describe("writing a batch", () => {
  test("every position is written, and the current row is written once, last", async () => {
    const fake = fakeD1();
    const store = d1Positions(fake.db);
    await store.write({
      riderId: "rider-1",
      shiftId: "shift-1",
      zoneId: "zone-1",
      vehicle: "MOTORBIKE",
      state: "ON_ORDER",
      activeOrderId: "order-1",
      batteryPct: 64,
      positions: [
        { seq: 10, fix: accepted() },
        { seq: 11, fix: accepted({ recordedAtMs: 1_762_000_121_000 }) },
      ],
      staleAfterMs: 1_762_000_220_000,
    });

    assert.equal(fake.captured.length, 3, "two positions and one current row");
    assert.equal(fake.batched, 3, "one D1 batch, so the trail and the current row commit together");
    assert.match(fake.captured[0]!.sql, /INSERT OR REPLACE INTO rider_positions/u);
    assert.match(fake.captured[2]!.sql, /INSERT OR REPLACE INTO rider_current/u);
  });

  test("each statement's placeholders match the values bound to it", async () => {
    const fake = fakeD1();
    await d1Positions(fake.db).write({
      riderId: "rider-1",
      shiftId: "shift-1",
      zoneId: "zone-1",
      vehicle: "BICYCLE",
      state: "ONLINE",
      activeOrderId: null,
      batteryPct: null,
      positions: [{ seq: 4, fix: accepted() }],
      staleAfterMs: 1_762_000_500_000,
    });
    for (const statement of fake.captured) {
      assert.equal(statement.values.length, placeholders(statement.sql), `bind count for: ${statement.sql.slice(0, 60)}`);
    }
  });

  test("the current row says where the rider is now, and when they stop being live", async () => {
    const fake = fakeD1();
    await d1Positions(fake.db).write({
      riderId: "rider-1",
      shiftId: "shift-1",
      zoneId: "zone-9",
      vehicle: "MOTORBIKE",
      state: "BREAK",
      activeOrderId: null,
      batteryPct: 41,
      positions: [{ seq: 4, fix: accepted() }],
      staleAfterMs: 1_762_001_330_000,
    });
    const current = fake.captured[1]!;
    assert.equal(current.values[0], "rider-1");
    assert.equal(current.values[2], "zone-9");
    assert.equal(current.values[8], "BREAK");
    assert.equal(current.values[12], 1_762_000_130_000, "updated_at is the edge clock of the last fix");
    assert.equal(current.values[13], 1_762_001_330_000, "stale_after travels with the profile, not a constant");
    // Coordinates travel as decimal degrees, because the column is REAL and the ring is read by a map.
    assert.equal(current.values[4], 24.894215);
  });
});

describe("reading what was there", () => {
  test("the newest fix comes back in e7, ready to be a baseline", async () => {
    const fake = fakeD1([
      {
        lat: 24.894215,
        lon: 91.868912,
        accuracy_m: 12,
        bearing_deg: 90,
        recorded_at: 1_762_000_120_000,
        received_at: 1_762_000_130_000,
      },
    ]);
    const newest = await d1Positions(fake.db).newest("rider-1");
    assert.deepEqual(newest, {
      latE7: 248_942_150,
      lonE7: 918_689_120,
      accuracyM: 12,
      bearingDeg: 90,
      recordedAtMs: 1_762_000_120_000,
      receivedAtMs: 1_762_000_130_000,
      isMock: false,
    });
  });

  test("a rider with no trail has no baseline, which is how a shift start is detected", async () => {
    assert.equal(await d1Positions(fakeD1().db).newest("rider-1"), null);
  });

  test("a rider with no current row has no shift open", async () => {
    assert.equal(await d1Positions(fakeD1().db).context("rider-1"), null);
  });

  test("the current row's zone, vehicle and state are what the next batch is judged against", async () => {
    const fake = fakeD1([{ zone_id: "zone-3", vehicle: "BICYCLE", state: "ONLINE", active_order_id: null, battery_pct: 22 }]);
    assert.deepEqual(await d1Positions(fake.db).context("rider-1"), {
      zoneId: "zone-3",
      vehicle: "BICYCLE",
      state: "ONLINE",
      activeOrderId: null,
      batteryPct: 22,
    });
  });
});
