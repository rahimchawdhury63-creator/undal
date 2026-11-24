/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { newId, toHexId } from "../../lib/ids.ts";

import { applyTransition, type OrderStateEvent, type TransitionEffects } from "./lifecycle.ts";
import type { TransitionContext } from "./guards.ts";
import { diffQuote, sameItems, verifyQuoteToken, type PriceDiff, type QuotedItem, type QuoteSnapshot, type QuoteTotals } from "./quote.ts";
import type { OrderState } from "./states.ts";

/**
 * Placement: the moment a cart becomes an order, and the moment a price must stop moving.
 *
 * The rule this module exists to enforce is one sentence long: *the customer is charged the price
 * they were shown, or they are told what changed before anything is written*. Everything else —
 * the row shape, the code, the event — is bookkeeping around that rule.
 *
 * The re-price is supplied by the caller rather than computed here, because the honest price comes
 * from the Brain (or from its deterministic fallback), and a placement module that could compute a
 * price would be a second pricing engine with its own opinions.
 */

/** The price as the platform would compute it right now. */
export interface CurrentPrice {
  readonly totals: QuoteTotals;
  readonly items: readonly QuotedItem[];
  readonly surgeBps: number;
  readonly fareSource: "BRAIN" | "FALLBACK" | "ADMIN_OVERRIDE";
}

/** Everything the client sent. */
export interface PlacementRequest {
  readonly quoteToken: string;
  readonly customerId: string;
  readonly vendorId: string;
  readonly zoneId: string;
  readonly fulfilment: "DELIVERY" | "PICKUP";
  readonly customerNote: string | null;
  readonly pickupPointE7: { readonly latE7: number; readonly lonE7: number };
  readonly deliveryPointE7: { readonly latE7: number; readonly lonE7: number } | null;
}

/** The order row this placement would write, before ids are assigned. */
export interface OrderDraft {
  readonly id: string;
  readonly code: string;
  readonly customerUserId: string;
  readonly vendorId: string;
  readonly zoneId: string;
  readonly fulfilment: "DELIVERY" | "PICKUP";
  readonly state: OrderState;
  readonly pickupLatE7: number;
  readonly pickupLonE7: number;
  readonly deliveryLatE7: number | null;
  readonly deliveryLonE7: number | null;
  readonly customerNote: string | null;
  readonly paymentMethod: "COD";
  readonly fareSource: "BRAIN" | "FALLBACK" | "ADMIN_OVERRIDE";
  readonly surgeBps: number;
  readonly weatherCondition: string;
  readonly routeDistanceM: number;
  readonly routeDurationS: number;
  readonly trafficDelayS: number;
  readonly placedAtIso: string;
  readonly totals: QuoteTotals;
}

/** A refused placement: a code the app renders and, where relevant, the lines that moved. */
export class PlacementRefused extends Error {
  readonly code: "QUOTE_EXPIRED" | "QUOTE_MISMATCH" | "QUOTE_ALREADY_USED" | "QUOTE_INGREDIENTS_CHANGED";
  readonly diffs: readonly PriceDiff[];

  constructor(code: PlacementRefused["code"], diffs: readonly PriceDiff[] = []) {
    super(`placement refused: ${code}`);
    this.name = "PlacementRefused";
    this.code = code;
    this.diffs = diffs;
  }
}

/** What a successful placement produces. */
export interface PlacementPlan {
  readonly order: OrderDraft;
  readonly event: OrderStateEvent;
  readonly effects: TransitionEffects;
  readonly quote: QuoteSnapshot;
  /** The cash the rider will collect; for a COD platform this is the whole point. */
  readonly cashDuePaisa: number;
}

/** The context the `DRAFT → PLACED` guards read, filled from the request and the caller's checks. */
export interface PlacementContext extends TransitionContext {
  readonly vendorApproved: boolean;
  readonly vendorOpenState: "OPEN" | "BUSY" | "CLOSED" | "PAUSED";
  readonly unavailableItemCount: number;
  readonly addressZoneActive: boolean;
  readonly customerBanned: boolean;
}

