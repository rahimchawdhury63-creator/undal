/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The two-minute ladder (`14 §4.1`).
 *
 * An order is published to a vendor's socket and, if nobody says *seen*, the platform does not simply
 * wait and cancel: it escalates on a fixed schedule, and at every step a single `order.seen` or
 * `order.accept` stops the whole thing and restores the vendor's state. The schedule is the contract —
 * eight seconds for a probe, ten for `UNREACHABLE`, ninety to offer the customer an early out, one
 * hundred and twenty to cancel — so it lives here as data, not as a chain of `setTimeout` calls that
 * nobody can read.
 *
 * Two rules are load-bearing and are enforced here rather than in a handler:
 *
 * 1. **A late acceptance wins.** The reaper re-reads the order before it cancels, so an acceptance at
 *    119.9 s is honoured and the cancellation becomes a no-op.
 * 2. **Firing twice is a no-op.** Every step records that it fired, and the reaper's decision is a
 *    function of the order's current state, so a retried alarm cannot send a second cancellation.
 */

/** The instant the probe is sent: 8 s after publication. */
export const PROBE_AT_MS = 8_000;

/** How long a probe waits for its reply before the vendor is unreachable. */
export const PROBE_REPLY_WINDOW_MS = 2_000;

/** The instant the vendor is marked unreachable: 10 s after publication. */
export const UNREACHABLE_AT_MS = PROBE_AT_MS + PROBE_REPLY_WINDOW_MS;

/** The instant the order is auto-cancelled: 120 s after publication. */
export const AUTO_CANCEL_MS = 120_000;

/** The reason code the cancellation carries. */
export const AUTO_CANCEL_REASON = "VENDOR_DEVICE_UNREACHABLE";

/** The exception the command centre raises at 60 s. */
export const UNREACHABLE_EXCEPTION = "VENDOR_UNREACHABLE";

/** What the ladder does at a step. */
export type LadderAction =
  | "PUBLISH"
  | "PROBE"
  | "MARK_UNREACHABLE"
  | "FCM_SECOND"
  | "FCM_THIRD"
  | "ALERT_BACKUP"
  | "RAISE_EXCEPTION"
  | "OFFER_EARLY_OUT"
  | "AUTO_CANCEL";

/** One rung. `openState` is what the vendor's state becomes when this rung fires. */
export interface LadderStep {
  readonly atMs: number;
  readonly action: LadderAction;
  readonly openState: "UNCHANGED" | "UNREACHABLE";
  /** The second the customer or the operator would put on a timeline. */
  readonly atSeconds: number;
}

/** The ladder, in order. Every instant in `14 §4.1` appears exactly once. */
export const ESCALATION_STEPS: readonly LadderStep[] = [
  { atMs: 0, action: "PUBLISH", openState: "UNCHANGED", atSeconds: 0 },
  { atMs: PROBE_AT_MS, action: "PROBE", openState: "UNCHANGED", atSeconds: 8 },
  { atMs: UNREACHABLE_AT_MS, action: "MARK_UNREACHABLE", openState: "UNREACHABLE", atSeconds: 10 },
  // The second FCM goes out with the `UNREACHABLE` transition, and the third replaces it rather than
  // stacking: two notifications for one cold order is noise, and three is an alarm nobody reads.
  { atMs: UNREACHABLE_AT_MS, action: "FCM_SECOND", openState: "UNCHANGED", atSeconds: 10 },
  { atMs: 25_000, action: "FCM_THIRD", openState: "UNCHANGED", atSeconds: 25 },
  { atMs: 45_000, action: "ALERT_BACKUP", openState: "UNCHANGED", atSeconds: 45 },
  { atMs: 60_000, action: "RAISE_EXCEPTION", openState: "UNCHANGED", atSeconds: 60 },
  { atMs: 90_000, action: "OFFER_EARLY_OUT", openState: "UNCHANGED", atSeconds: 90 },
  { atMs: AUTO_CANCEL_MS, action: "AUTO_CANCEL", openState: "UNREACHABLE", atSeconds: 120 },
];

/** A rung that has fired, and the instant it actually fired rather than the instant it was due. */
export interface FiredStep {
  readonly action: LadderAction;
  readonly atMs: number;
}

/** A live ladder for one order. */
export interface LadderState {
  readonly orderId: string;
  readonly publishedAtMs: number;
  /** The last instant the vendor was heard from, or `null` if it never answered. */
  readonly lastSeenAtMs: number | null;
  /** When a `seen` or `accept` stopped the ladder, or `null` while it is still running. */
  readonly haltedAtMs: number | null;
  /** What has already fired, in order, with the instant it fired. A step never fires twice. */
  readonly fired: readonly FiredStep[];
  readonly probesSent: number;
  readonly probeReplies: number;
}

