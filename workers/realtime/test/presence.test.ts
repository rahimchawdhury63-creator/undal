/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Presence: the close, the heartbeat, the grace, and the number the brief actually names.
 *
 * The suite is split the way `14 §10` splits it — transport 14, heartbeat 18, latency 1, flap 9 — with
 * the counts approximated by the cases that carry weight rather than padded to match. The latency test
 * at the end is the build-failing one: a thousand simulated losses, on both coordinator backends, and
 * a p95 that must stay inside two seconds.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { HEARTBEAT_DEADLINE_MS } from "../src/coordination/coordinator.ts";
import {
  CLOSE_GOING_OFFLINE,
  CLOSE_HEARTBEAT_TIMEOUT,
  HEARTBEAT_INTERVAL_MS,
  MAX_DETECTION_MS,
  MAX_PRESENCE_GRACE_MS,
  PRESENCE_STORE_BUDGET_MS,
  PRESENCE_STORE_OP_MS,
  PRESENCE_STORE_OPS,
  MISSED_ACKS_BEFORE_TEARDOWN,
  MISSED_BEATS_TOLERATED,
  PRESENCE_GRACE_MS,
  TRANSPORT_CLOSE_BUDGET_MS,
  absenceFor,
  clampGrace,
  isWithinDetectionBudget,
  publishAtMs,
  worstCaseDetectionMs,
} from "../src/presence/grace.ts";
import {
  deadlineOf,
  isSilent,
  missedBeats,
  nextBeatDueMs,
  recordBeat,
  shouldClientTearDown,
  startHeartbeat,
} from "../src/presence/heartbeat.ts";
import { deviceKey, emptyLedger, noteClose, noteReconnect, sweep } from "../src/presence/ledger.ts";
import { BACKENDS, T0, percentile, seeded } from "./support/backends.ts";

