/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The decision that cancels an order, isolated from the ladder that schedules it.
 *
 * The ladder says when the two minutes are up; this file says whether the cancellation is still the
 * right thing to do at the moment the alarm actually runs. That gap — between "the deadline was set" and
 * "the alarm fired" — is where a vendor's acceptance arrives, and it is the entire reason the reaper
 * reads the order's state before it writes anything.
 */

import type { LadderState } from "./escalation.ts";
import { AUTO_CANCEL_MS, isHalted } from "./escalation.ts";

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
