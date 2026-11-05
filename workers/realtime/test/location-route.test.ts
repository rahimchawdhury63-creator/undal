/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `POST /rt/location/batch` (`07 §4.1`, D97).
 *
 * The store is a plain object here, which is the point of the port: these tests are about the route's
 * decisions — which batch is refused, which position lands in which slot, what cadence comes back — and not
 * about D1. The writes it records are asserted as writes: a batch that the gate refuses must produce no
 * `write` call at all, because "we judged it" and "we stored it" are different claims.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { handleLocationBatch } from "../src/routes/location.ts";
import type { LocationContext } from "../src/routes/location.ts";
import type { AcceptedFix } from "../src/d1/ingest.ts";
import type { PositionStore, RiderContext, WriteInput } from "../src/d1/store.ts";

const NOW = 1_762_000_130_000;

interface Recorder extends PositionStore {
  readonly writes: WriteInput[];
  readonly newestCalls: string[];
}

function storeOf(options: {
  readonly rider?: RiderContext | null;
  readonly newest?: AcceptedFix | null;
} = {}): Recorder {
  const writes: WriteInput[] = [];
  const newestCalls: string[] = [];
  const rider = options.rider === undefined ? { zoneId: "zone-1", vehicle: "MOTORBIKE", state: "ON_ORDER", activeOrderId: "order-1", batteryPct: 80 } : options.rider;
  return {
    writes,
    newestCalls,
    async context(): Promise<RiderContext | null> {
      return rider;
    },
    async newest(riderId: string): Promise<AcceptedFix | null> {
      newestCalls.push(riderId);
      return options.newest ?? null;
    },
    async write(input: WriteInput): Promise<void> {
      writes.push(input);
    },
    async erase() {
      return { positions: 0, current: 0 };
    },
    async sweepStale(): Promise<{ riders: number; positions: number }> {
      return { riders: 0, positions: 0 };
    },
  };
}

const request = (body: unknown): Request =>
  new Request("https://rt.undal.app/rt/location/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const batch = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  shiftId: "shift-1",
  seq: 10,
  base: { lat: 24.894215, lon: 91.868912, t: NOW - 10_000, acc: 12, brg: 90 },
  d: [[412, -238, 5_000, 18, 42]],
  ...overrides,
});

const run = async (
  body: unknown,
  overrides: Partial<LocationContext> = {},
  store = storeOf(),
): Promise<{ status: number; body: any; store: Recorder }> => {
  const response = await handleLocationBatch(request(body), {
    store,
    riderId: "rider-1",
    shiftId: null,
    requestId: "req-1",
    nowMs: NOW,
    ...overrides,
  });
  return { status: response.status, body: (await response.json()) as any, store };
};

describe("the route's refusals", () => {
  test("without a D1 binding the route says so instead of pretending to store", async () => {
    const result = await run(batch(), { store: undefined });
    assert.equal(result.status, 501);
    assert.equal(result.body.error.details.reason, "d1_not_configured");
  });

  test("a rider with no open shift has nowhere to put a position", async () => {
    const result = await run(batch(), {}, storeOf({ rider: null }));
    assert.equal(result.status, 409);
    assert.equal(result.body.error.details.reason, "shift_not_started");
  });

  test("a queued batch from an ended shift does not write into the next one", async () => {
    const result = await run(batch(), { shiftId: "shift-2" });
    assert.equal(result.status, 409);
    assert.equal(result.body.error.details.reason, "shift_mismatch");
    assert.equal(result.store.writes.length, 0);
  });

  test("an oversized body is refused before it is parsed", async () => {
    const huge = { ...batch(), pad: "x".repeat(4_000) };
    const result = await run(huge);
    assert.equal(result.status, 422);
    assert.equal(result.body.error.details.reason, "batch_too_large");
  });

  test("a body that is not JSON is a client bug, not a server error", async () => {
    const result = await run("{not json");
    assert.equal(result.status, 422);
    assert.equal(result.body.error.details.reason, "not_json");
  });

  test("a malformed delta reports which rule it broke", async () => {
    const result = await run(batch({ d: [[1, 2]] }));
    assert.equal(result.status, 422);
    assert.equal(result.body.error.details.reason, "bad_delta");
    assert.equal(result.store.writes.length, 0);
  });
});

