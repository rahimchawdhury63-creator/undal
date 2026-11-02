/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The room's single alarm: when to set it, and who it sweeps.
 *
 * A timer that fires a millisecond early is not a small bug here — it publishes an absence for a device
 * that was answering — so every boundary in this suite is tested from both sides.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { HEARTBEAT_DEADLINE_MS } from "../src/coordination/coordinator.ts";
import type { DeadlineEntry } from "../src/presence/deadline.ts";
import { expiredAt, nextAlarmAt, shouldRearm } from "../src/presence/deadline.ts";
import { T0 } from "./support/backends.ts";

/** One device with a deadline relative to T0. */
function entry(actorId: string, deviceId: string, deadlineMs: number): DeadlineEntry {
  return { actorId, deviceId, deadlineMs };
}

describe("the room's alarm", () => {
  test("an empty room has no alarm to set", () => {
    assert.equal(nextAlarmAt([]), null);
  });

  test("one device means one deadline", () => {
    assert.equal(nextAlarmAt([entry("r1", "d1", T0 + HEARTBEAT_DEADLINE_MS)]), T0 + HEARTBEAT_DEADLINE_MS);
  });

  test("the earliest deadline wins", () => {
    const entries = [entry("r1", "d1", T0 + 9_000), entry("r2", "d2", T0 + 3_000), entry("r3", "d3", T0 + 6_000)];
    assert.equal(nextAlarmAt(entries), T0 + 3_000);
  });

  test("two devices on the same deadline resolve deterministically", () => {
    const left = [entry("r1", "d1", T0 + 5_000), entry("r2", "d2", T0 + 5_000)];
    const right = [entry("r2", "d2", T0 + 5_000), entry("r1", "d1", T0 + 5_000)];
    assert.equal(nextAlarmAt(left), nextAlarmAt(right));
  });

  test("a deadline that is not a number is refused rather than scheduled", () => {
    assert.throws(() => nextAlarmAt([entry("r1", "d1", Number.NaN)]), RangeError);
    assert.throws(() => nextAlarmAt([entry("r1", "d1", Number.POSITIVE_INFINITY)]), RangeError);
  });

  test("nothing is expired before the earliest deadline", () => {
    assert.deepEqual(expiredAt([entry("r1", "d1", T0 + 2_000)], T0 + 1_999), []);
  });

  test("exactly on the deadline is still present", () => {
    assert.deepEqual(expiredAt([entry("r1", "d1", T0 + 2_000)], T0 + 2_000), []);
  });

  test("one millisecond later is absent", () => {
    const expired = expiredAt([entry("r1", "d1", T0 + 2_000)], T0 + 2_001);
    assert.equal(expired.length, 1);
    assert.equal(expired[0]?.deviceId, "d1");
  });

  test("a sweep returns only the expired devices, oldest deadline first", () => {
    const entries = [entry("r1", "d1", T0 + 1_000), entry("r2", "d2", T0 + 9_000), entry("r3", "d3", T0 + 500)];
    const expired = expiredAt(entries, T0 + 2_000);
    assert.deepEqual(expired.map((held) => held.actorId), ["r3", "r1"]);
  });

  test("a device that just beat is not swept", () => {
    const entries = [entry("r1", "d1", T0 + 2_000), entry("r2", "d2", T0 + 10_000)];
    assert.deepEqual(expiredAt(entries, T0 + 2_500).map((held) => held.actorId), ["r1"]);
  });

  test("the alarm moves when the earliest deadline moves", () => {
    const before = nextAlarmAt([entry("r1", "d1", T0 + 1_000), entry("r2", "d2", T0 + 4_000)]);
    const after = nextAlarmAt([entry("r1", "d1", T0 + 3_500), entry("r2", "d2", T0 + 4_000)]);
    assert.equal(shouldRearm(before, after), true);
    assert.equal(after, T0 + 3_500);
  });

  test("re-arming to the same instant is not a write", () => {
    assert.equal(shouldRearm(T0 + 1_000, T0 + 1_000), false);
  });

  test("clearing the alarm when the room empties is a change", () => {
    assert.equal(shouldRearm(T0 + 1_000, null), true);
    assert.equal(shouldRearm(null, null), false);
  });

  test("the earliest deadline is a heartbeat's two seconds, not a wall clock", () => {
    const lastBeat = T0;
    const deadline = lastBeat + HEARTBEAT_DEADLINE_MS;
    assert.equal(nextAlarmAt([entry("r1", "d1", deadline)]), deadline);
    assert.deepEqual(expiredAt([entry("r1", "d1", deadline)], deadline), []);
  });
});