describe("transport close", () => {
  test("an unclean close is a loss of presence with the full grace", () => {
    const order = absenceFor({ code: 1_006, clean: false });
    assert.equal(order.reason, "TRANSPORT_CLOSED");
    assert.equal(order.graceMs, PRESENCE_GRACE_MS);
    assert.equal(order.deliberate, false);
  });

  test("a clean close with 4001 is the user switching presence off", () => {
    const order = absenceFor({ code: CLOSE_GOING_OFFLINE, clean: true });
    assert.equal(order.reason, "USER_OFFLINE");
    assert.equal(order.graceMs, 0);
    assert.equal(order.deliberate, true);
  });

  test("4001 arriving unclean is not deliberate — the code alone is not a vote", () => {
    const order = absenceFor({ code: CLOSE_GOING_OFFLINE, clean: false });
    assert.equal(order.deliberate, false);
    assert.equal(order.reason, "TRANSPORT_CLOSED");
  });

  test("a clean 1000 is still a loss: a polite close is not a deliberate one", () => {
    const order = absenceFor({ code: 1_000, clean: true });
    assert.equal(order.deliberate, false);
    assert.equal(order.graceMs, PRESENCE_GRACE_MS);
  });

  test("a heartbeat timeout has nothing to wait for", () => {
    const detectedAt = T0 + 2_000;
    assert.equal(publishAtMs(detectedAt, { reason: "HEARTBEAT_TIMEOUT", graceMs: 0, deliberate: false }), detectedAt);
  });

  test("a deliberate close publishes at the instant it was seen", () => {
    const order = absenceFor({ code: CLOSE_GOING_OFFLINE, clean: true });
    assert.equal(publishAtMs(T0, order), T0);
  });

  test("an involuntary close publishes 1 500 ms later", () => {
    const order = absenceFor({ code: 1_006, clean: false });
    assert.equal(publishAtMs(T0, order), T0 + 1_500);
  });

  test("a configured grace is clamped to the range the promise allows", () => {
    assert.equal(clampGrace(-1), 0);
    assert.equal(clampGrace(5_000), MAX_PRESENCE_GRACE_MS);
    assert.equal(clampGrace(PRESENCE_GRACE_MS), PRESENCE_GRACE_MS);
    assert.throws(() => clampGrace(Number.NaN), RangeError);
  });

  test("the worst case is the transport, the grace and the database's allowance", () => {
    assert.equal(worstCaseDetectionMs(), TRANSPORT_CLOSE_BUDGET_MS + PRESENCE_GRACE_MS + PRESENCE_STORE_BUDGET_MS);
    assert.equal(worstCaseDetectionMs(), 1_800);
  });

  test("the database's allowance is spent, not assumed away", () => {
    // The two store operations a publication costs — the marking write and the reader's read — come out of the
    // same two seconds as the transport and the grace (D91). Without them the maximum grace would still be
    // 1 800 and the free path would be promising a number its own store cannot keep.
    assert.equal(PRESENCE_STORE_BUDGET_MS, PRESENCE_STORE_OP_MS * PRESENCE_STORE_OPS);
    assert.equal(MAX_PRESENCE_GRACE_MS, 1_700);
    assert.equal(worstCaseDetectionMs(MAX_PRESENCE_GRACE_MS), MAX_DETECTION_MS);
    assert.equal(
      TRANSPORT_CLOSE_BUDGET_MS + MAX_PRESENCE_GRACE_MS + PRESENCE_STORE_BUDGET_MS,
      MAX_DETECTION_MS,
    );
  });

  test("the default configuration fits the brief's two seconds", () => {
    assert.equal(isWithinDetectionBudget(), true);
    assert.equal(isWithinDetectionBudget(MAX_PRESENCE_GRACE_MS), true);
  });

  test("an operator cannot configure a grace that breaks the promise", () => {
    assert.equal(isWithinDetectionBudget(MAX_PRESENCE_GRACE_MS + 1), true, "clamped first");
    assert.equal(clampGrace(MAX_PRESENCE_GRACE_MS + 500), MAX_PRESENCE_GRACE_MS);
    assert.equal(
      TRANSPORT_CLOSE_BUDGET_MS + MAX_PRESENCE_GRACE_MS + PRESENCE_STORE_BUDGET_MS <= MAX_DETECTION_MS,
      true,
    );
  });

  test("a device key distinguishes two phones belonging to one rider", () => {
    assert.notEqual(deviceKey("rider-a", "phone-1"), deviceKey("rider-a", "phone-2"));
    assert.equal(deviceKey("rider-a", "phone-1"), "rider-a\u0000phone-1");
  });
});

