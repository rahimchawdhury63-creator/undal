/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * One alarm tick, in the order that keeps the two erasures from repeating each other (`07 §6.1`, D107).
 *
 * The presence sweep must run first: an absence it publishes erases its own rider immediately (D99), and a
 * sweep that ran first would report a departure the room was about to explain — an operator line for a rider
 * whose phone was fine, only slow.
 *
 * The other three properties are the ones a test can hold: the cutoff is the grace minute and not "now", a
 * sweep that removes nothing says nothing, and a sweep that throws does not take the alarm's other work with it.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SWEEP_GRACE_MS, runZoneAlarm } from "../src/d1/sweep.ts";

interface Recorder {
  readonly order: string[];
  readonly cutoffs: number[];
  readonly reported: { riders: number; positions: number }[];
  readonly failures: unknown[];
}

function deps(
  options: {
    sweep?: boolean;
    swept?: { riders: number; positions: number };
    fail?: boolean;
    presenceFails?: boolean;
    wave?: boolean;
    waveResult?: { expired: number; advanced: number };
    waveFails?: boolean;
  } = {},
): Recorder & Parameters<typeof runZoneAlarm>[0] {
  const recorder: Recorder = { order: [], cutoffs: [], reported: [], failures: [] };
  return {
    ...recorder,
    async presence(): Promise<unknown> {
      recorder.order.push("presence");
      if (options.presenceFails === true) throw new Error("presence unavailable");
      return [];
    },
    sweep:
      options.sweep === false
        ? null
        : async (cutoffMs: number) => {
            recorder.order.push("sweep");
            recorder.cutoffs.push(cutoffMs);
            if (options.fail === true) throw new Error("d1 unavailable");
            return options.swept ?? { riders: 0, positions: 0 };
          },
    report(swept) {
      recorder.reported.push({ riders: swept.riders, positions: swept.positions });
    },
    reportError(error) {
      recorder.failures.push(error);
    },
    wave:
      options.wave === false
        ? null
        : async () => {
            recorder.order.push("wave");
            if (options.waveFails === true) throw new Error("core unavailable");
            return options.waveResult ?? { expired: 0, advanced: 0 };
          },
  };
}

describe("the fifth erasure trigger", () => {
  test("presence publishes before the sweep reads, so the sweep cannot report what the room just explained", async () => {
    const recorder = deps();
    await runZoneAlarm(recorder, 1_000_000);
    assert.deepEqual(recorder.order, ["presence", "sweep", "wave"]);
  });

  test("the cutoff is a grace minute behind now, not now", async () => {
    const recorder = deps();
    await runZoneAlarm(recorder, 1_000_000);
    assert.deepEqual(recorder.cutoffs, [1_000_000 - SWEEP_GRACE_MS]);
    assert.equal(SWEEP_GRACE_MS, 60_000, "§6.1 promises under 60 s from the next sweep");
  });

  test("a sweep that removes nobody is a quiet tick", async () => {
    const recorder = deps({ swept: { riders: 0, positions: 0 } });
    await runZoneAlarm(recorder, 1_000_000);
    assert.deepEqual(recorder.reported, []);
    assert.deepEqual(recorder.failures, []);
  });

  test("a sweep that removes a rider is reported with both counts", async () => {
    const recorder = deps({ swept: { riders: 1, positions: 37 } });
    await runZoneAlarm(recorder, 1_000_000);
    assert.deepEqual(recorder.reported, [{ riders: 1, positions: 37 }]);
  });

  test("a failing sweep is reported and does not fail the alarm", async () => {
    const recorder = deps({ fail: true });
    await runZoneAlarm(recorder, 1_000_000);
    assert.equal(recorder.failures.length, 1);
    assert.equal(recorder.order.join(","), "presence,sweep,wave", "the tick still ran to the end");
  });

  test("a deployment with no live-position database sweeps nothing and says nothing", async () => {
    const recorder = deps({ sweep: false });
    await runZoneAlarm(recorder, 1_000_000);
    assert.deepEqual(recorder.order, ["presence", "wave"]);
    assert.deepEqual(recorder.reported, []);
    assert.deepEqual(recorder.failures, []);
  });

  test("a presence failure is the caller's problem, not something a deletion may hide", async () => {
    const recorder = deps({ presenceFails: true });
    await assert.rejects(() => runZoneAlarm(recorder, 1_000_000), /presence unavailable/u);
  });
});

describe("the dispatch tick inside the alarm (D130)", () => {
  test("it runs after the sweep, because an erased rider cannot be rung", async () => {
    const recorder = deps();
    await runZoneAlarm(recorder, 1_000_000);
    assert.deepEqual(recorder.order, ["presence", "sweep", "wave"]);
  });

  test("it still runs when the deployment has no live-position database", async () => {
    const recorder = deps({ sweep: false });
    await runZoneAlarm(recorder, 1_000_000);
    assert.deepEqual(recorder.order, ["presence", "wave"], "offers expire whether or not we can see anybody");
  });

  test("a sweep failure does not stop the wave tick", async () => {
    const recorder = deps({ fail: true, waveResult: { expired: 2, advanced: 1 } });
    await runZoneAlarm(recorder, 1_000_000);
    assert.equal(recorder.failures.length, 1);
    assert.equal(recorder.order.at(-1), "wave");
  });

  test("a wave failure is recorded and not rethrown: the next tick tries again", async () => {
    const recorder = deps({ waveFails: true });
    await runZoneAlarm(recorder, 1_000_000);
    assert.equal(recorder.failures.length, 1);
    assert.equal(recorder.order.at(-1), "wave");
  });

  test("no configured core means no tick, and the alarm is what it was", async () => {
    const recorder = deps({ wave: false });
    await runZoneAlarm(recorder, 1_000_000);
    assert.deepEqual(recorder.order, ["presence", "sweep"]);
  });
});
