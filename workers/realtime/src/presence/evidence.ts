/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The evidence block behind an auto-cancel (`14 §4.2`).
 *
 * Cancelling a restaurant's order because its tablet was unreachable is a serious thing to do to
 * somebody's business, and the platform only gets to do it if it can show its work. The block records
 * what was sent, when, how many times, and what came back — including Firebase's own message ids,
 * which a vendor can look up independently in their own console. If a dispute is ever raised, this is
 * the answer, and it is written before the cancellation, not after.
 */

import type { LadderAction, LadderState } from "./escalation.ts";
import { ESCALATION_STEPS } from "./escalation.ts";

/** One rung, as it will be shown in a dispute. */
export interface LadderEntry {
  readonly atSeconds: number;
  readonly action: LadderAction;
  /** When it fired, or `null` when the rung was cancelled before it fired. */
  readonly firedAtMs: number | null;
}

/** Everything an appeal would need. */
export interface CancelEvidence {
  readonly orderId: string;
  readonly publishedAtMs: number;
  readonly lastSeenAtMs: number | null;
  readonly socketState: "CLOSED" | "OPEN";
  readonly fcmAttempts: number;
  readonly fcmMessageIds: readonly string[];
  readonly probesSent: number;
  readonly probeRepliesReceived: number;
  readonly backupContactAlertedAtMs: number | null;
  readonly haltedAtMs: number | null;
  readonly elapsedMs: number;
  readonly ladder: readonly LadderEntry[];
}

/** What the sender knows that the ladder does not. */
export interface EvidenceInputs {
  readonly socketState: "CLOSED" | "OPEN";
  readonly fcmMessageIds: readonly string[];
  /** When the backup contact was alerted, if the ladder got that far. */
  readonly backupContactAlertedAtMs: number | null;
}

/**
 * Build the block.
 *
 * Every rung of the ladder appears, fired or not, with the instant it fired. A rung that never fired is
 * not omitted: "we did not get to 45 seconds" is part of the account, and a list that shrinks to what
 * happened cannot be checked against the schedule it was supposed to follow.
 */
export function buildEvidence(
  ladder: LadderState,
  canceledAtMs: number,
  inputs: EvidenceInputs,
): CancelEvidence {
  const elapsedMs = canceledAtMs - ladder.publishedAtMs;
  return {
    orderId: ladder.orderId,
    publishedAtMs: ladder.publishedAtMs,
    lastSeenAtMs: ladder.lastSeenAtMs,
    socketState: inputs.socketState,
    fcmAttempts: inputs.fcmMessageIds.length,
    fcmMessageIds: [...inputs.fcmMessageIds],
    probesSent: ladder.probesSent,
    probeRepliesReceived: ladder.probeReplies,
    backupContactAlertedAtMs: inputs.backupContactAlertedAtMs,
    haltedAtMs: ladder.haltedAtMs,
    elapsedMs,
    ladder: ladderEntries(ladder, canceledAtMs),
  };
}

/** The rungs as a timeline, including the ones that never fired. */
export function ladderEntries(ladder: LadderState, canceledAtMs: number): readonly LadderEntry[] {
  void canceledAtMs;
  const fired = ladder.fired.map((step) => ({
    atSeconds: secondsFor(step.action),
    action: step.action,
    firedAtMs: step.atMs,
  }));
  const notFired = actionsNotFired(ladder).map((action) => ({
    atSeconds: secondsFor(action),
    action,
    firedAtMs: null,
  }));
  return [...fired, ...notFired].sort((left, right) => left.atSeconds - right.atSeconds);
}

/** The actions the ladder has not fired. */
function actionsNotFired(ladder: LadderState): readonly LadderAction[] {
  return ESCALATION_STEPS.map((step) => step.action).filter(
    (action) => !ladder.fired.some((step) => step.action === action),
  );
}

/** The scheduled second for an action, which is what the timeline shows. */
function secondsFor(action: LadderAction): number {
  const step = ESCALATION_STEPS.find((candidate) => candidate.action === action);
  if (step === undefined) throw new RangeError(`not a rung: ${action}`);
  return step.atSeconds;
}
