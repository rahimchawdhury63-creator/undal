/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Who else is watching an order, resolved from the row that knows (D106).
 *
 * `announce` reaches the order channel and the zone channel with the ids it is given. Reaching a vendor's or a
 * rider's *own* channel needs an identity rather than a row: `vendor:self` resolves to the vendor owner's user
 * id, and `rider:self` to the rider's user id. This module is the one place that translation happens, so three
 * routes do not each invent it.
 *
 * Two facts it encodes, both learned the hard way:
 *
 * - `orders.rider_id` **is** a user id (`routes/pickup.ts` compares it to `principal.userId`), so a rider needs
 *   no lookup at all. Only the vendor does, because a vendor row is owned by a user through `owner_user_id`.
 * - A failed lookup is an order with no audience, not an error. The announcement is a notification, and a
 *   database hiccup while resolving who to notify must not become a transition that fails; the caller still
 *   reaches the order channel and the zone, which is the whole of what D85 promised.
 */

import type { Ctx } from "../middleware/context.ts";
import { toHexId } from "../lib/ids.ts";
import { vendorOwnerUserId } from "../repositories/recipients.ts";

/** The audience of an order's announcement. */
export interface OrderAudience {
  readonly vendorUserId?: string;
  readonly riderUserId?: string;
}

/** What the caller knows about the order. */
export interface AudienceSource {
  /** The order's vendor row id, when the caller has it. */
  readonly vendorId: Uint8Array | null;
  /** The order's `rider_id`, when one is assigned — which is already a user id. */
  readonly riderUserIdHex: string | null;
}

/**
 * Resolve the audience for an order's announcement.
 *
 * Never throws. An unresolvable vendor produces no vendor audience, and the caller's announcement still goes to
 * the two channels that need no identity.
 */
export async function audienceForOrder(ctx: Ctx, source: AudienceSource): Promise<OrderAudience> {
  const audience: { vendorUserId?: string; riderUserId?: string } = {};
  if (source.riderUserIdHex !== null && source.riderUserIdHex !== "") {
    audience.riderUserId = source.riderUserIdHex;
  }
  if (source.vendorId !== null) {
    try {
      const owner = await vendorOwnerUserId(ctx.db, source.vendorId);
      if (owner !== null) audience.vendorUserId = toHexId(owner);
    } catch {
      // Deliberately quiet: the order channel and the zone still hear about the transition, and a notification
      // that could not name one more audience is a smaller failure than a notification that did not happen.
    }
  }
  return audience;
}
