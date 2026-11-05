/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * A stream that keeps carrying the order (`08 §9`, D103).
 *
 * Until this existed, an SSE response was a replay and then twenty-second keepalives: a customer who connected
 * during a quiet minute never learned that the vendor accepted, because nothing pulled the frames recorded after
 * the response began. These tests drive the tick by hand and read what a socket would have received.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseChannels } from "../src/sse/channels.ts";
import { RECONCILE_COMMENT, TAIL_INTERVAL_MS, streamResponse } from "../src/sse/stream.ts";
import type { ChannelReplay } from "../src/sse/hub.ts";
import type { Channel } from "../src/sse/channels.ts";

const ORDER: Channel = { kind: "order", id: "UND-7K2M9QX4" };
const ZONE: Channel = { kind: "zone", id: "zone-1" };

/** A scheduler the test fires by hand. */
function manualScheduler(): { schedule: (emit: () => void) => () => void; tick: () => Promise<void>; live: () => number } {
  let emit: (() => void) | null = null;
  let live = 0;
  return {
    schedule: (next) => {
      emit = next;
      live += 1;
      return () => {
        live -= 1;
        emit = null;
      };
    },
    // The stream's tick starts an async pull; awaiting a macrotask lets it finish before assertions.
    tick: async () => {
      emit?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    live: () => live,
  };
}

async function readText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const chunk = await reader.read();
  return chunk.done === true ? "" : new TextDecoder().decode(chunk.value as Uint8Array);
}

/** Every chunk enqueued so far, concatenated: a repeat that lands in a later chunk is still a repeat. */
async function readAll(reader: ReadableStreamDefaultReader<Uint8Array>, chunks: number): Promise<string> {
  let text = "";
  for (let index = 0; index < chunks; index += 1) text += await readText(reader);
  return text;
}

const frame = (id: number, event = "order.accepted") => ({ id, event, data: { state: "ACCEPTED" } });

describe("the tail", () => {
  test("frames recorded after the stream began reach the socket", async () => {
    const scheduler = manualScheduler();
    let pull = 0;
    const response = streamResponse({
      requestId: "req-1",
      channels: [ORDER],
      lastEventId: null,
      replays: [{ frames: [], complete: true }],
      schedule: scheduler.schedule,
      tail: () => {
        pull += 1;
        return pull === 1 ? { frames: [frame(4)], complete: true } : { frames: [], complete: true };
      },
    });
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await scheduler.tick();
    const chunk = await readText(reader);
    assert.match(chunk, /id: 4/u);
    assert.match(chunk, /event: order\.accepted/u);
    await reader.cancel();
  });

  test("the cursor advances, so nothing is sent twice", async () => {
    const scheduler = manualScheduler();
    const cursors: (number | null)[] = [];
    const response = streamResponse({
      requestId: "req-1",
      channels: [ORDER],
      lastEventId: null,
      replays: [{ frames: [], complete: true }],
      schedule: scheduler.schedule,
      tail: (_channel, cursor) => {
        cursors.push(cursor);
        return cursors.length === 1 ? { frames: [frame(4)], complete: true } : { frames: [], complete: true };
      },
    });
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await scheduler.tick();
    await readText(reader);
    await scheduler.tick();
    assert.deepEqual(cursors, [null, 4]);
    await reader.cancel();
  });

  test("each channel keeps its own cursor, because each numbers its own frames", async () => {
    const scheduler = manualScheduler();
    const asked: { channel: string; cursor: number | null }[] = [];
    let answered = false;
    const response = streamResponse({
      requestId: "req-1",
      channels: [ORDER, ZONE],
      lastEventId: 7,
      replays: [
        { frames: [], complete: true },
        { frames: [], complete: true },
      ],
      schedule: scheduler.schedule,
      tail: (channel, cursor) => {
        asked.push({ channel: channel.kind, cursor });
        if (answered) return { frames: [], complete: true };
        return channel.kind === "order" ? { frames: [frame(9)], complete: true } : { frames: [], complete: true };
      },
    });
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await scheduler.tick();
    await readText(reader);
    answered = true;
    await scheduler.tick();
    assert.deepEqual(asked.slice(0, 2), [
      { channel: "order", cursor: 7 },
      { channel: "zone", cursor: 7 },
    ]);
    assert.equal(asked[2]?.cursor, 9, "the order channel moved to 9");
    assert.equal(asked[3]?.cursor, 7, "the zone channel did not inherit the order's number");
    await reader.cancel();
  });

  test("a gap is admitted once, not once per tick", async () => {
    const scheduler = manualScheduler();
    const response = streamResponse({
      requestId: "req-1",
      channels: [ORDER],
      lastEventId: 3,
      replays: [{ frames: [], complete: true }],
      schedule: scheduler.schedule,
      tail: () => ({ frames: [frame(6)], complete: false }),
    });
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await scheduler.tick();
    await scheduler.tick();
    await scheduler.tick();
    const all = await readAll(reader, 3);
    assert.equal((all.match(new RegExp(RECONCILE_COMMENT, "gu")) ?? []).length, 1, all);
    await reader.cancel();
  });

  test("a quiet order still gets a keepalive when the keepalive interval passes", async () => {
    const scheduler = manualScheduler();
    const response = streamResponse({
      requestId: "req-1",
      channels: [ORDER],
      lastEventId: null,
      replays: [{ frames: [], complete: true }],
      schedule: scheduler.schedule,
      tailEveryMs: 1_000,
      keepaliveMs: 2_000,
      tail: () => ({ frames: [], complete: true }),
    });
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await scheduler.tick();
    await scheduler.tick();
    const chunk = await readText(reader);
    assert.match(chunk, /: keepalive/u);
    await reader.cancel();
  });

  test("a failing pull does not end the stream, and does not advance the cursor", async () => {
    const scheduler = manualScheduler();
    let calls = 0;
    const cursors: (number | null)[] = [];
    const response = streamResponse({
      requestId: "req-1",
      channels: [ORDER],
      lastEventId: null,
      replays: [{ frames: [], complete: true }],
      schedule: scheduler.schedule,
      tail: (_channel, cursor) => {
        calls += 1;
        cursors.push(cursor);
        if (calls === 1) throw new Error("coordinator unavailable");
        return { frames: [frame(2)], complete: true };
      },
    });
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await scheduler.tick();
    await scheduler.tick();
    const chunk = await readText(reader);
    assert.match(chunk, /id: 2/u);
    assert.deepEqual(cursors, [null, null]);
    await reader.cancel();
  });

  test("a stream with no tail is the replay-and-keepalive stream it always was", async () => {
    const scheduler = manualScheduler();
    const response = streamResponse({
      requestId: "req-1",
      channels: [ORDER],
      lastEventId: null,
      replays: [{ frames: [], complete: true }],
      schedule: scheduler.schedule,
    });
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await scheduler.tick();
    assert.match(await readText(reader), /: keepalive/u);
    await reader.cancel();
    assert.equal(scheduler.live(), 0, "the interval is released");
  });

  test("the default tail interval is a second", () => {
    assert.equal(TAIL_INTERVAL_MS, 1_000);
    assert.equal(parseChannels("order:UND-7K2M9QX4").length, 1);
  });
});
