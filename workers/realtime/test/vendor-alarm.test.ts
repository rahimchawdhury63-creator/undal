/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `VendorAlarm`: the ladder that outlives the process that published it.
 *
 * The tests walk the two minutes the way the alarm does — 0, 8, 10, 25, 45, 60, 90, 120 — and the ones that
 * matter most are the ones where nothing is due, because a ladder that rings twice for one order is worse
 * than one that rings late. The durability test builds a second room over the first room's storage, which
 * is what a cold start looks like.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ALARM_KEY, VendorAlarm, nextDueAt, eventFor } from "../src/hubs/vendor-alarm.ts";
import type { AlarmRecord, OrderCanceller } from "../src/hubs/vendor-alarm.ts";
import type { DispatchRecorder, ReportedDispatch } from "../src/authority/core-dispatch.ts";
import type { FcmMessage } from "../src/fcm/payload.ts";
import type { SendOutcome } from "../src/fcm/sender.ts";
import { MemoryFrameStore } from "../src/sse/store.ts";
import { StreamHub } from "../src/sse/hub.ts";
import { FixedClock } from "../src/lib/clock.ts";
import { fakeState } from "./support/fakes.ts";

const T0 = 1_700_000_000_000;
const ORDER = "UND-7K2M9QX4";
const KEY = "sig-key";

/** A sender that answers with a message id and records every payload it was given. */
function sender(): { send(message: FcmMessage): Promise<SendOutcome>; readonly sent: FcmMessage[] } {
  const sent: FcmMessage[] = [];
  return {
    sent,
    async send(message: FcmMessage): Promise<SendOutcome> {
      sent.push(message);
      return { ok: true, messageId: `projects/p/messages/${sent.length}` };
    },
  };
}

/** A canceller that answers with a scripted verdict. */
function canceller(answer: { cancelled: boolean; reason: string } = { cancelled: true, reason: "cancelled" }): OrderCanceller & {
  readonly calls: { orderCode: string; elapsedSeconds: number }[];
} {
  const calls: { orderCode: string; elapsedSeconds: number }[] = [];
  return {
    calls,
    async cancel(input: { orderCode: string; elapsedSeconds: number }) {
      calls.push(input);
      return answer;
    },
  };
}

/** The push fields a caller supplies once; the room numbers the attempts. */
const PUSH = {
  type: "ORDER_NEW" as const,
  severity: "CRITICAL" as const,
  orderId: ORDER,
  orderCode: "7K2M9QX4",
  vendorId: "vendor-1",
  issuedAtMs: T0,
  expiresAtMs: T0 + 120_000,
  itemCount: 3,
  totalPaisa: 54_900,
  customerArea: "Shibganj",
  alarm: "loop" as const,
  alarmMaxMs: 120_000,
};

/** A delivery log that remembers what it was told. */
function dispatchLog(fail = false): DispatchRecorder & { readonly batches: (readonly ReportedDispatch[])[] } {
  const batches: (readonly ReportedDispatch[])[] = [];
  return {
    batches,
    async record(dispatches: readonly ReportedDispatch[]): Promise<boolean> {
      batches.push(dispatches);
      return !fail;
    },
  };
}

/** A room over fresh storage, with a fixed clock and every port wired. */
function room(
  options: {
    clock?: FixedClock;
    push?: ReturnType<typeof sender> | null;
    cancel?: OrderCanceller | null;
    state?: DurableObjectState;
    dispatchLog?: DispatchRecorder | null;
  } = {},
): {
  alarm: VendorAlarm;
  clock: FixedClock;
  state: DurableObjectState;
  sent: FcmMessage[];
  store: MemoryFrameStore;
} {
  const clock = options.clock ?? new FixedClock(T0);
  const state = options.state ?? fakeState();
  const push = options.push === undefined ? sender() : options.push;
  const store = new MemoryFrameStore(new StreamHub());
  const alarm = new VendorAlarm(state, {}, {
    clock,
    push,
    signingKey: KEY,
    store,
    cancel: options.cancel === undefined ? canceller() : options.cancel,
    dispatchLog: options.dispatchLog === undefined ? dispatchLog() : options.dispatchLog,
  });
  return { alarm, clock, state, sent: push === null ? [] : push.sent, store };
}

