/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * A heartbeat is a frame; a stamp is a write (D89).
 *
 * The free path's presence store is billed per operation. A 750 ms cadence over an eight-hour shift is
 * 38 400 beats per device, and a row write per beat would be a store that costs more than the orders it
 * describes. These tests count the operations a shift actually costs, and they count them on the real
 * coordinator class rather than a mock of it — the number is the deliverable.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { FixedClock } from "../src/lib/clock.ts";
import { HEARTBEAT_STAMP_MS, PRESENCE_STALENESS_MS } from "../src/coordination/coordinator.ts";
import { TiDBCoordinator } from "../src/coordination/tidb.ts";
import type { StateStore } from "../src/coordination/tidb.ts";
import { MemorySql, MemoryStore } from "./support/fakes.ts";

const T0 = 1_700_000_000_000;
const BEAT_MS = 750;

/** A store that remembers exactly what was asked of it. */
class CountingStore implements StateStore {
  readonly inner = new MemoryStore();
  reads = 0;
  writes = 0;
  deletes = 0;
  lists = 0;

  async get<T>(key: string): Promise<T | null> {
    this.reads += 1;
    return this.inner.get<T>(key);
  }

  async put<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.writes += 1;
    await this.inner.put(key, value, ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    this.deletes += 1;
    await this.inner.delete(key);
  }

  async list<T>(prefix: string): Promise<readonly { readonly key: string; readonly value: T }[]> {
    this.lists += 1;
    return this.inner.list<T>(prefix);
  }

  /** Every billed operation, which is the number the free tier counts. */
  get operations(): number {
    return this.reads + this.writes + this.deletes + this.lists;
  }
}

/** A coordinator and the store it writes to. */
function coordinator(store: CountingStore, clock: FixedClock = new FixedClock(T0)) {
  return new TiDBCoordinator(new MemorySql(), store, clock);
}

/** The vendor's device joining a zone. */
const CLAIM = { actorId: "vendor-1", deviceId: "phone-1", role: "PARTNER", zoneId: "zone-1" } as const;

describe("the cost of a shift", () => {
  test("eight hours at 750 ms costs one write per stamp, not one per beat", async () => {
    const store = new CountingStore();
    const clock = new FixedClock(T0);
    const hub = coordinator(store, clock);
    await hub.declarePresence(CLAIM);

    const shiftMs = 8 * 60 * 60 * 1_000;
    let beats = 0;
    while (clock.nowMs() - T0 < shiftMs) {
      clock.advance(BEAT_MS);
      const ack = await hub.heartbeat(CLAIM.zoneId, CLAIM.actorId, CLAIM.deviceId, beats + 1);
      assert.equal(ack.known, true);
      assert.equal(ack.deadlineMs, clock.nowMs() + 2_000, "the ack deadline stays two seconds");
      beats += 1;
    }

    assert.equal(beats, 38_400);
    // One write when the session was declared, then one per closed stamp window and no others.
    assert.equal(store.writes, 1 + Math.floor(shiftMs / HEARTBEAT_STAMP_MS));
    assert.equal(beats / store.writes > 19, true, `expected ~20x fewer writes, saw ${beats}/${store.writes}`);
    assert.equal(store.lists, 0, "a memoized session never needs to list the zone again");
    assert.equal(store.reads, 0);
  });

  test("a beat inside the stamp window touches the store not at all", async () => {
    const store = new CountingStore();
    const clock = new FixedClock(T0);
    const hub = coordinator(store, clock);
    await hub.declarePresence(CLAIM);
    const afterDeclare = store.operations;

    for (let beat = 1; beat < HEARTBEAT_STAMP_MS / BEAT_MS; beat += 1) {
      clock.advance(BEAT_MS);
      await hub.heartbeat(CLAIM.zoneId, CLAIM.actorId, CLAIM.deviceId, beat);
    }

    assert.equal(store.operations, afterDeclare);
  });

  test("a device that is not present costs one lookup per window and no writes", async () => {
    const store = new CountingStore();
    const clock = new FixedClock(T0);
    const hub = coordinator(store, clock);

    const minuteOfBeats = 60_000 / BEAT_MS;
    for (let beat = 1; beat <= minuteOfBeats; beat += 1) {
      clock.advance(BEAT_MS);
      const ack = await hub.heartbeat("zone-1", "ghost", "ghost-phone", beat);
      assert.equal(ack.known, false);
    }

    assert.equal(store.writes, 0);
    // The first lookup is the first beat; the window is then counted from that memo, not from the clock's origin.
    assert.equal(store.lists, 1 + Math.floor((60_000 - BEAT_MS) / HEARTBEAT_STAMP_MS));
  });
});

describe("what the row means", () => {
  test("a stamped row is listed, and the reader — not the store — decides it is alive", async () => {
    const store = new CountingStore();
    const clock = new FixedClock(T0);
    const hub = coordinator(store, clock);
    await hub.declarePresence(CLAIM);

    clock.advance(PRESENCE_STALENESS_MS);
    const inside = (await hub.listPresence("zone-1"))[0];
    assert.notEqual(inside, undefined, "the row is listed while it could describe a live socket");
    assert.equal(clock.nowMs() - (inside?.lastHeartbeatMs ?? 0) <= hub.presenceWindowMs, true);

    clock.advance(1);
    const outside = (await hub.listPresence("zone-1"))[0];
    assert.notEqual(outside, undefined, "expiry is an explicit markAbsent, not a silent omission");
    assert.equal(clock.nowMs() - (outside?.lastHeartbeatMs ?? 0) <= hub.presenceWindowMs, false);
  });

  test("markAbsent after a declare is one delete and no list", async () => {
    const store = new CountingStore();
    const clock = new FixedClock(T0);
    const hub = coordinator(store, clock);
    await hub.declarePresence(CLAIM);
    const listsBefore = store.lists;

    await hub.markAbsent(CLAIM.zoneId, CLAIM.actorId, CLAIM.deviceId, "socket_closed");

    assert.equal(store.lists, listsBefore);
    assert.equal(store.deletes, 1);
    assert.deepEqual(await hub.listPresence("zone-1"), []);
  });

  test("a beat that arrives before its declare is not remembered as absent", async () => {
    const store = new CountingStore();
    const clock = new FixedClock(T0);
    const hub = coordinator(store, clock);

    const early = await hub.heartbeat(CLAIM.zoneId, CLAIM.actorId, CLAIM.deviceId, 1);
    assert.equal(early.known, false, "no session exists yet");

    await hub.declarePresence(CLAIM);
    clock.advance(BEAT_MS);
    const late = await hub.heartbeat(CLAIM.zoneId, CLAIM.actorId, CLAIM.deviceId, 2);
    assert.equal(late.known, true);
  });
});
