/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The order-authorization port (`05 §4.3`, D82).
 *
 * Whether a caller may watch `order:UND-7K2M9QX4` is a question about that order's owner, its vendor and
 * the rider it was assigned to — three facts that live in `undal-core`'s order rows. Realtime holds no
 * order rows and may not read them, so the answer arrives through this port rather than a query.
 *
 * The port is deliberately one question, not a channel list: an authorizer that asks "may I watch these
 * eight channels" invites an implementation that answers the easiest one and allows the rest. One channel,
 * one answer.
 */

/** What the authorizer wants to know. */
export interface WatchQuestion {
  /** The caller's canonical 32-hex id. */
  readonly actorId: string;
  readonly actorType: "CUSTOMER" | "VENDOR_OWNER" | "RIDER" | "ADMIN";
  /** The public order code the channel names, e.g. `UND-7K2M9QX4`. */
  readonly orderId: string;
}

/** The port. `true` means the caller is party to that order. */
export interface OrderViewer {
  mayWatch(question: WatchQuestion): Promise<boolean>;
}

/**
 * The viewer that allows nothing.
 *
 * It is what a deployment without an internal token gets, and it is a refusal rather than a pass: somebody
 * watching an order's events sees the assigned rider, the customer's note and the money. A Worker that is
 * not wired to ask is a Worker that has not been told the answer.
 */
export const NO_ORDERS: OrderViewer = { mayWatch: async () => false };
