/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The event stream's wire format and its replay window.
 *
 * Both halves of this are assertions about a client the server cannot see. A frame is either exactly
 * what the SSE grammar says or it arrives as a blank event; a resume is either complete or it must say
 * it is not. There is no middle state where the client is told something subtly wrong.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  KEEPALIVE_INTERVAL_MS,
  encodeFrame,
  formatComment,
  formatFrame,
  formatKeepalive,
  parseLastEventId,
  streamHeaders,
  validateFrame,
} from "../src/sse/frame.ts";
import { EVENT_RING_SIZE, EVENT_RING_WINDOW_MS, EventRing } from "../src/sse/ring.ts";
import { MAX_CHANNELS, channelKey, parseChannels } from "../src/sse/channels.ts";

describe("sse frame", () => {
  test("a frame is an id, an event name and one line of JSON", () => {
    const text = formatFrame({ id: 42, event: "order.assigned", data: { code: "UND-7K2M9QX4" } });
    assert.equal(text, 'id: 42\nevent: order.assigned\ndata: {"code":"UND-7K2M9QX4"}\n\n');
  });

  test("the payload never contains a raw newline, even when the data does", () => {
    const text = formatFrame({ id: 1, event: "system.degraded", data: { note: "line one\nline two" } });
    assert.equal(text.split("\n").filter((line) => line.startsWith("data:")).length, 1);
    assert.match(text, /line one\\nline two/u);
  });

  test("the frame ends with the blank line that completes it", () => {
    assert.equal(formatFrame({ id: 7, event: "rider.online", data: null }).endsWith("\n\n"), true);
  });

  test("an id must be a positive integer", () => {
    assert.throws(() => formatFrame({ id: 0, event: "rider.online", data: {} }), RangeError);
    assert.throws(() => formatFrame({ id: 1.5, event: "rider.online", data: {} }), RangeError);
    assert.throws(() => validateFrame({ id: -3, event: "rider.online", data: {} }), RangeError);
  });

  test("an event name a strict client would drop is refused instead", () => {
    assert.throws(() => formatFrame({ id: 1, event: "Order.Assigned", data: {} }), RangeError);
    assert.throws(() => formatFrame({ id: 1, event: "order assigned", data: {} }), RangeError);
    assert.throws(() => formatFrame({ id: 1, event: "", data: {} }), RangeError);
  });

  test("every name in the catalogue's shape is accepted", () => {
    for (const name of ["order.placed", "offer.claimed_by_other", "system.degraded", "admin.metric_tick"]) {
      assert.doesNotThrow(() => validateFrame({ id: 1, event: name, data: {} }));
    }
  });

  test("a payload with nothing to send is refused rather than sent empty", () => {
    assert.throws(() => formatFrame({ id: 1, event: "rider.online", data: undefined }), RangeError);
  });

  test("the keepalive is a comment and carries no id", () => {
    assert.equal(formatKeepalive(), ": keepalive\n\n");
    assert.equal(formatKeepalive().includes("id:"), false);
  });

  test("a comment cannot inject a field of its own", () => {
    assert.equal(formatComment("id: 1\n\nevent: forged"), ": id: 1 event: forged\n\n");
  });

  test("the keepalive interval is the twenty seconds the contract names", () => {
    assert.equal(KEEPALIVE_INTERVAL_MS, 20_000);
    assert.equal(KEEPALIVE_INTERVAL_MS < 30_000, true);
  });

  test("a frame is UTF-8 on the wire", () => {
    const bytes = encodeFrame(formatFrame({ id: 1, event: "order.placed", data: { name: "রহমান" } }));
    assert.equal(new TextDecoder().decode(bytes).includes("রহমান"), true);
  });
});

describe("last-event-id", () => {
  test("the header is the cursor", () => {
    assert.equal(parseLastEventId("4821"), 4_821);
    assert.equal(parseLastEventId("0"), 0);
  });

  test("no header means start from now, which is not zero", () => {
    assert.equal(parseLastEventId(null), null);
    assert.equal(parseLastEventId(""), null);
  });

  test("the query parameter is the fallback for clients that cannot set headers", () => {
    assert.equal(parseLastEventId(null, "4821"), 4_821);
    assert.equal(parseLastEventId("4821", "99"), 4_821);
  });

  test("a cursor that is not an integer is refused, not coerced", () => {
    assert.throws(() => parseLastEventId("abc"), RangeError);
    assert.throws(() => parseLastEventId("-1"), RangeError);
    assert.throws(() => parseLastEventId("1.5"), RangeError);
    assert.throws(() => parseLastEventId("99999999999999999999"), RangeError);
  });

  test("the stream headers stop a proxy from buffering or caching it", () => {
    const headers = streamHeaders("req-1");
    assert.equal(headers["content-type"], "text/event-stream; charset=utf-8");
    assert.equal(headers["cache-control"], "no-store, no-transform");
    assert.equal(headers["x-accel-buffering"], "no");
    assert.equal(headers["X-Undal-Request-Id"], "req-1");
  });
});

