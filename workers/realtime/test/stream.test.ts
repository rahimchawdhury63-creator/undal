/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The streaming response, driven by a scheduler the test owns.
 *
 * A keepalive every twenty seconds is the correct production behaviour and an impossible test, so the
 * stream takes its scheduler as a port. These tests pull chunks deliberately, fire the keepalive by
 * hand, and cancel the reader to prove the interval is released — the three moments a Worker leaks.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseChannels } from "../src/sse/channels.ts";
import { RECONCILE_COMMENT, streamResponse } from "../src/sse/stream.ts";
import { StreamHub, eventNameFor } from "../src/sse/hub.ts";
import { formatFrame } from "../src/sse/frame.ts";

/** A scheduler that does nothing until the test says so, and counts its live intervals. */
function manualScheduler(): {
  readonly schedule: (emit: () => void) => () => void;
  readonly tick: () => void;
  readonly live: () => number;
  readonly stopped: () => number;
} {
  let emit: (() => void) | null = null;
  let live = 0;
  let stopped = 0;
  return {
    schedule: (next) => {
      emit = next;
      live += 1;
      return () => {
        live -= 1;
        stopped += 1;
        emit = null;
      };
    },
    tick: () => emit?.(),
    live: () => live,
    stopped: () => stopped,
  };
}

/** Read one chunk as text. */
async function readText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const chunk = await reader.read();
  assert.equal(chunk.done, false);
  return new TextDecoder().decode(chunk.value as Uint8Array);
}