/** Begin a ladder for the standard order. */
async function begin(alarm: VendorAlarm, devices: readonly string[] = ["phone-1"]): Promise<Response> {
  return alarm.fetch(
    new Request("https://ladder.internal/begin", {
      method: "POST",
      body: JSON.stringify({ orderCode: ORDER, zoneId: "sylhet", push: PUSH, devices, publishedAtMs: T0 }),
    }),
  );
}

/** The stored record. */
async function recordOf(state: DurableObjectState): Promise<AlarmRecord | null> {
  return (await state.storage.get<AlarmRecord>(ALARM_KEY)) ?? null;
}

describe("beginning a ladder", () => {
  test("rings the first alarm and arms the probe eight seconds out", async () => {
    const { alarm, state, sent } = room();
    const response = await begin(alarm);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { nextAlarmAtMs: number; pushes: { attempt: number; outcome: string }[] };
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.data["attempt"], "1");
    assert.equal(body.pushes[0]?.outcome, "SENT");
    assert.equal(body.nextAlarmAtMs, T0 + 8_000);
    assert.equal((state.storage as unknown as { alarmAtMs: number | null }).alarmAtMs, T0 + 8_000);
  });

  test("rings every device of the vendor, with the same payload", async () => {
    const { alarm, sent } = room();
    await begin(alarm, ["phone-1", "tablet-1"]);
    assert.deepEqual(sent.map((message) => message.token), ["phone-1", "tablet-1"]);
    assert.equal(sent[0]?.data["sig"], sent[1]?.data["sig"]);
  });

  test("every send is reported to the delivery log, per device", async () => {
    const log = dispatchLog();
    const { alarm } = room({ dispatchLog: log });
    await begin(alarm, ["phone-1", "tablet-1"]);
    assert.equal(log.batches.length, 1);
    assert.deepEqual(
      log.batches[0]?.map((entry) => entry.token),
      ["phone-1", "tablet-1"],
    );
    assert.equal(log.batches[0]?.[0]?.attempt, 1);
    assert.equal(log.batches[0]?.[0]?.outcome, "SENT");
    assert.equal(log.batches[0]?.[0]?.orderCode, ORDER);
    assert.equal(typeof log.batches[0]?.[0]?.sentAtMs, "number");
  });

  test("a delivery log that refuses the batch does not fail the alarm", async () => {
    const { alarm, sent } = room({ dispatchLog: dispatchLog(true) });
    const response = await begin(alarm);
    assert.equal(response.status, 200);
    assert.equal(sent.length, 1);
  });

  test("a room with no delivery log still rings", async () => {
    const { alarm, sent } = room({ dispatchLog: null });
    const response = await begin(alarm);
    assert.equal(response.status, 200);
    assert.equal(sent.length, 1);
  });

  test("a room with no sender refuses to keep a ladder it cannot ring", async () => {
    const { alarm } = room({ push: null });
    const response = await begin(alarm);
    assert.equal(response.status, 501);
    const body = (await response.json()) as { error: { reason: string } };
    assert.equal(body.error.reason, "push_not_configured");
  });

  test("a body with no order is refused", async () => {
    const { alarm } = room();
    const response = await alarm.fetch(new Request("https://ladder.internal/begin", { method: "POST", body: "{}" }));
    assert.equal(response.status, 422);
  });
});

