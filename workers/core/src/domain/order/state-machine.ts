/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { ErrorCode } from "@undal/contracts";

import type { GuardName, TransitionContext } from "./guards.ts";
import { runGuard } from "./guards.ts";
import { isOrderState, isTerminal, ORDER_STATES, type OrderActor, type OrderState } from "./states.ts";

/**
 * The transition table of `06 §7.3`, as data.
 *
 * The table is the specification, so it is the code: one row per edge, each carrying the actors
 * that may drive it and the guards that must hold. Handlers do not contain `if (state === …)`
 * chains — they ask this module, which means an illegal edge is refused identically whether it
 * arrives from the customer app, the vendor app, the rider app, the admin panel or an alarm.
 *
 * The wildcard row ("any live → `CANCELLED_BY_ADMIN`") is expanded at load rather than
 * implemented as a special case, so the coverage test can enumerate every edge that exists.
 */

/** One edge of the machine. */
export interface Transition {
  readonly from: OrderState;
  readonly to: OrderState;
  readonly actors: readonly OrderActor[];
  readonly guards: readonly GuardName[];
  /** The SSE topic suffix the transition publishes, if any. */
  readonly event: string;
}

/** Why a transition was refused. */
export type RefusalKind = "ILLEGAL_EDGE" | "ACTOR_NOT_PERMITTED" | "GUARD_FAILED";

/** A refused transition, carrying the code the API answers with. */
export class TransitionRefused extends Error {
  readonly kind: RefusalKind;
  readonly from: OrderState;
  readonly to: OrderState;
  readonly guard: GuardName | null;
  readonly code: ErrorCode;

  constructor(kind: RefusalKind, from: OrderState, to: OrderState, guard: GuardName | null, code: ErrorCode) {
    super(`order cannot move ${from} → ${to}: ${kind}${guard === null ? "" : ` (${guard})`}`);
    this.name = "TransitionRefused";
    this.kind = kind;
    this.from = from;
    this.to = to;
    this.guard = guard;
    this.code = code;
  }
}

const EXPLICIT: readonly Transition[] = [
  {
    from: "DRAFT",
    to: "PLACED",
    actors: ["CUSTOMER"],
    guards: ["cartNotEmpty", "vendorApproved", "vendorOpen", "itemsAvailable", "zoneActive", "customerNotBanned", "quotePresent"],
    event: "order.placed",
  },
  { from: "PLACED", to: "ACCEPTED", actors: ["VENDOR"], guards: ["vendorOwnsOrder", "prepTimeInWindow"], event: "order.accepted" },
  { from: "PLACED", to: "REJECTED", actors: ["VENDOR"], guards: ["vendorOwnsOrder", "reasonCodePresent"], event: "order.rejected" },
  { from: "PLACED", to: "AUTO_CANCELLED", actors: ["SYSTEM"], guards: ["vendorUnreachable"], event: "order.cancelled" },
  { from: "PLACED", to: "CANCELLED_BY_CUSTOMER", actors: ["CUSTOMER"], guards: [], event: "order.cancelled" },
  { from: "ACCEPTED", to: "RIDER_SEARCH", actors: ["SYSTEM"], guards: ["deliveryOnly", "dispatchOpened"], event: "order.searching" },
  { from: "ACCEPTED", to: "PICKED_UP", actors: ["CUSTOMER"], guards: ["pickupOnly", "pickupCodeMatches"], event: "order.picked_up" },
  { from: "ACCEPTED", to: "CANCELLED_BY_CUSTOMER", actors: ["CUSTOMER"], guards: [], event: "order.cancelled" },
  { from: "ACCEPTED", to: "CANCELLED_BY_VENDOR", actors: ["VENDOR"], guards: ["vendorOwnsOrder", "reasonCodePresent"], event: "order.cancelled" },
  { from: "RIDER_SEARCH", to: "RIDER_ASSIGNED", actors: ["SYSTEM"], guards: ["riderClaimedOffer"], event: "order.assigned" },
  { from: "RIDER_SEARCH", to: "CANCELLED_BY_ADMIN", actors: ["ADMIN"], guards: ["reasonCodePresent"], event: "order.cancelled" },
  { from: "RIDER_ASSIGNED", to: "PICKED_UP", actors: ["RIDER"], guards: ["pickupCodeMatches", "riderNearVendor"], event: "order.picked_up" },
  { from: "RIDER_ASSIGNED", to: "REASSIGNING", actors: ["RIDER", "ADMIN", "SYSTEM"], guards: [], event: "order.reassigning" },
  { from: "REASSIGNING", to: "RIDER_SEARCH", actors: ["SYSTEM"], guards: [], event: "order.searching" },
  { from: "PICKED_UP", to: "ARRIVED", actors: ["RIDER", "SYSTEM"], guards: [], event: "order.arrived" },
  { from: "PICKED_UP", to: "DISPUTED", actors: ["ADMIN"], guards: ["reasonCodePresent"], event: "order.disputed" },
  // A pickup has no rider, so collecting the food finishes the order. The document's table
  // never says so — it moves pickups from ACCEPTED to PICKED_UP and then has no row that fits —
  // and an order that cannot reach a terminal state is an order whose cash never settles (D60).
  { from: "PICKED_UP", to: "DELIVERED", actors: ["SYSTEM"], guards: ["pickupOnly", "cashRecorded", "cashReconciles"], event: "order.delivered" },
  { from: "ARRIVED", to: "DELIVERED", actors: ["RIDER"], guards: ["cashRecorded", "cashReconciles"], event: "order.delivered" },
  { from: "DELIVERED", to: "SETTLED", actors: ["SYSTEM"], guards: ["disputeWindowClosed"], event: "order.settled" },
  { from: "DELIVERED", to: "DISPUTED", actors: ["CUSTOMER", "ADMIN"], guards: ["disputeWindowOpen"], event: "order.disputed" },
  { from: "DISPUTED", to: "SETTLED", actors: ["ADMIN"], guards: ["adminDecided"], event: "order.settled" },
];