/**
 * Plan a placement, or refuse it.
 *
 * Order of checks, and why: signature first (a token we did not issue cannot be re-priced), then
 * age, then the cart, then the money. A stale token is `QUOTE_EXPIRED` even if the price happens
 * to match, because the five-minute promise is about *when* the customer agreed, and honouring a
 * six-minute-old price teaches clients to ignore the window.
 */
export async function planPlacement(input: {
  readonly request: PlacementRequest;
  readonly price: CurrentPrice;
  readonly context: PlacementContext;
  readonly secret: string;
  readonly nowMs: number;
  readonly nextSeq: number;
}): Promise<PlacementPlan> {
  const verdict = await verifyQuoteToken(input.request.quoteToken, input.secret, input.nowMs);
  if (!verdict.ok) throw new PlacementRefused(verdict.code);

  const quoted = verdict.snapshot;
  // A guest may price a cart (`08 §4`), and the customer who signs in to place it claims the quote:
  // an unclaimed quote is claimable, a claimed one belongs to exactly one customer. A quote can
  // therefore never be released to a second account, which is what makes it safe to hand out before
  // the customer has an account at all.
  const claimable = quoted.customerId === "" || quoted.customerId === input.request.customerId;
  if (!claimable || quoted.vendorId !== input.request.vendorId) throw new PlacementRefused("QUOTE_MISMATCH");
  if (!sameItems(quoted.items, input.price.items)) {
    // The ingredients changed under the customer: a different cart is not a price problem, and
    // telling them "the total changed" when the item is gone would be a lie they can see.
    throw new PlacementRefused("QUOTE_INGREDIENTS_CHANGED");
  }

  const diffs = diffQuote(quoted.totals, input.price.totals);
  if (diffs.length > 0) throw new PlacementRefused("QUOTE_MISMATCH", diffs);

  const outcome = applyTransition({
    orderId: quoted.quoteId,
    from: "DRAFT",
    to: "PLACED",
    actor: "CUSTOMER",
    context: { ...input.context, cartItemCount: input.price.items.length, fareQuotePresent: true, fulfilment: input.request.fulfilment },
    nextSeq: input.nextSeq,
    nowMs: input.nowMs,
  });

  const id = toHexId(newId(input.nowMs));

  return {
    order: {
      id,
      code: orderCode(id),
      customerUserId: input.request.customerId,
      vendorId: input.request.vendorId,
      zoneId: input.request.zoneId,
      fulfilment: input.request.fulfilment,
      state: outcome.state,
      pickupLatE7: input.request.pickupPointE7.latE7,
      pickupLonE7: input.request.pickupPointE7.lonE7,
      deliveryLatE7: input.request.deliveryPointE7?.latE7 ?? null,
      deliveryLonE7: input.request.deliveryPointE7?.lonE7 ?? null,
      customerNote: input.request.customerNote,
      paymentMethod: "COD",
      fareSource: input.price.fareSource,
      surgeBps: input.price.surgeBps,
      weatherCondition: quoted.weatherCondition,
      routeDistanceM: quoted.routeDistanceM,
      routeDurationS: quoted.routeDurationS,
      trafficDelayS: quoted.trafficDelayS,
      placedAtIso: new Date(input.nowMs).toISOString(),
      totals: quoted.totals,
    },
    event: outcome.event,
    effects: outcome.effects,
    quote: quoted,
    cashDuePaisa: quoted.totals.totalPaisa,
  };
}

/**
 * The order code the customer reads down a phone line: `UND-` and eight characters.
 *
 * Derived from the order's own id rather than from a counter, because two Workers placing orders
 * at the same millisecond must not race for the same code, and a counter needs a lock in a
 * platform that deliberately has no interactive transactions.
 */
export function orderCode(id: string, prefix = "UND"): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const clean = id.replace(/-/gu, "");
  let out = "";
  for (let index = 0; index < 8; index += 1) {
    const pair = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
    out += alphabet[pair % alphabet.length];
  }
  return `${prefix}-${out}`;
}
