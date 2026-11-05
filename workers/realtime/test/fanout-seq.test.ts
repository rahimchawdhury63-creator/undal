/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * A sequence belongs to the channel that owns it (`08 §9`, D101).
 *
 * Core numbers an order's events with the order's own log sequence, and that number is exactly what a client
 * reconnecting to the order channel should quote as `Last-Event-ID`. It is not a number the zone channel can
 * use: a zone carries every order in it, so two orders' first events both arrive as id 1 — and the ring replaces
 * a duplicate id rather than refusing it, which means one of them is silently lost from the admin map.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { broadcast, orderChannel, zoneChannel } from "../src/sse/fanout.ts";
import { MemoryFrameStore } from "../src/sse/store.ts";
import { StreamHub } from "../src/sse/hub.ts";

const T0 = 1_793_612_345_678;

const frame = (overrides: Record<string, unknown> = {}) => ({
  zoneId: "zone-1",
  orderId: "UND-7K2M9QX4",
  event: "order.accepted",
  payload: { state: "ACCEPTED" },
  atMs: T0,
  ...overrides,
});

describe("the order channel", () => {
  test("records the order's own log sequence as the frame id", async () => {
    const store = new MemoryFrameStore(new StreamHub());
    const result = await broadcast(store, { ...frame(), seq: 4 } as never);
    assert.deepEqual(result.recorded.map((entry) => entry.id), [4, 1], "order channel keeps 4, zone numbers its own");
    const replay = await store.replay(orderChannel("UND-7K2M9QX4"), 3, T0);
    assert.deepEqual(replay.frames.map((entry) => entry.id), [4]);
    assert.equal(replay.complete, true);
  });

  test("a broadcast with no sequence is numbered by the ring", async () => {
    const store = new MemoryFrameStore(new StreamHub());
    const result = await broadcast(store, frame() as never);
    assert.deepEqual(result.recorded.map((entry) => entry.id), [1, 1]);
  });
});

describe("the zone channel", () => {
  test("two orders whose first events are both seq 1 both survive", async () => {
    const store = new MemoryFrameStore(new StreamHub());
    await broadcast(store, { ...frame({ orderId: "UND-AAAA1111" }), seq: 1 } as never);
    await broadcast(store, { ...frame({ orderId: "UND-BBBB2222", event: "order.placed" }), seq: 1 } as never);
    const replay = await store.replay(zoneChannel("zone-1"), 0, T0);
    assert.equal(replay.frames.length, 2, "one order's frame must not replace another's on the shared channel");
    assert.deepEqual(replay.frames.map((entry) => entry.id), [1, 2]);
  });

  test("a zone that has seen a hundred events still numbers them itself", async () => {
    const store = new MemoryFrameStore(new StreamHub());
    for (let index = 1; index <= 5; index += 1) {
      await broadcast(store, { ...frame({ orderId: `UND-ORDER${String(index)}` }), seq: 3 } as never);
    }
    const replay = await store.replay(zoneChannel("zone-1"), 0, T0);
    assert.deepEqual(replay.frames.map((entry) => entry.id), [1, 2, 3, 4, 5]);
    assert.equal(replay.complete, true);
  });
});