/**
 * The states an admin may cancel from: everything that is not already finished, and not already
 * carrying an explicit admin-cancel row — a wildcard that duplicates a row is a table with two
 * sources of truth for one edge, and the coverage sweep would pass while one of them was wrong.
 */
const ADMIN_CANCELLABLE: readonly OrderState[] = ORDER_STATES.filter(
  (state) => !isTerminal(state) && !EXPLICIT.some((row) => row.from === state && row.to === "CANCELLED_BY_ADMIN"),
);

/**
 * The whole machine: the explicit rows plus the admin-cancel wildcard, expanded once.
 *
 * Exported so the coverage test can enumerate it and so the admin panel can draw the graph
 * without a second copy of the table.
 */
export const TRANSITIONS: readonly Transition[] = [
  ...EXPLICIT,
  ...ADMIN_CANCELLABLE.map((state) => ({
    from: state,
    to: "CANCELLED_BY_ADMIN" as const,
    actors: ["ADMIN"] as const,
    guards: ["reasonCodePresent"] as const,
    event: "order.cancelled",
  })),
];

/** Every edge leaving a state. */
export function transitionsFrom(from: OrderState): readonly Transition[] {
  return TRANSITIONS.filter((row) => row.from === from);
}

/** The edge between two states, if one exists. */
export function findTransition(from: OrderState, to: OrderState): Transition | null {
  return TRANSITIONS.find((row) => row.from === from && row.to === to) ?? null;
}

/** The states reachable in one step. */
export function legalTargets(from: OrderState): readonly OrderState[] {
  return transitionsFrom(from).map((row) => row.to);
}

/** A verdict on a proposed transition. */
export interface TransitionVerdict {
  readonly allowed: boolean;
  readonly transition: Transition | null;
  readonly refusal: RefusalKind | null;
  readonly guard: GuardName | null;
}

/**
 * Answer whether a transition may happen, and if not, why.
 *
 * Returns a verdict rather than throwing because two callers need the answer without an
 * exception: the customer app asks "can I still cancel", and the admin tower asks "which orders
 * are stuck". `assertTransition` is the throwing form, for the handlers.
 */
export function canTransition(from: OrderState, to: OrderState, actor: OrderActor, ctx: TransitionContext): TransitionVerdict {
  const transition = findTransition(from, to);
  if (transition === null) return { allowed: false, transition: null, refusal: "ILLEGAL_EDGE", guard: null };
  if (!transition.actors.includes(actor)) return { allowed: false, transition, refusal: "ACTOR_NOT_PERMITTED", guard: null };

  for (const name of transition.guards) {
    const result = runGuard(name, ctx);
    if (!result.ok) return { allowed: false, transition, refusal: "GUARD_FAILED", guard: name };
  }
  return { allowed: true, transition, refusal: null, guard: null };
}

/**
 * The error code for a refusal.
 *
 * The API answers with a code the app already knows how to render, and the mapping lives here so
 * that a new edge cannot invent one: an illegal edge is a client bug (`ORDER_NOT_ACCEPTABLE`), a
 * failed cash guard is a mismatch (`ORDER_TOTAL_CHANGED`), and everything else is a refusal of
 * the action that was attempted.
 */
export function refusalCode(kind: RefusalKind, guard: GuardName | null): ErrorCode {
  if (kind === "ILLEGAL_EDGE") return "ORDER_NOT_ACCEPTABLE";
  if (guard === "cashReconciles") return "ORDER_TOTAL_CHANGED";
  if (guard === "reasonCodePresent") return "ORDER_REJECT_REASON_REQUIRED";
  if (guard === "prepTimeInWindow") return "ORDER_PREP_TIME_OUT_OF_RANGE";
  if (guard === "pickupCodeMatches") return "ORDER_DELIVERY_CODE_INVALID";
  if (guard === "vendorOwnsOrder") return "ORDER_NOT_YOURS";
  return "ORDER_CANNOT_CANCEL";
}

/** Throw unless the transition is allowed. The form every mutating handler uses. */
export function assertTransition(from: OrderState, to: OrderState, actor: OrderActor, ctx: TransitionContext): Transition {
  if (!isOrderState(from) || !isOrderState(to)) {
    throw new TransitionRefused("ILLEGAL_EDGE", from, to, null, "ORDER_NOT_ACCEPTABLE");
  }
  const verdict = canTransition(from, to, actor, ctx);
  if (!verdict.allowed || verdict.transition === null) {
    throw new TransitionRefused(verdict.refusal ?? "ILLEGAL_EDGE", from, to, verdict.guard, refusalCode(verdict.refusal ?? "ILLEGAL_EDGE", verdict.guard));
  }
  return verdict.transition;
}