describe("the ladder as it walks", () => {
  test("nothing is due at seven seconds", async () => {
    const { alarm, clock } = room();
    await begin(alarm);
    clock.set(T0 + 7_000);
    const run = await alarm.run();
    assert.deepEqual(run.fired, []);
    assert.equal(run.nextAlarmAtMs, T0 + 8_000);
  });

  test("eight seconds sends the probe and re-arms for ten", async () => {
    const { alarm, clock, sent } = room();
    await begin(alarm);
    clock.set(T0 + 8_000);
    const run = await alarm.run();
    assert.deepEqual(run.fired, ["PROBE"]);
    assert.equal(sent.length, 1, "a probe is a socket message, not a push");
    assert.equal(run.nextAlarmAtMs, T0 + 10_000);
  });

  test("ten seconds marks the vendor unreachable and rings again", async () => {
    const { alarm, clock, sent, store } = room();
    await begin(alarm);
    clock.set(T0 + 10_000);
    const run = await alarm.run();
    // A late alarm owes the probe as well: the rung is the schedule's, not the wake-up's.
    assert.deepEqual(run.fired, ["PROBE", "MARK_UNREACHABLE", "FCM_SECOND"]);
    assert.equal(sent.length, 2);
    assert.equal(sent[1]?.data["attempt"], "2");
    const replay = await store.replay({ kind: "order", id: ORDER }, 0, T0 + 10_000);
    assert.deepEqual(replay.frames.map((frame) => frame.event), ["vendor.unreachable"]);
  });

  test("the second FCM is collapsed onto the same order, not stacked", async () => {
    const { alarm, clock, sent } = room();
    await begin(alarm);
    clock.set(T0 + 10_000);
    await alarm.run();
    assert.equal(sent[1]?.android.collapse_key, "order_UND-7K2M9QX4");
  });

  test("the whole two minutes lands in order, each rung once", async () => {
    const { alarm, clock } = room();
    await begin(alarm);
    const fired: string[] = [];
    for (const at of [8_000, 10_000, 25_000, 45_000, 60_000, 90_000, 120_000]) {
      clock.set(T0 + at);
      fired.push(...(await alarm.run()).fired);
    }
    assert.deepEqual(fired, [
      "PROBE",
      "MARK_UNREACHABLE",
      "FCM_SECOND",
      "FCM_THIRD",
      "ALERT_BACKUP",
      "RAISE_EXCEPTION",
      "OFFER_EARLY_OUT",
      "AUTO_CANCEL",
    ]);
  });

  test("a late alarm fires everything it owes, once, and then stops", async () => {
    const { alarm, clock } = room();
    await begin(alarm);
    clock.set(T0 + 120_000);
    const run = await alarm.run();
    assert.equal(run.fired.length, 8);
    assert.equal(run.nextAlarmAtMs, null);
    const again = await alarm.run();
    assert.deepEqual(again.fired, []);
    assert.equal((room({ state: { storage: { get: async () => null } } as never }).alarm, undefined), undefined);
  });

  test("a vendor who says seen at eleven seconds keeps the order, and nothing else ever fires", async () => {
    const { alarm, clock } = room();
    await begin(alarm);
    clock.set(T0 + 11_000);
    const seen = await alarm.fetch(
      new Request("https://ladder.internal/seen", { method: "POST", body: JSON.stringify({ orderCode: ORDER, atMs: T0 + 11_000 }) }),
    );
    const body = (await seen.json()) as { nextAlarmAtMs: number | null };
    assert.equal(body.nextAlarmAtMs, null);
    clock.set(T0 + 120_000);
    assert.deepEqual((await alarm.run()).fired, []);
  });

  test("a probe reply inside the window stops the ladder", async () => {
    const { alarm, clock } = room();
    await begin(alarm);
    clock.set(T0 + 8_500);
    await alarm.run();
    const reply = await alarm.fetch(
      new Request("https://ladder.internal/reply", { method: "POST", body: JSON.stringify({ atMs: T0 + 9_000 }) }),
    );
    assert.equal(reply.status, 200);
    clock.set(T0 + 120_000);
    assert.deepEqual((await alarm.run()).fired, []);
  });
});

