/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { assertTransition, findTransition, type Transition } from "./state-machine.ts";
import type { GuardName, TransitionContext } from "./guards.ts";
import type { OrderActor, OrderState } from "./states.ts";

/**
 * What a transition does beyond moving the state.
 *
 * `06 §7.3` says every transition writes an event row, emits SSE and may emit FCM. Those three
 * are decided here, once, for the same reason the table is data: a handler that decides its own
 * notifications is a handler that forgets one, and "the vendor was never told" is the single
 * most expensive class of bug in a delivery platform.
 *
 * Nothing in this module performs an effect. It returns the effects a caller must perform, which
 * is what keeps the lifecycle replayable — the same input produces the same decisions, months
 * later, in a test with no network.
 */

/** The channels a transition notifies. */
export interface TransitionEffects {
  /** Always true: an event row is written for every transition, without exception. */
  readonly writeStateEvent: true;
  readonly notifyCustomer: boolean;
  readonly notifyVendor: boolean;
  readonly notifyRider: boolean;
  /** The admin tower is watching the live board, so it always gets the SSE frame. */
  readonly publishSse: boolean;
  /** Whether the order's money is settled by this transition. */
  readonly settlesMoney: boolean;
}

/** One event row, shaped for `order_state_events`. */
export interface OrderStateEvent {
  readonly seq: number;
  readonly fromState: OrderState;
  readonly toState: OrderState;
  readonly actor: OrderActor;
  readonly event: string;
  readonly reasonCode: string | null;
  readonly occurredAtIso: string;
}

/** The outcome of applying a transition: the new state, the row to write, the effects to run. */
export interface TransitionOutcome {
  readonly state: OrderState;
  readonly event: OrderStateEvent;
  readonly effects: TransitionEffects;
  readonly transition: Transition;
}

/** Who hears about a state change, and which moves settle money. */
function effectsFor(transition: Transition): TransitionEffects {
  const to = transition.to;
  const notifyRider = to === "RIDER_ASSIGNED" || to === "REASSIGNING" || to === "SETTLED" || to === "DISPUTED";
  return {
    writeStateEvent: true,
    notifyCustomer:
      to === "ACCEPTED" || to === "REJECTED" || to === "PICKED_UP" || to === "ARRIVED" || to === "DELIVERED" ||
      to === "SETTLED" || to === "AUTO_CANCELLED" || to.startsWith("CANCELLED"),
    notifyVendor: to === "PLACED" || to === "REASSIGNING" || to === "CANCELLED_BY_CUSTOMER" || to === "AUTO_CANCELLED" || to === "DISPUTED",
    notifyRider,
    publishSse: true,
    settlesMoney: to === "DELIVERED" || to === "SETTLED" || to === "DISPUTED",
  };
}

/**
 * Apply one transition.
 *
 * Throws `TransitionRefused` when the edge is illegal, the actor may not drive it, or a guard
 * fails — the caller never has to check the verdict itself, and cannot forget to.
 */
export function applyTransition(input: {
  readonly orderId: string;
  readonly from: OrderState;
  readonly to: OrderState;
  readonly actor: OrderActor;
  readonly context: TransitionContext;
  readonly nextSeq: number;
  readonly nowMs: number;
  readonly reasonCode?: string | null;
}): TransitionOutcome {
  const transition = assertTransition(input.from, input.to, input.actor, input.context);

  return {
    state: input.to,
    transition,
    effects: effectsFor(transition),
    event: {
      seq: input.nextSeq,
      fromState: input.from,
      toState: input.to,
      actor: input.actor,
      event: transition.event,
      reasonCode: input.reasonCode ?? null,
      occurredAtIso: new Date(input.nowMs).toISOString(),
    },
  };
}

/**
 * Replay a sequence of state changes and prove the final state matches `orders.state`.
 *
 * `06 §7.2` promises that the order's state is a materialisation of its last event, and a
 * promise with no test is a hope. The reconciliation job runs this over recent orders; the
 * property test runs it over generated sequences.
 */
export function replay(events: readonly { fromState: OrderState; toState: OrderState }[], initialState: OrderState): OrderState {
  let state = initialState;
  for (const event of events) {
    if (event.fromState !== state) {
      throw new Error(`event log diverges: expected ${state}, event starts at ${event.fromState}`);
    }
    state = event.toState;
  }
  return state;
}

/** The guards a transition requires, for an explanation in the admin tower. */
export function requiredGuards(from: OrderState, to: OrderState): readonly GuardName[] {
  return findTransition(from, to)?.guards ?? [];
}