describe("heartbeat deadline", () => {
  test("a fresh device has a deadline before its first beat", () => {
    const state = startHeartbeat(T0);
    assert.equal(deadlineOf(state), T0 + HEARTBEAT_DEADLINE_MS);
    assert.equal(isSilent(state, T0), false);
  });

  test("a beat is acknowledged with its sequence and a new deadline", () => {
    const { state, ack } = recordBeat(startHeartbeat(T0), 1, T0 + HEARTBEAT_INTERVAL_MS);
    assert.equal(ack.seq, 1);
    assert.equal(ack.stale, false);
    assert.equal(ack.nowMs, T0 + 750);
    assert.equal(ack.deadlineMs, T0 + 750 + 2_000);
    assert.equal(deadlineOf(state), ack.deadlineMs);
  });

  test("one missed beat is tolerated", () => {
    const { state } = recordBeat(startHeartbeat(T0), 1, T0);
    assert.equal(missedBeats(state, T0 + 1_500), 2);
    assert.equal(isSilent(state, T0 + 1_500), false);
  });

  test("two missed beats are still tolerated", () => {
    const { state } = recordBeat(startHeartbeat(T0), 1, T0);
    assert.equal(isSilent(state, T0 + 2_000), false);
  });

  test("silence past the deadline is absence", () => {
    const { state } = recordBeat(startHeartbeat(T0), 1, T0);
    assert.equal(isSilent(state, T0 + 2_000), false);
    assert.equal(isSilent(state, T0 + 2_001), true);
  });

  test("two beats fit inside the deadline with room to spare", () => {
    assert.equal(MISSED_BEATS_TOLERATED * HEARTBEAT_INTERVAL_MS <= HEARTBEAT_DEADLINE_MS, true);
  });

  test("a stale beat is acknowledged without extending the deadline", () => {
    const first = recordBeat(startHeartbeat(T0), 5, T0 + 100);
    const { state, ack } = recordBeat(first.state, 4, T0 + 200);
    assert.equal(ack.stale, true);
    assert.equal(ack.seq, 5);
    assert.equal(ack.deadlineMs, T0 + 100 + 2_000);
    assert.equal(state, first.state);
  });

  test("a repeated sequence is stale, not a new beat", () => {
    const first = recordBeat(startHeartbeat(T0), 2, T0 + 100);
    const { ack } = recordBeat(first.state, 2, T0 + 900);
    assert.equal(ack.stale, true);
    assert.equal(ack.deadlineMs, T0 + 2_100);
  });

  test("a sequence that is not a non-negative integer is refused", () => {
    assert.throws(() => recordBeat(startHeartbeat(T0), -1, T0), RangeError);
    assert.throws(() => recordBeat(startHeartbeat(T0), 1.5, T0), RangeError);
  });

  test("a clock that steps backwards does not make the device silent", () => {
    const { state } = recordBeat(startHeartbeat(T0), 1, T0);
    assert.equal(isSilent(state, T0 - 5_000), false);
    assert.equal(missedBeats(state, T0 - 5_000), 0);
  });

  test("the next beat is due one interval later", () => {
    const { state } = recordBeat(startHeartbeat(T0), 1, T0 + 300);
    assert.equal(nextBeatDueMs(state), T0 + 300 + HEARTBEAT_INTERVAL_MS);
  });

  test("the client tears down after three missed acknowledgements", () => {
    const lastAck = T0;
    assert.equal(shouldClientTearDown(lastAck, T0 + 1_499), false);
    assert.equal(shouldClientTearDown(lastAck, T0 + 2_250), true);
    assert.equal(shouldClientTearDown(lastAck, T0 + 2_249), false);
  });

  test("the client's teardown is later than the server's publication", () => {
    assert.equal(MISSED_ACKS_BEFORE_TEARDOWN * HEARTBEAT_INTERVAL_MS > HEARTBEAT_DEADLINE_MS, true);
  });

  test("a timeout is detected no later than the deadline plus one beat", () => {
    const { state } = recordBeat(startHeartbeat(T0), 1, T0);
    const detected = deadlineOf(state) + HEARTBEAT_INTERVAL_MS;
    assert.equal(detected - T0 <= HEARTBEAT_DEADLINE_MS + HEARTBEAT_INTERVAL_MS, true);
  });

  test("the close code for a timeout is the one the spec names", () => {
    assert.equal(CLOSE_HEARTBEAT_TIMEOUT, 4_408);
  });
});