describe("stream response", () => {
  test("a live connection starts empty and carries the stream headers", async () => {
    const channels = parseChannels("order:UND-7K2M9QX4");
    const scheduler = manualScheduler();
    const response = streamResponse({
      requestId: "req-1",
      channels,
      lastEventId: null,
      replay: () => ({ frames: [], complete: true }),
      schedule: scheduler.schedule,
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    assert.equal(response.headers.get("X-Undal-Request-Id"), "req-1");
    await response.body?.cancel();
  });

  test("the first chunk is the replay, in order", async () => {
    const channels = parseChannels("order:A");
    const scheduler = manualScheduler();
    const response = streamResponse({
      requestId: "req-2",
      channels,
      lastEventId: 41,
      replay: () => ({
        frames: [
          { id: 42, event: "order.assigned", data: { riderId: "r1" } },
          { id: 43, event: "order.picked_up", data: {} },
        ],
        complete: true,
      }),
      schedule: scheduler.schedule,
    });
    const reader = response.body?.getReader();
    assert.ok(reader !== undefined);
    const first = await readText(reader);
    assert.equal(first, `${formatFrame({ id: 42, event: "order.assigned", data: { riderId: "r1" } })}${formatFrame({ id: 43, event: "order.picked_up", data: {} })}`);
    await reader.cancel();
    assert.equal(scheduler.stopped(), 1);
  });

  test("an incomplete replay says so before replaying its tail", async () => {
    const channels = parseChannels("order:A");
    const scheduler = manualScheduler();
    const response = streamResponse({
      requestId: "req-3",
      channels,
      lastEventId: 1,
      replay: () => ({ frames: [{ id: 90, event: "order.placed", data: {} }], complete: false }),
      schedule: scheduler.schedule,
    });
    const reader = response.body?.getReader();
    const first = await readText(reader as ReadableStreamDefaultReader<Uint8Array>);
    assert.equal(first.startsWith(`: ${RECONCILE_COMMENT}\n\n`), true);
    assert.equal(first.includes("id: 90"), true);
    await reader?.cancel();
  });

  test("a keepalive is a comment and does not disturb the cursor", async () => {
    const channels = parseChannels("order:A");
    const scheduler = manualScheduler();
    const response = streamResponse({
      requestId: "req-4",
      channels,
      lastEventId: null,
      replay: () => ({ frames: [], complete: true }),
      schedule: scheduler.schedule,
    });
    const reader = response.body?.getReader();
    assert.ok(reader !== undefined);
    scheduler.tick();
    const chunk = await readText(reader);
    assert.equal(chunk, ": keepalive\n\n");
    await reader.cancel();
  });

  test("cancelling the reader releases the interval exactly once", async () => {
    const channels = parseChannels("order:A");
    const scheduler = manualScheduler();
    const response = streamResponse({
      requestId: "req-5",
      channels,
      lastEventId: null,
      replay: () => ({ frames: [], complete: true }),
      schedule: scheduler.schedule,
    });
    assert.equal(scheduler.live(), 1);
    await response.body?.cancel();
    await response.body?.cancel();
    assert.equal(scheduler.live(), 0);
    assert.equal(scheduler.stopped(), 1);
  });

  test("every requested channel is replayed, in the order it was asked for", async () => {
    const channels = parseChannels("order:A,rider:self");
    const scheduler = manualScheduler();
    const asked: string[] = [];
    const response = streamResponse({
      requestId: "req-6",
      channels,
      lastEventId: 5,
      replay: (channel) => {
        asked.push(`${channel.kind}:${channel.id}`);
        return { frames: [{ id: 6, event: "rider.online", data: {} }], complete: true };
      },
      schedule: scheduler.schedule,
    });
    assert.deepEqual(asked, ["order:A", "rider:self"]);
    const reader = response.body?.getReader();
    const first = await readText(reader as ReadableStreamDefaultReader<Uint8Array>);
    assert.equal(first.match(/id: 6/gu)?.length, 2);
    await reader?.cancel();
  });
});

describe("stream hub", () => {
  test("a stored kind maps to a catalogue name", () => {
    assert.equal(eventNameFor("RIDER_ASSIGNED"), "order.assigned");
    assert.equal(eventNameFor("ACCEPTED"), "order.accepted");
    assert.equal(eventNameFor("AUTO_CANCELLED"), "order.cancelled");
  });

  test("a kind the catalogue does not carry is dropped rather than sent unreadable", () => {
    assert.equal(eventNameFor("SOMETHING_NEW"), null);
    const hub = new StreamHub();
    const recorded = hub.record({ kind: "order", id: "A" }, { seq: 1, kind: "SOMETHING_NEW", data: {}, atMs: 0 });
    assert.equal(recorded, null);
    assert.equal(hub.ring({ kind: "order", id: "A" }).length(), 0);
  });

  test("a live connection asks for no replay", () => {
    const hub = new StreamHub();
    hub.record({ kind: "order", id: "A" }, { seq: 1, kind: "PLACED", data: {}, atMs: 0 });
    assert.deepEqual(hub.replay({ kind: "order", id: "A" }, null, 0), { frames: [], complete: true });
  });

  test("a resume after a cursor returns the frames the client missed", () => {
    const hub = new StreamHub();
    const channel = { kind: "order" as const, id: "A" };
    for (const [seq, kind] of [[1, "PLACED"], [2, "ACCEPTED"], [3, "RIDER_ASSIGNED"]] as const) {
      hub.record(channel, { seq, kind, data: { seq }, atMs: seq * 1_000 });
    }
    const replay = hub.replay(channel, 1, 3_000);
    assert.deepEqual(replay.frames.map((frame) => frame.event), ["order.accepted", "order.assigned"]);
    assert.equal(replay.complete, true);
  });

  test("a cursor older than the ring is reported as incomplete", () => {
    const hub = new StreamHub();
    const channel = { kind: "order" as const, id: "A" };
    const ring = hub.ring(channel);
    // Fill past the ring's 200-event capacity, then ask for everything from the start.
    for (let seq = 1; seq <= 250; seq += 1) {
      ring.push({ id: seq, event: "order.placed", data: {}, atMs: seq });
    }
    const replay = hub.replay(channel, 0, 250);
    assert.equal(replay.frames.length, 200);
    assert.equal(replay.complete, false);
  });

  test("two channels of the same kind do not share a ring", () => {
    const hub = new StreamHub();
    hub.record({ kind: "order", id: "A" }, { seq: 1, kind: "PLACED", data: {}, atMs: 0 });
    assert.equal(hub.ring({ kind: "order", id: "B" }).length(), 0);
    assert.equal(hub.ring({ kind: "order", id: "A" }).length(), 1);
  });
});