describe("the last rung", () => {
  test("asks core to cancel, with the elapsed time, and records the answer", async () => {
    const cancel = canceller();
    const { alarm, clock, state } = room({ cancel });
    await begin(alarm);
    clock.set(T0 + 120_000);
    await alarm.run();
    assert.deepEqual(cancel.calls, [{ orderCode: ORDER, elapsedSeconds: 120 }]);
    const record = await recordOf(state);
    assert.deepEqual(record?.cancellation, { atMs: T0 + 120_000, cancelled: true, reason: "cancelled" });
  });

  test("the room does not publish the cancellation itself — core owns that transition", async () => {
    const { alarm, clock, store } = room();
    await begin(alarm);
    clock.set(T0 + 120_000);
    await alarm.run();
    const order = await store.replay({ kind: "order", id: ORDER }, 0, T0 + 120_000);
    // The ladder's own events are here; `order.cancelled` is not, because core broadcasts the transition it
    // wrote (D85) and two frames for one event is a stream that stutters.
    assert.deepEqual(order.frames.map((frame) => frame.event), ["vendor.unreachable", "admin.exception_raised"]);
  });

  test("a vendor who accepted in the meantime is not cancelled, and the refusal is recorded", async () => {
    const cancel = canceller({ cancelled: false, reason: "not_cancellable" });
    const { alarm, clock, state } = room({ cancel });
    await begin(alarm);
    clock.set(T0 + 120_000);
    await alarm.run();
    const record = await recordOf(state);
    assert.equal(record?.cancellation?.cancelled, false);
    assert.equal(record?.cancellation?.reason, "not_cancellable");
  });

  test("a deployment with no canceller records that, and raises the exception", async () => {
    const { alarm, clock, state, store } = room({ cancel: null });
    await begin(alarm);
    clock.set(T0 + 120_000);
    await alarm.run();
    const record = await recordOf(state);
    assert.equal(record?.cancellation?.reason, "canceller_not_configured");
    const order = await store.replay({ kind: "order", id: ORDER }, 0, T0 + 120_000);
    const raised = order.frames.filter((frame) => frame.event === "admin.exception_raised");
    assert.equal(raised.length >= 2, true, "RAISE_EXCEPTION at 60 s and the failed cancel at 120 s");
  });

  test("a canceller that throws is recorded, not swallowed", async () => {
    const broken: OrderCanceller = {
      async cancel(): Promise<{ cancelled: boolean; reason: string }> {
        throw new Error("core timed out");
      },
    };
    const { alarm, clock, state } = room({ cancel: broken });
    await begin(alarm);
    clock.set(T0 + 120_000);
    await alarm.run();
    assert.equal((await recordOf(state))?.cancellation?.reason, "core timed out");
  });
});

describe("durability", () => {
  test("a room rebuilt over the same storage resumes where the ladder was", async () => {
    const clock = new FixedClock(T0);
    const state = fakeState();
    const first = room({ clock, state });
    await begin(first.alarm);
    clock.set(T0 + 10_000);
    await first.alarm.run();

    // A cold start: a new room object over the same storage, which is what the runtime does.
    const second = room({ clock, state });
    const stored = await recordOf(state);
    // PUBLISH, PROBE, MARK_UNREACHABLE and FCM_SECOND — the four rungs that have happened by ten seconds.
    assert.equal(stored?.ladder.fired.length, 4);
    assert.equal(nextDueAt(stored!.ladder), T0 + 25_000);
    clock.set(T0 + 25_000);
    const run = await second.alarm.run();
    assert.deepEqual(run.fired, ["FCM_THIRD"]);
  });

  test("a room with no record answers 404 on state and does nothing on an alarm", async () => {
    const { alarm } = room();
    assert.equal((await alarm.fetch(new Request("https://ladder.internal/state"))).status, 404);
    assert.deepEqual((await alarm.run()).fired, []);
  });
});

describe("the schedule's helpers", () => {
  test("only two rungs have a catalogue event, because the catalogue is closed", () => {
    assert.equal(eventFor("MARK_UNREACHABLE"), "vendor.unreachable");
    assert.equal(eventFor("RAISE_EXCEPTION"), "admin.exception_raised");
    assert.equal(eventFor("PROBE"), null);
    assert.equal(eventFor("FCM_SECOND"), null);
    assert.equal(eventFor("AUTO_CANCEL"), null);
  });
});