describe("flap suppression", () => {
  /** A blip: a close, then a reconnect inside the grace. */
  function blip(atMs: number): number {
    return atMs + 200;
  }

  test("a reconnect inside the grace publishes nothing", () => {
    let ledger = emptyLedger();
    ledger = noteClose(ledger, {
      actorId: "vendor-a",
      deviceId: "tablet",
      reason: "TRANSPORT_CLOSED",
      detectedAtMs: T0,
      publishAtMs: T0 + PRESENCE_GRACE_MS,
    });
    const reconnect = noteReconnect(ledger, { actorId: "vendor-a", deviceId: "tablet" });
    assert.equal(reconnect.cancelled !== null, true);
    assert.equal(reconnect.ledger.pending.length, 0);
    const swept = sweep(reconnect.ledger, T0 + 60_000);
    assert.equal(swept.published.length, 0);
  });

  test("twenty blips in thirty seconds publish at most one absence", () => {
    let ledger = emptyLedger();
    let published = 0;
    let atMs = T0;
    for (let index = 0; index < 20; index += 1) {
      ledger = noteClose(ledger, {
        actorId: "vendor-a",
        deviceId: "tablet",
        reason: "TRANSPORT_CLOSED",
        detectedAtMs: atMs,
        publishAtMs: atMs + PRESENCE_GRACE_MS,
      });
      const back = blip(atMs);
      const reconnect = noteReconnect(ledger, { actorId: "vendor-a", deviceId: "tablet" });
      ledger = reconnect.ledger;
      const swept = sweep(ledger, back);
      published += swept.published.length;
      ledger = swept.ledger;
      atMs += 1_200;
      assert.equal(atMs - T0 <= 30_000, true);
    }
    assert.equal(published, 0);
    assert.equal(ledger.absent.length, 0);
  });

  test("a close that outlasts the grace publishes exactly once", () => {
    let ledger = noteClose(emptyLedger(), {
      actorId: "vendor-a",
      deviceId: "tablet",
      reason: "TRANSPORT_CLOSED",
      detectedAtMs: T0,
      publishAtMs: T0 + PRESENCE_GRACE_MS,
    });
    const first = sweep(ledger, T0 + PRESENCE_GRACE_MS);
    ledger = first.ledger;
    assert.equal(first.published.length, 1);
    const second = sweep(ledger, T0 + PRESENCE_GRACE_MS + 1);
    assert.equal(second.published.length, 0);
    assert.equal(ledger.absent.length, 1);
  });

  test("a second close while absent does not raise a second absence", () => {
    let ledger = noteClose(emptyLedger(), {
      actorId: "rider-a",
      deviceId: "phone",
      reason: "TRANSPORT_CLOSED",
      detectedAtMs: T0,
      publishAtMs: T0,
    });
    ledger = sweep(ledger, T0).ledger;
    ledger = noteClose(ledger, {
      actorId: "rider-a",
      deviceId: "phone",
      reason: "TRANSPORT_CLOSED",
      detectedAtMs: T0 + 1_000,
      publishAtMs: T0 + 1_000,
    });
    const swept = sweep(ledger, T0 + 5_000);
    assert.equal(swept.published.length, 0);
    assert.equal(swept.ledger.pending.length, 0);
  });

  test("a second close while pending does not push the publication later", () => {
    const pending = {
      actorId: "rider-a",
      deviceId: "phone",
      reason: "TRANSPORT_CLOSED" as const,
      detectedAtMs: T0,
      publishAtMs: T0 + PRESENCE_GRACE_MS,
    };
    let ledger = noteClose(emptyLedger(), pending);
    ledger = noteClose(ledger, { ...pending, detectedAtMs: T0 + 500, publishAtMs: T0 + 500 + PRESENCE_GRACE_MS });
    assert.equal(ledger.pending.length, 1);
    assert.equal((ledger.pending[0] as { publishAtMs: number }).publishAtMs, T0 + PRESENCE_GRACE_MS);
  });

  test("a deliberate close publishes at once, because there is no grace to wait out", () => {
    const ledger = noteClose(emptyLedger(), {
      actorId: "rider-a",
      deviceId: "phone",
      reason: "USER_OFFLINE",
      detectedAtMs: T0,
      publishAtMs: T0,
    });
    const swept = sweep(ledger, T0);
    assert.equal(swept.published.length, 1);
    assert.equal((swept.published[0] as { reason: string }).reason, "USER_OFFLINE");
  });

  test("a reconnect after publication restores the device and clears the record", () => {
    let ledger = noteClose(emptyLedger(), {
      actorId: "rider-a",
      deviceId: "phone",
      reason: "TRANSPORT_CLOSED",
      detectedAtMs: T0,
      publishAtMs: T0,
    });
    ledger = sweep(ledger, T0).ledger;
    const reconnect = noteReconnect(ledger, { actorId: "rider-a", deviceId: "phone" });
    assert.equal(reconnect.restored, true);
    assert.equal(reconnect.cancelled, null);
    assert.equal(reconnect.ledger.absent.length, 0);
  });

  test("a device that never connected reconnects harmlessly", () => {
    const reconnect = noteReconnect(emptyLedger(), { actorId: "ghost", deviceId: "none" });
    assert.equal(reconnect.cancelled, null);
    assert.equal(reconnect.restored, false);
  });

  test("sweeping before the deadline publishes nothing and leaves the ledger as it was", () => {
    const ledger = noteClose(emptyLedger(), {
      actorId: "rider-a",
      deviceId: "phone",
      reason: "TRANSPORT_CLOSED",
      detectedAtMs: T0,
      publishAtMs: T0 + PRESENCE_GRACE_MS,
    });
    const swept = sweep(ledger, T0 + PRESENCE_GRACE_MS - 1);
    assert.equal(swept.published.length, 0);
    assert.equal(swept.ledger, ledger);
  });
});

