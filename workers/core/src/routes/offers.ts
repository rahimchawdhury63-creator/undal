/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import * as audit from "../audit/write.ts";
import { announce } from "../bindings/announce.ts";
import { audienceForOrder } from "../bindings/audience.ts";
import { newId, toHexId } from "../lib/ids.ts";
import { parseDatetime, sqlDatetime } from "../db/time.ts";
import { failureResponse, successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { uuidBytes } from "../middleware/auth.ts";
import { applyTransition } from "../domain/order/lifecycle.ts";
import { findOrderByCode, moveState, nextEventSeq } from "../repositories/orders.ts";
import { findOffer, insertAssignment, respondToOffer, withdrawSiblingOffers } from "../repositories/offers.ts";
import { findRiderByUserId } from "../repositories/riders.ts";

/**
 * Claiming a delivery offer: `POST /v1/orders/{code}/offer/{offerId}/accept` (`08 §6`, `11 §7.3`, D113).
 *
 * This is the transition the whole dispatch half of the platform was waiting for: `RIDER_SEARCH →
 * RIDER_ASSIGNED` needs a rider who claimed an offer, and until this route existed no rider could claim one, so
 * the transition could not legally happen at all. The state machine, the catalogue name (`order.assigned`), the
 * audience helper and the offer rows all already existed.
 *
 * **The database is the arbiter, not a coordinator.** `11 §7.3` puts the atomic claim in the coordination layer,
 * and that remains the right place for *delivery* — pushing an alarm to fifty phones and stopping the wave early.
 * The claim itself is one conditional statement: `UPDATE orders … WHERE id = ? AND state = 'RIDER_SEARCH'`.
 * Exactly one of fifty concurrent claims can change that row, and the forty-nine losers receive `OFFER_CLAIMED`,
 * which they must anyway in order to stop ringing. A second arbiter would only create a second answer.
 *
 * **The order moves first and the offer records it second.** If both claims in a race arrive within a
 * millisecond, the `orders` row decides; the loser's offer is left for the withdraw below and its rider is told
 * `OFFER_CLAIMED`. Doing it the other way round would mark an offer accepted for a rider who then did not get
 * the order, which is a screen that says "yours" over food somebody else is collecting.
 *
 * **The winners' rivals are withdrawn in the same call.** `11 §7.2` ends a wave early on the first claim, and an
 * unanswered offer is a ringing alarm; leaving them `NULL` keeps fifty phones awake for a delivery that has been
 * assigned.
 */

/** The order state a claim is only legal from. */
const CLAIMABLE_STATE = "RIDER_SEARCH";

/** Claim an offer. */
async function acceptOffer(ctx: Ctx, orderCode: string, offerId: string): Promise<Response> {
  const principal = ctx.principal;
  if (principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);

  let offerBytes: Uint8Array;
  try {
    offerBytes = uuidBytes(offerId);
  } catch {
    return failureResponse({ code: "OFFER_NOT_FOUND", details: { offer_id: offerId } }, ctx.locale, ctx.requestId);
  }

  const row = await findOrderByCode(ctx.db, orderCode);
  // The offer is found first in the *decision* even though the order is found first in the code: an offer id
  // from another order must read as "no such offer here", not as a claim against a different order.
  if (row === null) return failureResponse({ code: "ORDER_NOT_FOUND" }, ctx.locale, ctx.requestId);

  const offer = await findOffer(ctx.db, offerBytes);
  if (offer === null || toHexId(offer.orderId) !== toHexId(row.id)) {
    return failureResponse({ code: "OFFER_NOT_FOUND", details: { offer_id: offerId } }, ctx.locale, ctx.requestId);
  }

  let userBytes: Uint8Array;
  try {
    userBytes = uuidBytes(principal.userId);
  } catch {
    return failureResponse({ code: "PERM_DENIED", details: { reason: "not_a_rider" } }, ctx.locale, ctx.requestId);
  }
  const rider = await findRiderByUserId(ctx.db, userBytes);
  if (rider === null) {
    return failureResponse({ code: "PERM_DENIED", details: { reason: "not_a_rider" } }, ctx.locale, ctx.requestId);
  }
  // An offer is addressed to a rider row; the token carries a user id. Reading the offer is the only way to
  // compare them, so an offer for somebody else is refused *after* it is read and never by guessing.
  if (toHexId(offer.riderId) !== toHexId(rider.id)) {
    return failureResponse({ code: "OFFER_NOT_TARGETED" }, ctx.locale, ctx.requestId);
  }

  const nowMs = Date.now();
  if (offer.response === "ACCEPTED") {
    // A second tap from the rider who already won: the same answer, no second write. The alternative — a 409 —
    // would make a flaky network look like a lost delivery.
    return successResponse(
      { orderId: toHexId(row.id), offerId: toHexId(offer.id), state: row.state, event: "order.assigned", repeated: true },
      ctx.locale,
      ctx.requestId,
    );
  }
  if (offer.response === "REJECTED") {
    return failureResponse({ code: "OFFER_ALREADY_REJECTED" }, ctx.locale, ctx.requestId);
  }
  if (offer.response !== null) {
    // `WITHDRAWN` or `EXPIRED`: somebody else's claim or the TTL ended it, and both read the same to the rider.
    return failureResponse({ code: "OFFER_CLAIMED" }, ctx.locale, ctx.requestId);
  }

  const expiresAt = parseDatetime(offer.expiresAt);
  if (expiresAt !== null && expiresAt.getTime() <= nowMs) {
    // Records the expiry so the sweep and the rider's screen agree, then answers with the TTL that passed.
    await respondToOffer(ctx.db, { offerId: offer.id, response: "EXPIRED", respondedAt: sqlDatetime(new Date(nowMs)) });
    return failureResponse(
      { code: "OFFER_EXPIRED", details: { expires_at: expiresAt.toISOString() } },
      ctx.locale,
      ctx.requestId,
    );
  }
  if (row.state !== CLAIMABLE_STATE) {
    // The order stopped searching between the offer and the tap: another rider won, or the vendor cancelled.
    return failureResponse({ code: "OFFER_CLAIMED" }, ctx.locale, ctx.requestId);
  }

  // `applyTransition` throws when the machine refuses, which for a claim the route has already checked is a
  // bug in this route rather than a client error — it is named as a race so the rider retries rather than being
  // told the offer was never theirs.
  let transition: ReturnType<typeof applyTransition>;
  try {
    transition = applyTransition({
      orderId: toHexId(row.id),
      from: row.state,
      to: "RIDER_ASSIGNED",
      actor: "SYSTEM",
      context: { riderClaimedOffer: true },
      nextSeq: await nextEventSeq(ctx.db, row.id),
      nowMs,
      reasonCode: null,
    });
  } catch {
    return failureResponse({ code: "OFFER_CLAIM_RACE" }, ctx.locale, ctx.requestId);
  }

  const moved = await moveState(ctx.db, {
    orderId: row.id,
    eventId: newId(nowMs),
    from: row.state,
    to: "RIDER_ASSIGNED",
    actor: "SYSTEM",
    actorUserId: userBytes,
    event: transition.event.event,
    reasonCode: null,
    reasonText: null,
    nowMs,
    extra: { rider_id: rider.id },
  });
  if (!moved.applied) return failureResponse({ code: "OFFER_CLAIMED" }, ctx.locale, ctx.requestId);

  const respondedAt = sqlDatetime(new Date(nowMs));
  await respondToOffer(ctx.db, { offerId: offer.id, response: "ACCEPTED", respondedAt });
  await withdrawSiblingOffers(ctx.db, { orderId: row.id, exceptOfferId: offer.id, respondedAt });
  await insertAssignment(ctx.db, { id: newId(nowMs), orderId: row.id, riderId: rider.id, assignedAt: respondedAt });

  await audit.appendAudit(ctx.db, {
    actorId: principal.userId,
    actorType: "RIDER",
    actorRole: principal.role,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    action: "order.offer.accept",
    resourceType: "ORDER",
    resourceId: toHexId(row.id),
    subjectId: toHexId(rider.id),
    before: { state: row.state, wave: offer.wave },
    after: { state: "RIDER_ASSIGNED", seq: moved.seq, payoutPaisa: offer.payoutPaisa },
    reason: null,
    severity: "NOTICE",
  }, nowMs);

  // The customer's screen, the vendor's and the zone's hear it, and the winning rider's own other devices
  // (D104/D106). The rider is the identity the token carries, which is what `rider:self` resolves to.
  ctx.waitUntil(
    (async () => {
      announce(ctx, {
        zoneId: toHexId(row.zone_id),
        orderId: row.code,
        event: transition.event.event,
        payload: { orderId: row.code, state: "RIDER_ASSIGNED", seq: moved.seq, riderId: toHexId(rider.id) },
        seq: moved.seq,
        audience: await audienceForOrder(ctx, { vendorId: row.vendor_id, riderUserIdHex: principal.userId }),
      });
    })(),
  );

  return successResponse(
    {
      orderId: toHexId(row.id),
      offerId: toHexId(offer.id),
      state: "RIDER_ASSIGNED",
      seq: moved.seq,
      event: transition.event.event,
      riderId: toHexId(rider.id),
    },
    ctx.locale,
    ctx.requestId,
  );
}

/**
 * The offer routes.
 *
 * `order.deliver` is the key rather than a new `order.offer.accept`: accepting is the first act of delivering,
 * the register's `order.offer.*` keys are the dispatch-side half of the surface (`create`, `expire`, `cancel`,
 * `view_rider_identity`), and minting a rider-facing key per verb would be a fourth addition to a register that
 * claims to match the specification. D113 records the reasoning.
 */
export const OFFER_ROUTES: readonly RouteDefinition[] = [
  {
    method: "POST",
    path: "/v1/orders/{code}/offer/{offerId}/accept",
    permission: "order.deliver",
    write: true,
    group: "ORDER_WRITE",
    maxBodyBytes: 512,
    run: async (ctx, input) => acceptOffer(ctx, input.params["code"] ?? "", input.params["offerId"] ?? ""),
  },
];