describe("event ring", () => {
  test("a resume returns only what came after the cursor", () => {
    const ring = new EventRing();
    for (let id = 1; id <= 5; id += 1) ring.push({ id, event: "order.placed", data: { id }, atMs: 1_000 + id });
    const resume = ring.since(2, 1_010);
    assert.deepEqual(resume.events.map((event) => event.id), [3, 4, 5]);
    assert.equal(resume.complete, true);
  });

  test("a cursor at the head resumes nothing, and that is complete", () => {
    const ring = new EventRing();
    ring.push({ id: 1, event: "order.placed", data: {}, atMs: 1_000 });
    const resume = ring.since(1, 1_000);
    assert.equal(resume.events.length, 0);
    assert.equal(resume.complete, true);
  });

  test("an empty ring answers a fresh cursor completely", () => {
    const resume = new EventRing().since(0, 1_000);
    assert.equal(resume.events.length, 0);
    assert.equal(resume.complete, true);
  });

  test("a cursor beyond the ring's oldest event is incomplete", () => {
    const ring = new EventRing(3, EVENT_RING_WINDOW_MS);
    for (let id = 1; id <= 6; id += 1) ring.push({ id, event: "order.placed", data: {}, atMs: 1_000 + id });
    const resume = ring.since(0, 1_006);
    assert.deepEqual(resume.events.map((event) => event.id), [4, 5, 6]);
    assert.equal(resume.complete, false);
  });

  test("a cursor inside the ring is complete even after eviction", () => {
    const ring = new EventRing(3, EVENT_RING_WINDOW_MS);
    for (let id = 1; id <= 6; id += 1) ring.push({ id, event: "order.placed", data: {}, atMs: 1_000 + id });
    const resume = ring.since(4, 1_006);
    assert.deepEqual(resume.events.map((event) => event.id), [5, 6]);
    assert.equal(resume.complete, true);
  });

  test("events age out of the five-minute window", () => {
    const ring = new EventRing();
    ring.push({ id: 1, event: "order.placed", data: {}, atMs: 0 });
    ring.push({ id: 2, event: "order.accepted", data: {}, atMs: EVENT_RING_WINDOW_MS + 1 });
    assert.equal(ring.length(), 1);
    assert.equal(ring.since(0, EVENT_RING_WINDOW_MS + 1).complete, false);
  });

  test("the ring holds its documented size and no more", () => {
    const ring = new EventRing();
    for (let id = 1; id <= EVENT_RING_SIZE + 25; id += 1) ring.push({ id, event: "order.placed", data: {}, atMs: id });
    assert.equal(ring.length(), EVENT_RING_SIZE);
    assert.equal(ring.lastId(), EVENT_RING_SIZE + 25);
    assert.equal(EVENT_RING_SIZE, 200);
    assert.equal(EVENT_RING_WINDOW_MS, 300_000);
  });

  test("an event older than what the ring holds is refused rather than silently dropped", () => {
    const ring = new EventRing(2);
    ring.push({ id: 1, event: "order.placed", data: {}, atMs: 0 });
    ring.push({ id: 2, event: "order.placed", data: {}, atMs: 1 });
    ring.push({ id: 3, event: "order.placed", data: {}, atMs: 2 });
    assert.throws(() => ring.push({ id: 1, event: "order.placed", data: {}, atMs: 3 }), RangeError);
  });

  test("a duplicate id replaces the earlier copy instead of being counted twice", () => {
    const ring = new EventRing();
    ring.push({ id: 1, event: "order.placed", data: { v: 1 }, atMs: 0 });
    ring.push({ id: 1, event: "order.placed", data: { v: 2 }, atMs: 1 });
    assert.equal(ring.length(), 1);
    assert.deepEqual(ring.since(0, 1).events[0]?.data, { v: 2 });
  });

  test("a cursor that is not a non-negative integer is refused", () => {
    assert.throws(() => new EventRing().since(-1, 0), RangeError);
    assert.throws(() => new EventRing().since(1.5, 0), RangeError);
  });

  test("a ring with no size or no window is not a ring", () => {
    assert.throws(() => new EventRing(0), RangeError);
    assert.throws(() => new EventRing(4, 0), RangeError);
  });
});

describe("channels", () => {
  test("the documented query parses", () => {
    const channels = parseChannels("order:UND-7K2M9QX4,rider:self");
    assert.deepEqual(channels, [
      { kind: "order", id: "UND-7K2M9QX4" },
      { kind: "rider", id: "self" },
    ]);
    assert.equal(channelKey(channels[1] as { kind: "rider"; id: string }), "rider:self");
  });

  test("whitespace around a channel is tolerated", () => {
    assert.equal(parseChannels(" order:A , vendor:B ").length, 2);
  });

  test("a stream with no channels is refused", () => {
    assert.throws(() => parseChannels(null), RangeError);
    assert.throws(() => parseChannels(""), RangeError);
    assert.throws(() => parseChannels(" , "), RangeError);
  });

  test("an unknown kind is refused", () => {
    assert.throws(() => parseChannels("orders:A"), RangeError);
    assert.throws(() => parseChannels("ORDER:A"), RangeError);
  });

  test("a channel without an id, or an id without a kind, is refused", () => {
    assert.throws(() => parseChannels("order:"), RangeError);
    assert.throws(() => parseChannels(":A"), RangeError);
    assert.throws(() => parseChannels("order"), RangeError);
  });

  test("an id with characters the query grammar cannot carry is refused", () => {
    assert.throws(() => parseChannels("order:A B"), RangeError);
    assert.throws(() => parseChannels("order:A/B"), RangeError);
    assert.throws(() => parseChannels(`order:${"x".repeat(65)}`), RangeError);
  });

  test("self is only addressable for an actor's own streams", () => {
    assert.doesNotThrow(() => parseChannels("rider:self"));
    assert.doesNotThrow(() => parseChannels("vendor:self"));
    assert.throws(() => parseChannels("order:self"), RangeError);
    assert.throws(() => parseChannels("zone:self"), RangeError);
  });

  test("a duplicate channel is refused, because two subscriptions to one room is one bug", () => {
    assert.throws(() => parseChannels("order:A,order:A"), RangeError);
  });

  test("the channel cap is eight", () => {
    const eight = Array.from({ length: MAX_CHANNELS }, (_, index) => `order:O${String(index)}`).join(",");
    assert.equal(parseChannels(eight).length, MAX_CHANNELS);
    assert.throws(() => parseChannels(`${eight},order:O8`), RangeError);
  });
});
