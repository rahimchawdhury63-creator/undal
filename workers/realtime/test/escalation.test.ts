/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The escalation ladder, the reaper, and the evidence a cancellation carries.
 *
 * The ladder is asserted at its boundaries rather than in the middle: one millisecond before a rung is
 * silence, exactly on it is the action. That is the only way a schedule written as data can be caught
 * drifting from the table in `14 §4.1`.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AUTO_CANCEL_MS,
  AUTO_CANCEL_REASON,
  ESCALATION_STEPS,
  PROBE_AT_MS,
  PROBE_REPLY_WINDOW_MS,
  UNREACHABLE_AT_MS,
  dueSteps,
  fireDue,
  hasFired,
  isHalted,
  noteProbeReply,
  noteSeen,
  startLadder,
} from "../src/presence/escalation.ts";
import { reapDecision, shouldAutoCancel } from "../src/presence/reaper.ts";
import { buildEvidence, ladderEntries } from "../src/presence/evidence.ts";
import { T0 } from "./support/backends.ts";

/** Fire everything due `elapsedMs` after publication and return the ladder. */
function firedBy(elapsedMs: number) {
  return fireDue(startLadder("order-1", T0), T0 + elapsedMs).ladder;
}

describe("escalation ladder", () => {
  test("a fresh ladder has fired nothing", () => {
    const ladder = startLadder("order-1", T0);
    assert.deepEqual(ladder.fired, []);
    assert.equal(ladder.haltedAtMs, null);
    assert.equal(ladder.probesSent, 0);
  });

  test("the schedule is the table in the document, in order", () => {
    assert.deepEqual(
      ESCALATION_STEPS.map((step) => step.atSeconds),
      [0, 8, 10, 10, 25, 45, 60, 90, 120],
    );
    assert.equal(PROBE_AT_MS, 8_000);
    assert.equal(UNREACHABLE_AT_MS, 10_000);
    assert.equal(AUTO_CANCEL_MS, 120_000);
  });

  test("one millisecond before the probe, nothing has been sent", () => {
    const ladder = firedBy(PROBE_AT_MS - 1);
    assert.deepEqual(ladder.fired.map((step) => step.action), ["PUBLISH"]);
  });

  test("exactly at eight seconds, the probe is sent", () => {
    const ladder = firedBy(PROBE_AT_MS);
    assert.deepEqual(ladder.fired.map((step) => step.action), ["PUBLISH", "PROBE"]);
    assert.equal(ladder.probesSent, 1);
  });

  test("a probe fires once, however often the alarm is swept", () => {
    let ladder = firedBy(PROBE_AT_MS);
    ladder = fireDue(ladder, PROBE_AT_MS + 1).ladder;
    ladder = fireDue(ladder, PROBE_AT_MS + 2).ladder;
    assert.equal(ladder.probesSent, 1);
    assert.equal(ladder.fired.filter((step) => step.action === "PROBE").length, 1);
  });

  test("at ten seconds the vendor is unreachable and a second FCM goes out", () => {
    const ladder = firedBy(UNREACHABLE_AT_MS);
    assert.equal(hasFired(ladder, "MARK_UNREACHABLE"), true);
    assert.equal(hasFired(ladder, "FCM_SECOND"), true);
    const unreachable = ESCALATION_STEPS.find((step) => step.action === "MARK_UNREACHABLE");
    assert.equal(unreachable?.openState, "UNREACHABLE");
  });

  test("the vendor's state is untouched before ten seconds", () => {
    for (const step of ESCALATION_STEPS.filter((candidate) => candidate.atMs < UNREACHABLE_AT_MS)) {
      assert.equal(step.openState, "UNCHANGED", `${step.action} changed the vendor's state early`);
    }
  });

  test("the third FCM is one rung, not a repeat of the second", () => {
    const ladder = firedBy(25_000);
    assert.equal(hasFired(ladder, "FCM_SECOND"), true);
    assert.equal(hasFired(ladder, "FCM_THIRD"), true);
    assert.equal(hasFired(firedBy(24_999), "FCM_THIRD"), false);
  });

  test("each later rung waits for its own instant", () => {
    assert.equal(hasFired(firedBy(44_999), "ALERT_BACKUP"), false);
    assert.equal(hasFired(firedBy(45_000), "ALERT_BACKUP"), true);
    assert.equal(hasFired(firedBy(59_999), "RAISE_EXCEPTION"), false);
    assert.equal(hasFired(firedBy(60_000), "RAISE_EXCEPTION"), true);
    assert.equal(hasFired(firedBy(89_999), "OFFER_EARLY_OUT"), false);
    assert.equal(hasFired(firedBy(90_000), "OFFER_EARLY_OUT"), true);
    assert.equal(hasFired(firedBy(119_999), "AUTO_CANCEL"), false);
    assert.equal(hasFired(firedBy(120_000), "AUTO_CANCEL"), true);
  });

  test("a ladder swept late still fires every rung it missed, once each", () => {
    const ladder = firedBy(AUTO_CANCEL_MS);
    assert.deepEqual(
      ladder.fired.map((step) => step.action),
      ["PUBLISH", "PROBE", "MARK_UNREACHABLE", "FCM_SECOND", "FCM_THIRD", "ALERT_BACKUP", "RAISE_EXCEPTION", "OFFER_EARLY_OUT", "AUTO_CANCEL"],
    );
    assert.equal(ladder.probesSent, 1);
  });

  test("fired rungs carry the instant they fired, not the instant they were due", () => {
    const ladder = fireDue(startLadder("order-1", T0), T0 + 12_000).ladder;
    assert.deepEqual(ladder.fired, [
      { action: "PUBLISH", atMs: T0 + 12_000 },
      { action: "PROBE", atMs: T0 + 12_000 },
      { action: "MARK_UNREACHABLE", atMs: T0 + 12_000 },
      { action: "FCM_SECOND", atMs: T0 + 12_000 },
    ]);
  });

  test("a vendor who answers at two seconds stops the whole ladder", () => {
    let ladder = noteSeen(fireDue(startLadder("order-1", T0), T0 + 2_000).ladder, T0 + 2_000);
    assert.equal(isHalted(ladder), true);
    ladder = fireDue(ladder, T0 + AUTO_CANCEL_MS).ladder;
    assert.deepEqual(ladder.fired.map((step) => step.action), ["PUBLISH"]);
    assert.equal(dueSteps(ladder, T0 + AUTO_CANCEL_MS).length, 0);
  });

  test("an acceptance at 119.9 seconds still wins", () => {
    let ladder = fireDue(startLadder("order-1", T0), T0 + 119_900).ladder;
    ladder = noteSeen(ladder, T0 + 119_900);
    assert.equal(reapDecision(ladder, "ACCEPTED", T0 + 120_000).cancel, false);
    const later = fireDue(ladder, T0 + 120_000);
    assert.equal(later.fired.length, 0);
  });

  test("an answer and then silence does not restart the ladder", () => {
    let ladder = noteSeen(fireDue(startLadder("order-1", T0), T0 + 20_000).ladder, T0 + 20_000);
    ladder = fireDue(ladder, T0 + 120_001).ladder;
    assert.equal(shouldAutoCancel(ladder, T0 + 120_001), false);
  });

  test("a probe reply inside the window restores the vendor before ten seconds", () => {
    let ladder = fireDue(startLadder("order-1", T0), T0 + PROBE_AT_MS).ladder;
    ladder = noteProbeReply(ladder, T0 + PROBE_AT_MS + PROBE_REPLY_WINDOW_MS);
    assert.equal(isHalted(ladder), true);
    assert.equal(ladder.probeReplies, 1);
    assert.equal(hasFired(fireDue(ladder, T0 + 11_000).ladder, "MARK_UNREACHABLE"), false);
  });

  test("a reply one millisecond after the window is too late", () => {
    let ladder = fireDue(startLadder("order-1", T0), T0 + PROBE_AT_MS).ladder;
    ladder = noteProbeReply(ladder, T0 + PROBE_AT_MS + PROBE_REPLY_WINDOW_MS + 1);
    assert.equal(isHalted(ladder), false);
    assert.equal(ladder.probeReplies, 1);
  });

  test("a reply with no probe outstanding is a hello, not a halt", () => {
    const ladder = noteProbeReply(startLadder("order-1", T0), T0 + PROBE_AT_MS);
    assert.equal(isHalted(ladder), false);
    assert.equal(ladder.lastSeenAtMs, T0 + PROBE_AT_MS);
  });

  test("a reply before the probe was sent does not halt either", () => {
    let ladder = fireDue(startLadder("order-1", T0), T0).ladder;
    ladder = noteProbeReply(ladder, T0 + 1_000);
    assert.equal(isHalted(ladder), false);
  });

  test("the second answer does not move the halt instant", () => {
    let ladder = noteSeen(startLadder("order-1", T0), T0 + 1_000);
    ladder = noteSeen(ladder, T0 + 2_000);
    assert.equal(ladder.haltedAtMs, T0 + 1_000);
    assert.equal(ladder.lastSeenAtMs, T0 + 2_000);
  });
});

