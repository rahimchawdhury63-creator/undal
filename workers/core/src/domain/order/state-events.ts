/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { newId, toHexId } from "../../lib/ids.ts";
import { toSqlDateTime } from "../../lib/time.ts";

import { findTransition } from "./state-machine.ts";
import type { OrderActor, OrderState } from "./states.ts";

/**
 * The order's history, as rows and as the frames the apps receive.
 *
 * `order_state_events` is the only durable record of what happened to an order: `orders.state` says
 * where it is now, and this table says how it got there, who moved it and why. Everything a support
 * agent, a dispute or an audit ever needs comes from here, which is why a transition that skips its
 * event row is a bug and not a shortcut.
 *
 * The SSE frame is derived from a row rather than composed at the call site, so the live map and the
 * database can never tell two different stories about the same order.
 */

/** One row for `order_state_events`. */
export interface StateEventDraft {
  readonly id: string;
  readonly orderId: string;
  readonly seq: number;
  readonly fromState: OrderState | null;
  readonly toState: OrderState;
  readonly actorType: OrderActor;
  /** Null for `SYSTEM`, and for a vendor actor whose user row was later removed. */
  readonly actorUserId: string | null;
  readonly reasonCode: string | null;
  readonly reasonText: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

/** What a caller knows when it moves an order. */
export interface StateEventInput {
  readonly orderId: string;
  readonly seq: number;
  readonly fromState: OrderState | null;
  readonly toState: OrderState;
  readonly actor: OrderActor;
  readonly actorUserId?: string | null | undefined;
  readonly reasonCode?: string | null | undefined;
  readonly reasonText?: string | null | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly occurredAtMs?: number | undefined;
}

/**
 * Build the event row.
 *
 * `metadata` is written as `{}` at minimum because the column is `JSON NOT NULL` and a null there
 * has bitten every system that ever tried it; the empty object is the honest way to say "nothing
 * extra happened". A reason code is kept verbatim — it is already one of the thirty-eight codes the
 * app renders, and translation belongs at the edge, not in the ledger.
 */
export function buildStateEvent(input: StateEventInput): StateEventDraft {
  if (!Number.isInteger(input.seq) || input.seq < 1) throw new RangeError(`event seq must be a positive integer, got ${input.seq}`);
  if (input.actor === "SYSTEM" && input.actorUserId !== null && input.actorUserId !== undefined)
    throw new Error("a SYSTEM transition carries no user; who acted is the scheduler, not a person");

  return {
    id: toHexId(newId()),
    orderId: input.orderId,
    seq: input.seq,
    fromState: input.fromState,
    toState: input.toState,
    actorType: input.actor,
    actorUserId: input.actorUserId ?? null,
    reasonCode: input.reasonCode ?? null,
    reasonText: input.reasonText ?? null,
    metadata: input.metadata ?? {},
    occurredAt: toSqlDateTime(new Date(input.occurredAtMs ?? Date.now())),
  };
}

/** The SSE event name for this move, taken from the machine rather than re-mapped here. */
export function sseEventName(fromState: OrderState | null, toState: OrderState): string {
  if (fromState === null) return "order.created";
  const transition = findTransition(fromState, toState);
  if (transition === null) throw new Error(`no transition ${fromState} -> ${toState}, so there is no event to name`);
  return transition.event;
}

/** The channel one order publishes on. Each client subscribes to exactly the orders it may see. */
export function orderTopic(orderId: string): string {
  return `order:${orderId}`;
}

/**
 * The frame the customer, vendor and rider apps fold into their cached order.
 *
 * It carries the state and the money together because the two change together: an app that updated
 * the badge but not the total would show a delivered order with a stale price, and the customer
 * would screenshot it and be right.
 */
export function sseFrame(event: StateEventDraft, money: { readonly totalPaisa: number; readonly cashCollectedPaisa: number | null }): Readonly<Record<string, unknown>> {
  return {
    id: event.id,
    type: sseEventName(event.fromState, event.toState),
    orderId: event.orderId,
    seq: event.seq,
    fromState: event.fromState,
    toState: event.toState,
    actorType: event.actorType,
    reasonCode: event.reasonCode,
    totalPaisa: money.totalPaisa,
    cashCollectedPaisa: money.cashCollectedPaisa,
    occurredAt: event.occurredAt,
    metadata: event.metadata,
  };
}

/**
 * Whether a replayed history is contiguous.
 *
 * Sequence numbers are dense by construction (`uq_order_events_seq` plus `nextEventSeq`), so a gap
 * means a row was deleted or an insert failed after the state update. Either is a settlement
 * incident, and detecting it here is cheaper than discovering it in a dispute six weeks later.
 */
export function firstGap(seqs: readonly number[]): number | null {
  const ordered = [...seqs].sort((left, right) => left - right);
  for (let index = 0; index < ordered.length; index += 1) {
    const expected = index + 1;
    if (ordered[index] !== expected) return expected;
  }
  return null;
}
