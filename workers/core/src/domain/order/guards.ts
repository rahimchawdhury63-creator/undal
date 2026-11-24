/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The guard predicates behind every transition of `06 §7.3`.
 *
 * Each guard answers one question about the world, and each is written as a plain predicate
 * over an explicit context rather than reading the database: the transition table has to be
 * evaluated identically by an HTTP handler, a DO alarm, a test and a replay. A guard that
 * touches the world is a guard that cannot be replayed, and replay is how the event log stays
 * trustworthy.
 *
 * A missing field is a failed guard, never a passed one — absence of evidence is not permission.
 */

/** Everything a guard may look at. Sparse on purpose: a transition names the fields it needs. */
export interface TransitionContext {
  /** Items in the cart at placement. */
  readonly cartItemCount?: number;
  readonly vendorApproved?: boolean;
  readonly vendorOpenState?: "OPEN" | "BUSY" | "CLOSED" | "PAUSED";
  readonly unavailableItemCount?: number;
  readonly addressZoneActive?: boolean;
  readonly customerBanned?: boolean;
  readonly fareQuotePresent?: boolean;
  /** The vendor on the order is the vendor making the request. */
  readonly vendorOwnsOrder?: boolean;
  readonly prepTimeSeconds?: number;
  readonly reasonCode?: string | null;
  readonly fulfilment?: "DELIVERY" | "PICKUP";
  /** Seconds since the order entered its current state. */
  readonly elapsedSeconds?: number;
  readonly vendorUnreachable?: boolean;
  readonly dispatchOpened?: boolean;
  readonly riderClaimedOffer?: boolean;
  readonly pickupCodeMatches?: boolean;
  readonly riderDistanceToVendorM?: number;
  readonly riderDistanceToCustomerM?: number;
  readonly cashCollectedPaisa?: number;
  readonly totalPaisa?: number;
  readonly varianceReason?: string | null;
  readonly minutesSinceDelivered?: number;
  readonly disputeOpen?: boolean;
  readonly adminDecided?: boolean;
}

/** A guard's verdict, with the reason a refusal names. */
export interface GuardVerdict {
  readonly ok: boolean;
  /** The failed guard's name, so a 409 says which rule refused. */
  readonly guard: string;
}

/** The geofence radius for a pickup scan, from `06 §7.3` and `11 §5`. */
export const PICKUP_GEOFENCE_M = 150;
/** The arrival radius. */
export const ARRIVAL_RADIUS_M = 80;
/** The vendor's prep-time window, in seconds. */
export const PREP_TIME_MIN_S = 300;
/** Four hours: beyond that the food is not being prepared, the vendor is guessing. */
export const PREP_TIME_MAX_S = 12_000;
/** How long a placement may sit with no vendor answer before it is auto-cancelled. */
export const VENDOR_UNREACHABLE_S = 120;
/** How long after acceptance a customer cancellation becomes free of a fee. */
export const FREE_CANCELLATION_S = 60;
/** How long a delivered order waits for a dispute before it settles. */
export const SETTLE_AFTER_DELIVERED_MIN = 15;