describe("the reaper", () => {
  test("cancels a placed order at two minutes", () => {
    const decision = reapDecision(firedBy(AUTO_CANCEL_MS), "PLACED", T0 + AUTO_CANCEL_MS);
    assert.deepEqual(decision, { cancel: true, reason: "CANCEL" });
  });

  test("does nothing one millisecond early", () => {
    const decision = reapDecision(firedBy(AUTO_CANCEL_MS), "PLACED", T0 + AUTO_CANCEL_MS - 1);
    assert.deepEqual(decision, { cancel: false, reason: "NOT_DUE" });
  });

  test("an accepted order is never cancelled, however late the alarm", () => {
    const ladder = firedBy(AUTO_CANCEL_MS);
    assert.deepEqual(reapDecision(ladder, "ACCEPTED", T0 + 600_000), { cancel: false, reason: "NOT_PLACED" });
  });

  test("a cancelled order is not cancelled twice", () => {
    for (const state of ["CANCELLED", "AUTO_CANCELLED"] as const) {
      assert.deepEqual(reapDecision(firedBy(AUTO_CANCEL_MS), state, T0 + 200_000), {
        cancel: false,
        reason: "NOT_PLACED",
      });
    }
  });

  test("a vendor who answered is never cancelled", () => {
    const ladder = noteSeen(firedBy(20_000), T0 + 20_000);
    assert.deepEqual(reapDecision(ladder, "PLACED", T0 + AUTO_CANCEL_MS), {
      cancel: false,
      reason: "VENDOR_ANSWERED",
    });
  });

  test("a second fire of the same alarm is a no-op because the state moved", () => {
    const ladder = firedBy(AUTO_CANCEL_MS);
    const once = reapDecision(ladder, "PLACED", T0 + AUTO_CANCEL_MS);
    const twice = reapDecision(ladder, "AUTO_CANCELLED", T0 + AUTO_CANCEL_MS + 1);
    assert.equal(once.cancel, true);
    assert.equal(twice.cancel, false);
  });

  test("the cancellation names the reason the brief names", () => {
    assert.equal(AUTO_CANCEL_REASON, "VENDOR_DEVICE_UNREACHABLE");
  });
});