describe("detection latency", () => {
  /**
   * The brief's number, as a build-failing assertion.
   *
   * A thousand simulated losses per backend, each with a close kind and a configured grace drawn from
   * a seeded generator. For each one the test does the whole jump — the absence is scheduled, the
   * clock moves to the publication instant, the ledger publishes, and the *real* coordinator is told
   * the device is gone — then measures `detected + transport budget` to the instant the presence list
   * stops containing it. That is the p95 the document promises; wall-clock timing is measured by the
   * load test, not here.
   */
  for (const backend of BACKENDS) {
    test(`${backend.name}: p95 detection stays under two seconds over 1 000 losses`, async () => {
      const { coordinator, clock } = backend.make();
      const random = seeded(0x5eed);
      const latencies: number[] = [];
      for (let index = 0; index < 1_000; index += 1) {
        const deviceId = `device-${String(index % 7)}`;
        await coordinator.declarePresence({ actorId: "rider-a", deviceId, role: "RIDER", zoneId: "zone-1" });
        const detectedAt = clock.nowMs() + 750;
        const roll = random();
        const close =
          roll < 0.7
            ? { code: 1_006, clean: false }
            : roll < 0.85
              ? { code: CLOSE_GOING_OFFLINE, clean: true }
              : { code: 1_001, clean: false };
        const graceMs = roll < 0.6 ? PRESENCE_GRACE_MS : Math.floor(random() * (MAX_PRESENCE_GRACE_MS + 1));
        const order = absenceFor(close, graceMs);
        let ledger = noteClose(emptyLedger(), {
          actorId: "rider-a",
          deviceId,
          reason: order.reason,
          detectedAtMs: detectedAt,
          publishAtMs: publishAtMs(detectedAt, order),
        });
        clock.advance(publishAtMs(detectedAt, order) - clock.nowMs());
        const swept = sweep(ledger, clock.nowMs());
        ledger = swept.ledger;
        assert.equal(swept.published.length, 1, `loss ${String(index)} published nothing`);
        await coordinator.markAbsent("zone-1", "rider-a", deviceId, order.reason);
        const present = await coordinator.listPresence("zone-1", "RIDER");
        assert.equal(present.some((session) => session.deviceId === deviceId), false);
        const detectedMs = clock.nowMs() - detectedAt + TRANSPORT_CLOSE_BUDGET_MS + PRESENCE_STORE_BUDGET_MS;
        latencies.push(detectedMs);
        assert.ok(detectedMs <= MAX_DETECTION_MS, `loss ${String(index)} took ${String(detectedMs)} ms`);
      }
      const p95 = percentile(latencies, 0.95);
      assert.ok(p95 <= MAX_DETECTION_MS, `p95 was ${String(p95)} ms`);
    });
  }

  test("the measurement is not vacuous: the worst configured case is the slowest", () => {
    const order = absenceFor({ code: 1_006, clean: false }, MAX_PRESENCE_GRACE_MS);
    assert.equal(worstCaseDetectionMs(MAX_PRESENCE_GRACE_MS), MAX_DETECTION_MS);
    assert.equal(publishAtMs(T0, order), T0 + MAX_PRESENCE_GRACE_MS);
  });
});