describe("a batch that is believed", () => {
  test("both positions land in the ring, at the slots the device's counter named", async () => {
    const result = await run(batch({ seq: 118 }));
    assert.equal(result.status, 200);
    assert.equal(result.body.data.accepted, 2);
    assert.equal(result.store.writes.length, 1);
    const write = result.store.writes[0]!;
    assert.deepEqual(write.positions.map((entry) => entry.seq), [118, 119], "the counter wrapped nowhere yet");
    assert.equal(write.riderId, "rider-1");
    assert.equal(write.shiftId, "shift-1");
    assert.equal(write.zoneId, "zone-1");
    assert.equal(write.activeOrderId, "order-1");
    assert.equal(write.positions[1]!.fix.receivedAtMs, NOW, "the edge clock is the arrival time");
  });

  test("the response carries the cadence the device should use next", async () => {
    const result = await run(batch());
    assert.equal(result.status, 200);
    // `ON_ORDER` with no distance to the drop known: carrying far, which is the 100 m / 8 s / 45 s row.
    assert.equal(result.body.data.cadence.phase, "CARRYING_FAR");
    assert.equal(result.body.data.cadence.displacementM, 100);
    assert.equal(result.body.data.cadence.ceilingMs, 45_000);
  });

  test("the marker's staleness is twice the ceiling the rider is now held to", async () => {
    const result = await run(batch());
    const write = result.store.writes[0]!;
    assert.equal(write.staleAfterMs, NOW + 90_000);
  });

  test("a previous fix on file is the baseline the next one is measured against", async () => {
    const previous: AcceptedFix = {
      latE7: 248_942_150,
      lonE7: 918_689_120,
      accuracyM: 12,
      bearingDeg: 90,
      recordedAtMs: NOW - 60_000,
      receivedAtMs: NOW - 60_000,
      isMock: false,
    };
    const result = await run(batch(), {}, storeOf({ newest: previous }));
    assert.deepEqual(result.store.newestCalls, ["rider-1"], "the store was asked, once");
    assert.equal(result.body.data.accepted, 2);
  });
});

describe("a batch that is not believed", () => {
  test("a mocked upload suspends the shift and writes nothing", async () => {
    const result = await run(batch({ mock: true }));
    assert.equal(result.status, 200);
    assert.equal(result.body.data.accepted, 0);
    assert.equal(result.body.data.suspendShift, true);
    assert.deepEqual(result.body.data.refused, { mock_location: 2 });
    assert.equal(result.store.writes.length, 0, "a suspended shift stores no breadcrumbs");
  });

  test("a teleport is counted and the honest fix beside it is still stored", async () => {
    // Base at the origin, then 400 m in half a second: 800 m/s on a motorbike.
    const result = await run(
      batch({
        base: { lat: 24.894215, lon: 91.868912, t: NOW - 60_000, acc: 12 },
        d: [[4_000, 0, 500]],
      }),
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.data.teleports, 1);
    assert.equal(result.body.data.refused.implausible_speed, 1);
    assert.equal(result.body.data.accepted, 1, "the base was already 60 s old, which is plausible");
    assert.equal(result.store.writes[0]!.positions[0]!.seq, 10, "the refused fix kept its slot, so the ring does not shift");
  });

  test("an inaccurate base is refused with the reason that names it", async () => {
    const result = await run(batch({ base: { lat: 24.894215, lon: 91.868912, t: NOW - 10_000, acc: 61 } }));
    assert.equal(result.body.data.refused.poor_accuracy, 1, "the base alone: the delta carried its own accuracy");
    assert.equal(result.body.data.accepted, 1);
    assert.equal(result.store.writes[0]!.positions.length, 1, "half a batch is still a position worth storing");
  });
});