describe("evidence", () => {
  test("every rung appears, fired or not", () => {
    const ladder = firedBy(12_000);
    const evidence = buildEvidence(ladder, T0 + 30_000, {
      socketState: "CLOSED",
      fcmMessageIds: ["m1", "m2"],
      backupContactAlertedAtMs: null,
    });
    assert.equal(evidence.ladder.length, ESCALATION_STEPS.length);
    assert.equal(ladderEntries(ladder, T0 + 30_000).filter((entry) => entry.firedAtMs === null).length, 5);
  });

  test("the block carries the counts an appeal needs", () => {
    const ladder = firedBy(14_000);
    const evidence = buildEvidence(ladder, T0 + 120_000, {
      socketState: "CLOSED",
      fcmMessageIds: ["m1", "m2", "m3"],
      backupContactAlertedAtMs: T0 + 45_000,
    });
    assert.equal(evidence.socketState, "CLOSED");
    assert.equal(evidence.fcmAttempts, 3);
    assert.deepEqual(evidence.fcmMessageIds, ["m1", "m2", "m3"]);
    assert.equal(evidence.probesSent, 1);
    assert.equal(evidence.probeRepliesReceived, 0);
    assert.equal(evidence.backupContactAlertedAtMs, T0 + 45_000);
    assert.equal(evidence.elapsedMs, 120_000);
    assert.equal(evidence.lastSeenAtMs, null);
  });

  test("an answer is visible in the evidence, with the instant it stopped the ladder", () => {
    const ladder = noteSeen(firedBy(5_000), T0 + 5_000);
    const evidence = buildEvidence(ladder, T0 + 5_000, {
      socketState: "OPEN",
      fcmMessageIds: [],
      backupContactAlertedAtMs: null,
    });
    assert.equal(evidence.haltedAtMs, T0 + 5_000);
    assert.equal(evidence.lastSeenAtMs, T0 + 5_000);
    assert.equal(evidence.fcmAttempts, 0);
  });

  test("the ladder entries are ordered by the second they were scheduled", () => {
    const ladder = firedBy(120_000);
    const entries = ladderEntries(ladder, T0 + 120_000);
    const seconds = entries.map((entry) => entry.atSeconds);
    assert.deepEqual(seconds, [...seconds].sort((left, right) => left - right));
  });
});
