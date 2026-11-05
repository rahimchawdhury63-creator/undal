/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * A replay window that cannot lie (`08 §9`, D100).
 *
 * Two failures are possible in a ring that ids frames from a sequence the platform does not own end to end:
 * a frame can arrive **after** a higher-numbered one, and a cursor can arrive for a ring that has never seen
 * the ids the client is quoting. The first breaks the ring's order; the second is worse, because it makes the
 * ring answer `complete` about history it does not have — and a customer reading a silent order page believes
 * nothing happened.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { EventRing } from "../src/sse/ring.ts";
import type { RingEvent } from "../src/sse/ring.ts";

const T0 = 1_793_612_345_678;

const event = (id: number, atMs = T0): RingEvent => ({
  id,
  event: "order.accepted",
  data: { id },
  atMs,
});

describe("a cursor the ring has never reached", () => {
  test("a fresh ring refuses to call an unseen cursor complete", () => {
    const ring = new EventRing();
    // This is a client that reconnected to a new isolate, or a room that was evicted between its frames.
    assert.deepEqual(ring.since(150), { events: [], complete: false });
  });

  test("the same ring answers a cursor it has actually seen", () => {
    const ring = new EventRing();
    ring.push(event(1));
    ring.push(event(2));
    assert.deepEqual(ring.since(2), { events: [], complete: true });
    assert.equal(ring.since(3).complete, false, "one past the highest id is also unseen");
    assert.deepEqual(ring.since(0).events.map((held) => held.id), [1, 2]);
  });

  test("a cursor at zero on a silent channel is complete, because nothing was promised", () => {
    assert.deepEqual(new EventRing().since(0), { events: [], complete: true });
  });

  test("a restored ring keeps the promise, because the snapshot carries the counters", () => {
    const original = new EventRing();
    original.push(event(1));
    original.push(event(2));
    const restored = EventRing.restore(original.snapshot());
    assert.equal(restored.since(2).complete, true);
    // And a ring restored from nothing is not the ring that produced the ids.
    assert.equal(EventRing.restore(undefined).since(2).complete, false);
  });
});

describe("an id that arrives late", () => {
  test("a lower id is recorded where it belongs, not appended", () => {
    const ring = new EventRing();
    ring.push(event(5));
    ring.push(event(3));
    assert.deepEqual(ring.since(2).events.map((held) => held.id), [3, 5]);
  });

  test("replay after the late id's neighbour returns exactly what was missed", () => {
    const ring = new EventRing();
    ring.push(event(5));
    ring.push(event(3));
    // A client that saw 2 gets 3 and 5, in the order a client can apply them.
    assert.deepEqual(ring.since(2).events.map((held) => held.id), [3, 5]);
    // A client that saw 3 gets only 5.
    assert.deepEqual(ring.since(3).events.map((held) => held.id), [5]);
  });

  test("trimming evicts the oldest id, not the earliest arrival", () => {
    const ring = new EventRing(2, 300_000);
    ring.push(event(4, T0 + 1_000));
    ring.push(event(2, T0 + 2_000));
    ring.push(event(6, T0 + 3_000));
    // Two slots: the lowest id went, whichever request produced it.
    assert.deepEqual(ring.snapshot().events.map((held) => held.id), [4, 6]);
    assert.equal(ring.snapshot().evictedThrough, 2);
  });

  test("a duplicate id still replaces the earlier copy rather than inserting a second", () => {
    const ring = new EventRing();
    ring.push(event(7));
    ring.push({ ...event(7), data: { revised: true } });
    assert.equal(ring.length(), 1);
    assert.deepEqual(ring.since(6).events[0]?.data, { revised: true });
  });

  test("an id older than what the ring evicted is still refused", () => {
    const ring = new EventRing(1, 300_000);
    ring.push(event(1));
    ring.push(event(2));
    assert.throws(() => ring.push(event(1)), /older than what the ring still holds/u);
  });
});

describe("the window", () => {
  test("a late event with an old timestamp is trimmed by age, not kept because it is not at the front", () => {
    const ring = new EventRing(200, 300_000);
    ring.push(event(10, T0));
    ring.push(event(4, T0 - 400_000));
    ring.trim(T0 + 1_000);
    assert.deepEqual(ring.snapshot().events.map((held) => held.id), [10]);
  });

  test("an evicted cursor is incomplete even when it is behind the highest id", () => {
    // One slot: recording 3 evicts 2, so a client that saw 1 is missing an event the ring cannot produce.
    const ring = new EventRing(1, 300_000);
    for (const id of [1, 2, 3]) ring.push(event(id, T0 + id));
    const resume = ring.since(1, T0 + 3);
    assert.equal(resume.complete, false, "event 2 was evicted, so the client's gap cannot be filled");
    assert.deepEqual(resume.events.map((held) => held.id), [3]);
  });
});
