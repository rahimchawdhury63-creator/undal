/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The frame store, against both implementations.
 *
 * The in-memory store is what a room holds for one request; the Durable Object store is what survives one.
 * They exist as a port because the failure that matters is the two disagreeing about whether a resume was
 * complete — a client told "you missed nothing" when it missed an event shows a stale order as live — so
 * every assertion runs twice.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { StreamHub } from "../src/sse/hub.ts";
import { MemoryFrameStore } from "../src/sse/store.ts";
import type { FrameStore } from "../src/sse/store.ts";
import { StreamRoom, DurableObjectFrameStore } from "../src/sse/durable-store.ts";
import type { Channel } from "../src/sse/channels.ts";
import { FixedClock } from "../src/lib/clock.ts";
import { T0 } from "./support/backends.ts";

const ORDER: Channel = { kind: "order", id: "UND-7K2M9QX4" };

/** One store and the clock it reads. */
interface StoreFixture {
  readonly store: FrameStore;
  readonly clock: FixedClock;
}

/** A stream room, reachable the same way a Durable Object is. */
function roomHarness(): { namespace: unknown; clock: FixedClock } {
  const clock = new FixedClock(T0);
  return { namespace: new RoomNamespace(() => new StreamRoom(fakeRoomState(), clock)), clock };
}

/** A `DurableObjectState` with real storage semantics and nothing else. */
function fakeRoomState(): DurableObjectState {
  const map = new Map<string, string>();
  return {
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        const raw = map.get(key);
        return raw === undefined ? undefined : (JSON.parse(raw) as T);
      },
      async put<T>(key: string, value: T): Promise<void> {
        map.set(key, JSON.stringify(value));
      },
      async delete(key: string): Promise<boolean> {
        return map.delete(key);
      },
    },
    id: { toString: () => "stream-room", name: "stream-room", equals: () => true },
  } as unknown as DurableObjectState;
}

/** A namespace that builds one room per name, exactly as a Durable Object namespace does. */
class RoomNamespace {
  private readonly rooms = new Map<string, StreamRoom>();
  private readonly make: () => StreamRoom;

  constructor(make: () => StreamRoom) {
    this.make = make;
  }

  idFromName(name: string): DurableObjectId {
    return { toString: () => name, name, equals: (other: DurableObjectId) => other.toString() === name } as unknown as DurableObjectId;
  }

  get(id: DurableObjectId): DurableObjectStub {
    const name = id.toString();
    let room = this.rooms.get(name);
    if (room === undefined) {
      room = this.make();
      this.rooms.set(name, room);
    }
    const resolved = room;
    return {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        resolved.fetch(input instanceof Request ? input : new Request(String(input), init)),
    } as unknown as DurableObjectStub;
  }
}

const STORES: readonly { readonly name: string; readonly make: () => StoreFixture }[] = [
  {
    name: "memory",
    make: () => {
      const clock = new FixedClock(T0);
      return { store: new MemoryFrameStore(new StreamHub()), clock };
    },
  },
  {
    name: "durable-object",
    make: () => {
      const { namespace, clock } = roomHarness();
      return { store: new DurableObjectFrameStore(namespace as unknown as DurableObjectNamespace, clock), clock };
    },
  },
];