/** A ladder that has just been published to the vendor's socket. */
export function startLadder(orderId: string, publishedAtMs: number): LadderState {
  return {
    orderId,
    publishedAtMs,
    lastSeenAtMs: null,
    haltedAtMs: null,
    fired: [],
    probesSent: 0,
    probeReplies: 0,
  };
}

/** Whether a rung has already fired. */
export function hasFired(ladder: LadderState, action: LadderAction): boolean {
  return ladder.fired.some((step) => step.action === action);
}

/** Whether the ladder has been stopped by the vendor. */
export function isHalted(ladder: LadderState): boolean {
  return ladder.haltedAtMs !== null;
}

/**
 * The vendor answered.
 *
 * The answer stops the ladder at whatever rung it had reached. It does not un-fire the FCMs that were
 * already sent, and it does not rewrite the history — the evidence block in `evidence.ts` needs both.
 */
export function noteSeen(ladder: LadderState, atMs: number): LadderState {
  return { ...ladder, lastSeenAtMs: atMs, haltedAtMs: ladder.haltedAtMs ?? atMs };
}

/** A probe reply. Inside the window it restores the vendor; outside it is only a late hello. */
export function noteProbeReply(ladder: LadderState, atMs: number): LadderState {
  const replied: LadderState = { ...ladder, probeReplies: ladder.probeReplies + 1, lastSeenAtMs: atMs };
  const probeAt = ladder.publishedAtMs + PROBE_AT_MS;
  const withinWindow = atMs >= probeAt && atMs <= probeAt + PROBE_REPLY_WINDOW_MS;
  return withinWindow && ladder.probesSent > 0 ? { ...replied, haltedAtMs: ladder.haltedAtMs ?? atMs } : replied;
}

/** What is due at an instant, oldest first, excluding anything already fired. */
export function dueSteps(ladder: LadderState, atMs: number): readonly LadderStep[] {
  if (isHalted(ladder)) return [];
  const elapsed = atMs - ladder.publishedAtMs;
  return ESCALATION_STEPS.filter((step) => step.atMs <= elapsed && !hasFired(ladder, step.action));
}

/**
 * Fire everything due.
 *
 * `PROBE` increments the probe counter, because the evidence block reports how many probes were sent
 * and a probe that is merely listed as fired is not evidence.
 */
export function fireDue(
  ladder: LadderState,
  atMs: number,
): { readonly ladder: LadderState; readonly fired: readonly LadderStep[] } {
  const due = dueSteps(ladder, atMs);
  if (due.length === 0) return { ladder, fired: [] };
  const probes = due.filter((step) => step.action === "PROBE").length;
  return {
    ladder: {
      ...ladder,
      fired: [...ladder.fired, ...due.map((step) => ({ action: step.action, atMs }))],
      probesSent: ladder.probesSent + probes,
    },
    fired: due,
  };
}

/** Whether the ladder has reached the instant of cancellation. */
export function shouldAutoCancel(ladder: LadderState, atMs: number): boolean {
  if (isHalted(ladder)) return false;
  return atMs - ladder.publishedAtMs >= AUTO_CANCEL_MS;
}

/** The order's state as the reaper reads it, which is the authority over the ladder. */
export type ReapableOrderState = "PLACED" | "ACCEPTED" | "CANCELLED" | "AUTO_CANCELLED";

/** What the reaper should do, and why. */
export interface ReapDecision {
  readonly cancel: boolean;
  readonly reason: "CANCEL" | "NOT_PLACED" | "VENDOR_ANSWERED" | "NOT_DUE";
}

/**
 * Decide whether to cancel.
 *
 * The order's state is checked first and *only* `PLACED` may be cancelled: a vendor who accepts while
 * the alarm is in flight wins, and the second alarm — which is a certainty, not a possibility — finds
 * `ACCEPTED` and does nothing.
 */
export function reapDecision(ladder: LadderState, orderState: ReapableOrderState, atMs: number): ReapDecision {
  if (orderState !== "PLACED") return { cancel: false, reason: "NOT_PLACED" };
  if (isHalted(ladder)) return { cancel: false, reason: "VENDOR_ANSWERED" };
  if (!shouldAutoCancel(ladder, atMs)) return { cancel: false, reason: "NOT_DUE" };
  return { cancel: true, reason: "CANCEL" };
}