/** Every named guard, so the transition table can refer to one by name. */
export const GUARDS = {
  cartNotEmpty: (ctx: TransitionContext): GuardVerdict => verdict((ctx.cartItemCount ?? 0) > 0, "cartNotEmpty"),
  vendorApproved: (ctx: TransitionContext): GuardVerdict => verdict(ctx.vendorApproved === true, "vendorApproved"),
  vendorOpen: (ctx: TransitionContext): GuardVerdict =>
    verdict(ctx.vendorOpenState === "OPEN" || ctx.vendorOpenState === "BUSY", "vendorOpen"),
  itemsAvailable: (ctx: TransitionContext): GuardVerdict => verdict(ctx.unavailableItemCount === 0, "itemsAvailable"),
  zoneActive: (ctx: TransitionContext): GuardVerdict => verdict(ctx.addressZoneActive === true, "zoneActive"),
  customerNotBanned: (ctx: TransitionContext): GuardVerdict => verdict(ctx.customerBanned === false, "customerNotBanned"),
  quotePresent: (ctx: TransitionContext): GuardVerdict => verdict(ctx.fareQuotePresent === true, "quotePresent"),

  vendorOwnsOrder: (ctx: TransitionContext): GuardVerdict => verdict(ctx.vendorOwnsOrder === true, "vendorOwnsOrder"),
  prepTimeInWindow: (ctx: TransitionContext): GuardVerdict =>
    verdict(
      ctx.prepTimeSeconds !== undefined && ctx.prepTimeSeconds >= PREP_TIME_MIN_S && ctx.prepTimeSeconds <= PREP_TIME_MAX_S,
      "prepTimeInWindow",
    ),
  reasonCodePresent: (ctx: TransitionContext): GuardVerdict =>
    verdict(typeof ctx.reasonCode === "string" && ctx.reasonCode.length > 0, "reasonCodePresent"),

  vendorUnreachable: (ctx: TransitionContext): GuardVerdict =>
    verdict((ctx.elapsedSeconds ?? 0) >= VENDOR_UNREACHABLE_S && ctx.vendorUnreachable === true, "vendorUnreachable"),

  deliveryOnly: (ctx: TransitionContext): GuardVerdict => verdict(ctx.fulfilment === "DELIVERY", "deliveryOnly"),
  pickupOnly: (ctx: TransitionContext): GuardVerdict => verdict(ctx.fulfilment === "PICKUP", "pickupOnly"),
  dispatchOpened: (ctx: TransitionContext): GuardVerdict => verdict(ctx.dispatchOpened === true, "dispatchOpened"),
  riderClaimedOffer: (ctx: TransitionContext): GuardVerdict => verdict(ctx.riderClaimedOffer === true, "riderClaimedOffer"),

  pickupCodeMatches: (ctx: TransitionContext): GuardVerdict => verdict(ctx.pickupCodeMatches === true, "pickupCodeMatches"),
  riderNearVendor: (ctx: TransitionContext): GuardVerdict =>
    verdict(ctx.riderDistanceToVendorM !== undefined && ctx.riderDistanceToVendorM <= PICKUP_GEOFENCE_M, "riderNearVendor"),
  riderNearCustomer: (ctx: TransitionContext): GuardVerdict =>
    verdict(ctx.riderDistanceToCustomerM !== undefined && ctx.riderDistanceToCustomerM <= ARRIVAL_RADIUS_M, "riderNearCustomer"),

  cashRecorded: (ctx: TransitionContext): GuardVerdict => verdict(ctx.cashCollectedPaisa !== undefined, "cashRecorded"),
  cashReconciles: (ctx: TransitionContext): GuardVerdict =>
    verdict(
      ctx.cashCollectedPaisa === ctx.totalPaisa ||
        (typeof ctx.varianceReason === "string" && ctx.varianceReason.length > 0),
      "cashReconciles",
    ),

  disputeWindowClosed: (ctx: TransitionContext): GuardVerdict =>
    verdict((ctx.minutesSinceDelivered ?? 0) >= SETTLE_AFTER_DELIVERED_MIN && ctx.disputeOpen !== true, "disputeWindowClosed"),
  disputeWindowOpen: (ctx: TransitionContext): GuardVerdict => verdict((ctx.minutesSinceDelivered ?? 0) <= 24 * 60, "disputeWindowOpen"),
  adminDecided: (ctx: TransitionContext): GuardVerdict => verdict(ctx.adminDecided === true, "adminDecided"),
} as const;

/** The name of one guard. */
export type GuardName = keyof typeof GUARDS;

/** Run a named guard. */
export function runGuard(name: GuardName, ctx: TransitionContext): GuardVerdict {
  return GUARDS[name](ctx);
}

function verdict(ok: boolean, guard: string): GuardVerdict {
  return { ok, guard };
}

/**
 * Whether a cancellation from this state would charge the customer a fee.
 *
 * A fee applies after the vendor has accepted and sixty seconds have passed — the food may
 * already be in a pan. Exposed rather than inlined into the handler because the customer app
 * shows the fee *before* the button is pressed, and a second implementation of that rule is a
 * second answer to "will I be charged".
 */
export function cancellationFeeApplies(ctx: TransitionContext): boolean {
  return (ctx.elapsedSeconds ?? 0) > FREE_CANCELLATION_S;
}