for (const fixture of STORES) {
  describe(`frame store/${fixture.name}`, () => {
    test("recording names the frame the way the catalogue does", async () => {
      const { store, clock } = fixture.make();
      const frame = await store.record(ORDER, { kind: "RIDER_ASSIGNED", data: { riderId: "r1" }, atMs: clock.nowMs() });
      assert.deepEqual(frame, { id: 1, event: "order.assigned", data: { riderId: "r1" } });
    });

    test("a kind the catalogue does not carry is not stored", async () => {
      const { store, clock } = fixture.make();
      assert.equal(await store.record(ORDER, { kind: "TELEPORTED", data: {}, atMs: clock.nowMs() }), null);
      assert.deepEqual(await store.replay(ORDER, 0, clock.nowMs()), { frames: [], complete: true });
    });

    test("a live connection replays nothing", async () => {
      const { store, clock } = fixture.make();
      await store.record(ORDER, { kind: "PLACED", data: {}, atMs: clock.nowMs() });
      assert.deepEqual(await store.replay(ORDER, null, clock.nowMs()), { frames: [], complete: true });
    });

    test("ids increase per channel and each channel has its own", async () => {
      const { store, clock } = fixture.make();
      const zone: Channel = { kind: "zone", id: "sylhet" };
      assert.equal((await store.record(ORDER, { kind: "PLACED", data: {}, atMs: clock.nowMs() }))?.id, 1);
      assert.equal((await store.record(ORDER, { kind: "ACCEPTED", data: {}, atMs: clock.nowMs() }))?.id, 2);
      assert.equal((await store.record(zone, { kind: "RIDER_ASSIGNED", data: {}, atMs: clock.nowMs() }))?.id, 1);
    });

    test("a caller's sequence number is kept as the id", async () => {
      const { store, clock } = fixture.make();
      const frame = await store.record(ORDER, { kind: "PLACED", data: {}, atMs: clock.nowMs(), seq: 4_821 });
      assert.equal(frame?.id, 4_821);
      const next = await store.record(ORDER, { kind: "ACCEPTED", data: {}, atMs: clock.nowMs() });
      assert.equal(next?.id, 4_822);
    });

    test("a resume returns what the client missed, oldest first", async () => {
      const { store, clock } = fixture.make();
      for (const kind of ["PLACED", "ACCEPTED", "RIDER_ASSIGNED"]) {
        await store.record(ORDER, { kind, data: { kind }, atMs: clock.nowMs() });
      }
      const replay = await store.replay(ORDER, 1, clock.nowMs());
      assert.deepEqual(replay.frames.map((frame) => frame.id), [2, 3]);
      assert.equal(replay.complete, true);
    });

    test("a cursor at the head is complete and empty", async () => {
      const { store, clock } = fixture.make();
      await store.record(ORDER, { kind: "PLACED", data: {}, atMs: clock.nowMs() });
      assert.deepEqual(await store.replay(ORDER, 1, clock.nowMs()), { frames: [], complete: true });
    });

    test("a cursor older than the window is admitted as incomplete", async () => {
      const { store, clock } = fixture.make();
      await store.record(ORDER, { kind: "PLACED", data: {}, atMs: clock.nowMs() });
      clock.advance(300_001);
      await store.record(ORDER, { kind: "ACCEPTED", data: {}, atMs: clock.nowMs() });
      const replay = await store.replay(ORDER, 0, clock.nowMs());
      assert.deepEqual(replay.frames.map((frame) => frame.event), ["order.accepted"]);
      assert.equal(replay.complete, false);
    });

    test("a resume of a channel that never spoke is empty, and only complete from a cursor it has seen", async () => {
      const { store, clock } = fixture.make();
      // Cursor 5 on a channel that has recorded nothing is not "you missed nothing": a fresh isolate, an
      // evicted room and a lost snapshot look exactly like a channel that never spoke, and each means the
      // frames the client is asking about are somewhere this store cannot see (D100).
      assert.deepEqual(await store.replay({ kind: "zone", id: "nowhere" }, 5, clock.nowMs()), {
        frames: [],
        complete: false,
      });
      assert.deepEqual(await store.replay({ kind: "zone", id: "nowhere" }, 0, clock.nowMs()), {
        frames: [],
        complete: true,
      });
    });
  });
}

describe("the durable ring", () => {
  test("a second room over the same storage sees the events the first recorded", async () => {
    const clock = new FixedClock(T0);
    const state = fakeRoomState();
    const first = new StreamRoom(state, clock);
    await first.record({ kind: "PLACED", data: { n: 1 }, atMs: clock.nowMs() });
    // A new instance over the same state is what an eviction and a wake-up look like from the inside.
    const reopened = new StreamRoom(state, clock);
    const replay = await reopened.replay(0, clock.nowMs());
    assert.equal(replay.frames.length, 1);
    assert.equal(replay.complete, true);
  });

  test("an unknown method is a loud 500, not an empty success", async () => {
    const room = new StreamRoom(fakeRoomState(), new FixedClock(T0));
    const response = await room.fetch(
      new Request("https://stream.room/rpc", { method: "POST", body: JSON.stringify({ method: "teleport", args: [] }) }),
    );
    assert.equal(response.status, 500);
  });

  test("a body that is not a room request is a 400", async () => {
    const room = new StreamRoom(fakeRoomState(), new FixedClock(T0));
    const response = await room.fetch(new Request("https://stream.room/rpc", { method: "POST", body: "not json" }));
    assert.equal(response.status, 400);
  });
});
