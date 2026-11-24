/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { orderTopic } from "./state-events.ts";
import type { TransitionEffects } from "./lifecycle.ts";
import type { OrderActor, OrderState } from "./states.ts";

/**
 * What a transition sets in motion, as data.
 *
 * `06 §7.3` requires every transition to write an event row, publish SSE and possibly send FCM; some
 * also start a clock (the vendor's 120-second response window, the fifteen-minute settlement after
 * delivery, the twenty-four-hour dispute window). Deciding those in a handler is how "the rider was
 * never told" happens, so they are decided once, here, and handed back as a plan the caller performs.
 *
 * The plan is a value, not an action: it can be logged, diffed and asserted in a test with no
 * network, which is the only way to be sure a new state does not quietly stop notifying anybody.
 */

/** The three audiences a notification can go to. */
export type Audience = "CUSTOMER" | "VENDOR" | "RIDER";

/** A notification the caller must send, described rather than composed. */
export interface NotificationPlan {
  readonly audience: Audience;
  /** The message key the app localises; never a sentence, because the server cannot translate. */
  readonly messageKey: string;
}

/** A clock the caller must start, with the event that fires when it elapses. */
export interface TimerPlan {
  readonly name: "VENDOR_RESPONSE" | "SETTLE" | "DISPUTE_WINDOW";
  readonly firesAtMs: number;
  /** The transition the timer will attempt if nobody acts first. */
  readonly onFire: string;
}

/** Everything a transition must cause, in one value. */
export interface EffectPlan {
  readonly sseTopics: readonly string[];
  readonly sseEvent: string;
  readonly notifications: readonly NotificationPlan[];
  readonly timers: readonly TimerPlan[];
  readonly audit: boolean;
}

/** The vendor's response window, from `06 §7.3`: two minutes before the order is auto-cancelled. */
export const VENDOR_RESPONSE_WINDOW_S = 120;

/** Settlement runs fifteen minutes after delivery, once the cash is in the rider's hand. */
export const SETTLE_AFTER_DELIVERY_MIN = 15;

/** A customer has twenty-four hours to dispute a delivery. */
export const DISPUTE_WINDOW_MIN = 24 * 60;

/** The message key for a move, by state. Keys are stable strings the apps already ship. */
const MESSAGE_KEYS: Readonly<Record<OrderState, string>> = {
  DRAFT: "order.draft",
  PLACED: "order.placed",
  ACCEPTED: "order.accepted",
  REJECTED: "order.rejected",
  RIDER_SEARCH: "order.rider_search",
  RIDER_ASSIGNED: "order.rider_assigned",
  PICKED_UP: "order.picked_up",
  ARRIVED: "order.arrived",
  DELIVERED: "order.delivered",
  SETTLED: "order.settled",
  AUTO_CANCELLED: "order.auto_cancelled",
  CANCELLED_BY_CUSTOMER: "order.cancelled_by_customer",
  CANCELLED_BY_VENDOR: "order.cancelled_by_vendor",
  CANCELLED_BY_ADMIN: "order.cancelled_by_admin",
  REASSIGNING: "order.reassigning",
  DISPUTED: "order.disputed",
};

/** Which audiences a state change is for. The actor is never notified of their own action. */
function audiencesFor(to: OrderState, actor: OrderActor): readonly Audience[] {
  const all: readonly Audience[] = ["CUSTOMER", "VENDOR", "RIDER"];
  const actorAudience: Audience | null =
    actor === "CUSTOMER" ? "CUSTOMER" : actor === "VENDOR" ? "VENDOR" : actor === "RIDER" ? "RIDER" : null;
  return all.filter((audience) => audience !== actorAudience);
}

/** The clocks a new state starts, if any. */
function timersFor(to: OrderState, nowMs: number): readonly TimerPlan[] {
  // Each timer names the transition it will attempt, not the transition it will perform: the state
  // machine still decides, so a timer that fires against an order somebody else already moved is
  // refused rather than obeyed.
  if (to === "PLACED")
    return [{ name: "VENDOR_RESPONSE", firesAtMs: nowMs + VENDOR_RESPONSE_WINDOW_S * 1000, onFire: "AUTO_CANCELLED" }];
  if (to === "DELIVERED")
    return [{ name: "SETTLE", firesAtMs: nowMs + SETTLE_AFTER_DELIVERY_MIN * 60 * 1000, onFire: "SETTLED" }];
  if (to === "SETTLED") return [{ name: "DISPUTE_WINDOW", firesAtMs: nowMs + DISPUTE_WINDOW_MIN * 60 * 1000, onFire: "DISPUTED" }];
  return [];
}

/**
 * Plan the effects of one transition.
 *
 * The lifecycle's flags decide *whether* to notify; this function decides *whom*, with two rules the
 * flags cannot express: the actor is not told about their own tap, and a state change that settles
 * money always publishes even if no human is watching, because the finance screen reads the stream.
 */
export function planEffects(input: {
  readonly orderId: string;
  readonly to: OrderState;
  readonly actor: OrderActor;
  readonly event: string;
  readonly effects: TransitionEffects;
  readonly nowMs: number;
}): EffectPlan {
  const notifications: NotificationPlan[] = [];
  for (const audience of audiencesFor(input.to, input.actor)) {
    if (audience === "CUSTOMER" && !input.effects.notifyCustomer) continue;
    if (audience === "VENDOR" && !input.effects.notifyVendor) continue;
    if (audience === "RIDER" && !input.effects.notifyRider) continue;
    notifications.push({ audience, messageKey: MESSAGE_KEYS[input.to] });
  }

  return {
    sseTopics: [orderTopic(input.orderId)],
    sseEvent: input.event,
    notifications,
    timers: timersFor(input.to, input.nowMs),
    // Every transition is audited; the flag exists in the lifecycle so a test can assert the rule
    // rather than a handler remembering it.
    audit: input.effects.writeStateEvent,
  };
}
