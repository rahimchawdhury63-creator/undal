/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Replaying a stream from the order log.
 *
 * The ring is a per-isolate fast path; the log is the durable truth. These tests prove the log path gives
 * the same answers — the frames after the cursor, in order, with the catalogue names — and admits when it
 * only got a page rather than a history.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { orderLogReplay, replayOrder, collectReplay } from "../src/sse/replay.ts";
import { parseChannels } from "../src/sse/channels.ts";
import { BACKENDS } from "./support/backends.ts";

/** Fill an order's log with `count` events, kind PLACED then ACCEPTED, … */
async function fill(coordinator: { appendEvent: (input: { orderId: string; kind: string; actorType: "SYSTEM" }) => Promise<unknown> }, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await coordinator.appendEvent({
      orderId: "order-1",
      kind: index === 0 ? "PLACED" : index === 1 ? "ACCEPTED" : "RIDER_ASSIGNED",
      actorType: "SYSTEM",
    });
  }
}

for (const backend of BACKENDS) {
  describe(`log replay/${backend.name}`, () => {
    test("a live connection replays nothing", async () => {
      const { coordinator } = backend.make();
      await fill(coordinator, 2);
      assert.deepEqual(await replayOrder(coordinator, "order-1", null), { frames: [], complete: true });
    });

    test("a cursor returns everything after it, with catalogue names", async () => {
      const { coordinator } = backend.make();
      await fill(coordinator, 3);
      const replay = await replayOrder(coordinator, "order-1", 1);
      assert.deepEqual(replay.frames.map((frame) => frame.event), ["order.accepted", "order.assigned"]);
      assert.deepEqual(replay.frames.map((frame) => frame.id), [2, 3]);
      assert.equal(replay.complete, true);
    });

    test("a cursor at the head replays nothing and is complete", async () => {
      const { coordinator } = backend.make();
      await fill(coordinator, 2);
      const replay = await replayOrder(coordinator, "order-1", 2);
      assert.deepEqual(replay, { frames: [], complete: true });
    });

    test("a full page is a tail, not a history, and says so", async () => {
      const { coordinator } = backend.make();
      await fill(coordinator, 5);
      const replay = await replayOrder(coordinator, "order-1", 0, 2);
      assert.equal(replay.frames.length, 2);
      assert.equal(replay.complete, false);
    });

    test("a payload survives the log round trip", async () => {
      const { coordinator } = backend.make();
      await coordinator.appendEvent({
        orderId: "order-1",
        kind: "RIDER_ASSIGNED",
        actorType: "RIDER",
        actorId: "rider-a",
        payload: { riderId: "rider-a", wave: 1 },
      });
      const replay = await replayOrder(coordinator, "order-1", 0);
      assert.deepEqual(replay.frames[0], { id: 1, event: "order.assigned", data: { riderId: "rider-a", wave: 1 } });
    });

    test("the source answers order channels and leaves the others alone", async () => {
      const { coordinator } = backend.make();
      await fill(coordinator, 2);
      const source = orderLogReplay(coordinator);
      assert.equal((await source.replay({ kind: "order", id: "order-1" }, 0)).frames.length, 2);
      assert.deepEqual(await source.replay({ kind: "zone", id: "zone-1" }, 0), { frames: [], complete: true });
      assert.deepEqual(await source.replay({ kind: "admin", id: "self" }, 5), { frames: [], complete: true });
    });

    test("collecting a stream keeps the client's channel order", async () => {
      const { coordinator } = backend.make();
      await fill(coordinator, 2);
      const channels = parseChannels("order:order-1,order:order-2");
      const replays = await collectReplay(orderLogReplay(coordinator), channels, 0);
      assert.equal(replays.length, 2);
      assert.equal(replays[0]?.frames.length, 2);
      assert.equal(replays[1]?.frames.length, 0);
    });
  });
}
