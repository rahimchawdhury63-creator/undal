/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The order's states, and the three sets the platform reasons about.
 *
 * `LIVE` is the set that matters operationally: an order is live while somebody could still be
 * waiting on it, and the admin tower, the dispatch cascade and the cancellation sweep all need
 * the same answer to "is this order still happening". Deriving that set from the transition
 * table instead of typing it twice is why `liveStates()` exists below — a list that drifts from
 * the table is a bug that shows up as an order nobody chases.
 */

/** Every state `orders.state` can hold, exactly as `06 §7.3` names them. */
export const ORDER_STATES = [
  "DRAFT",
  "PLACED",
  "ACCEPTED",
  "RIDER_SEARCH",
  "RIDER_ASSIGNED",
  "REASSIGNING",
  "PICKED_UP",
  "ARRIVED",
  "DELIVERED",
  "SETTLED",
  "DISPUTED",
  "REJECTED",
  "CANCELLED_BY_CUSTOMER",
  "CANCELLED_BY_VENDOR",
  "CANCELLED_BY_ADMIN",
  "AUTO_CANCELLED",
] as const;

/** One state of an order. */
export type OrderState = (typeof ORDER_STATES)[number];

/** The actors that may drive a transition. */
export type OrderActor = "CUSTOMER" | "VENDOR" | "RIDER" | "ADMIN" | "SYSTEM";

/**
 * The states from which an order is finished.
 *
 * A disputed order is *not* terminal: money and reputation still hang on it, which is exactly
 * why `SETTLED` is a separate state rather than a flag.
 */
export const TERMINAL_STATES: readonly OrderState[] = ["SETTLED", "REJECTED", "CANCELLED_BY_CUSTOMER", "CANCELLED_BY_VENDOR", "CANCELLED_BY_ADMIN", "AUTO_CANCELLED"];

/** Whether an order in this state is finished for every purpose except reporting. */
export function isTerminal(state: OrderState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** Whether a state exists in the machine at all. */
export function isOrderState(value: string): value is OrderState {
  return (ORDER_STATES as readonly string[]).includes(value);
}
