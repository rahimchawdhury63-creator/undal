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
import { requireInternalToken } from "../middleware/internal-token.ts";
import { applyTransition } from "../domain/order/lifecycle.ts";
import { findOrderByCode, moveState, nextEventSeq } from "../repositories/orders.ts";
import {
  countRejectionOnShift,
  expireOffers,
  findOffer,
  insertAssignment,
  liveOffersFor,
  respondToOffer,
  withdrawSiblingOffers,
} from "../repositories/offers.ts";
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

/** The reasons a rider may give (`11 §9.2`), in the order the sheet shows them. `NO_ALTERNATIVE_FORCED` is the
 * system's own reason and is deliberately absent: a rider cannot claim the machine told them not to. */
export const REJECT_REASONS: readonly string[] = [
  "TOO_FAR",
  "PAYOUT_LOW",
  "VENDOR_SLOW",
  "VEHICLE_ISSUE",
  "TAKING_BREAK",
  "AREA_UNSAFE",
  "ORDER_TOO_LARGE",
  "CASH_LIMIT",
  "OTHER",
];

/** `OTHER` is the one reason that requires the free text, per `11 §9.2`. */
const REASON_NEEDS_NOTE = "OTHER";
/** `reject_note` is `VARCHAR(280)`; `reject_reason` is `VARCHAR(48)`. */
export const MAX_REJECT_NOTE = 280;

/**
 * Declining a delivery offer: `POST /v1/orders/{code}/offer/{offerId}/reject` (`11 §9.2`, D114).
 *
 * The pair of the claim, and its opposite in every way that matters: the order does **not** move — it is still
 * searching, and the next wave or the next rider will hear about it — so this route writes one row (the answer)
 * and one counter (the shift's `orders_rejected`) and nothing else.
 *
 * **The reason is required, and `OTHER` is required to say something.** `11 §9.2` lists nine rider-facing
 * reasons and a tenth the system uses; the refusal carries the list so the app can render the sheet from the API
 * rather than from a copy that drifts. `OFFER_REASON_REQUIRED` is 422 and carries `{allowed}` — a client that
 * sends a tenth reason of its own invention gets the list back, which is more useful than "invalid".
 *
 * **No reason carries a direct penalty**, and that is a design constraint on this route rather than a comment:
 * it writes no suspension, no lock and no score. The consequence is the counter, and the counter is what
 * `11 §9`'s acceptance factor reads. A route that punished a rider for `AREA_UNSAFE` would be the dark pattern
 * `11 §9.1` explicitly refuses.
 *
 * **The effects of the interesting reasons are not written here.** `VENDOR_SLOW` implies a 45-minute cooldown for
 * that vendor and `AREA_UNSAFE` a permanent per-cell exclusion; both are dispatch state that the engine owns, and
 * inventing them in this route would put a policy where the data is. They are recorded on the offer (reason and
 * note) for whoever builds that, and listed as open in D114.
 */
async function rejectOffer(ctx: Ctx, orderCode: string, offerId: string, body: unknown): Promise<Response> {
  const principal = ctx.principal;
  if (principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);

  const fields = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const reason = typeof fields["reason"] === "string" ? fields["reason"] : "";
  const noteRaw = fields["note"];
  if (noteRaw !== undefined && typeof noteRaw !== "string") {
    return failureResponse({ code: "VALIDATION_FAILED", details: { field: "note" } }, ctx.locale, ctx.requestId);
  }
  const note = typeof noteRaw === "string" ? noteRaw.trim() : "";
  if (note.length > MAX_REJECT_NOTE) {
    return failureResponse({ code: "VALIDATION_FAILED", details: { field: "note" } }, ctx.locale, ctx.requestId);
  }
  if (!REJECT_REASONS.includes(reason) || (reason === REASON_NEEDS_NOTE && note === "")) {
    return failureResponse({ code: "OFFER_REASON_REQUIRED", details: { allowed: REJECT_REASONS } }, ctx.locale, ctx.requestId);
  }

  let offerBytes: Uint8Array;
  try {
    offerBytes = uuidBytes(offerId);
  } catch {
    return failureResponse({ code: "OFFER_NOT_FOUND", details: { offer_id: offerId } }, ctx.locale, ctx.requestId);
  }

  const row = await findOrderByCode(ctx.db, orderCode);
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
  if (toHexId(offer.riderId) !== toHexId(rider.id)) {
    return failureResponse({ code: "OFFER_NOT_TARGETED" }, ctx.locale, ctx.requestId);
  }

  const nowMs = Date.now();
  if (offer.response === "REJECTED") return failureResponse({ code: "OFFER_ALREADY_REJECTED" }, ctx.locale, ctx.requestId);
  if (offer.response !== null) {
    // Accepted, withdrawn or expired: the offer has an answer and a second one would rewrite somebody's decision.
    const code = offer.response === "EXPIRED" ? "OFFER_EXPIRED" : "OFFER_REJECT_NOT_ALLOWED";
    return failureResponse({ code, details: { state: row.state } }, ctx.locale, ctx.requestId);
  }

  const expiresAt = parseDatetime(offer.expiresAt);
  if (expiresAt !== null && expiresAt.getTime() <= nowMs) {
    await respondToOffer(ctx.db, { offerId: offer.id, response: "EXPIRED", respondedAt: sqlDatetime(new Date(nowMs)) });
    return failureResponse({ code: "OFFER_EXPIRED", details: { expires_at: expiresAt.toISOString() } }, ctx.locale, ctx.requestId);
  }
  // The order may already have been claimed by another rider between the offer and this tap.
  if (row.state !== CLAIMABLE_STATE) {
    return failureResponse({ code: "OFFER_REJECT_NOT_ALLOWED", details: { state: row.state } }, ctx.locale, ctx.requestId);
  }

  const respondedAt = sqlDatetime(new Date(nowMs));
  const answered = await respondToOffer(ctx.db, {
    offerId: offer.id,
    response: "REJECTED",
    respondedAt,
    rejectReason: reason,
  });
  // Someone answered first (two taps, or the TTL in another request): the loser is told the answer exists.
  if (answered === 0) return failureResponse({ code: "OFFER_ALREADY_REJECTED" }, ctx.locale, ctx.requestId);

  const counted = await countRejectionOnShift(ctx.db, rider.id);

  await audit.appendAudit(ctx.db, {
    actorId: principal.userId,
    actorType: "RIDER",
    actorRole: principal.role,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
    action: "order.offer.reject",
    resourceType: "ORDER",
    resourceId: toHexId(row.id),
    subjectId: toHexId(rider.id),
    before: { state: row.state, wave: offer.wave },
    after: { response: "REJECTED", reason, note: note === "" ? null : note, countedIn: counted > 0 ? "shift" : "none" },
    reason,
    severity: "NOTICE",
  }, nowMs);

  return successResponse(
    {
      orderId: toHexId(row.id),
      offerId: toHexId(offer.id),
      response: "REJECTED",
      reason,
      // The order did not move, and saying so is the contract: the app must not close its own screen assuming
      // the delivery is gone from the platform as well as from the phone.
      state: row.state,
    },
    ctx.locale,
    ctx.requestId,
  );
}

/**
 * The rider's pending offers: `GET /v1/rider/offers` (`08 §8`, D115).
 *
 * The FCM payload is authoritative and this is the reconciliation the doc names — called when a notification was
 * missed, a screen was backgrounded, or a rider wants to be sure nothing is ringing. It deliberately does **not**
 * include history: an offer that has been answered or has expired is not a pending decision, and a rider looking
 * at a list of dead deliveries cannot take any of them.
 *
 * The answer carries `secondsRemaining` per offer. The client could subtract from `expiresAt`, and it would be
 * wrong on a phone whose clock is a minute out — which is exactly the phone that needs this endpoint. The
 * server's own clock travels with the answer instead.
 */
async function listOffers(ctx: Ctx): Promise<Response> {
  const principal = ctx.principal;
  if (principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);

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

  const nowMs = Date.now();
  const offers = await liveOffersFor(ctx.db, rider.id, nowMs);
  return successResponse(
    {
      serverTimeMs: nowMs,
      offers: offers.map((offer) => ({
        offerId: offer.offerId,
        orderId: offer.orderId,
        orderCode: offer.orderCode,
        wave: offer.wave,
        payoutPaisa: offer.payoutPaisa,
        expiresAt: new Date(offer.expiresAtMs).toISOString(),
        secondsRemaining: Math.max(0, Math.round((offer.expiresAtMs - nowMs) / 1_000)),
      })),
    },
    ctx.locale,
    ctx.requestId,
  );
}

/**
 * Expire the offers whose time ran out: `POST /internal/offers/expire` (`11 §9.3`, D116).
 *
 * Internal, behind the shared token, because the caller is the platform and not a person: the zone's alarm is
 * the only thing in the system that runs while riders are connected, and it already reaches core this way for
 * the auto-cancel ladder. A rider endpoint would be a rider sweeping other riders' offers.
 *
 * **Why a sweep at all, when time is already checked twice.** The rider's list excludes a past-TTL offer and the
 * claim route refuses one, both by comparing `expires_at` with now. Those are answers about *the moment of
 * asking*. The row is the answer about what happened, and `11 §9.3` needs it: an expiry counts against a rider's
 * acceptance at half the weight of a refusal, and the acceptance factor is computed from rows. A sweep that never
 * runs would leave the dispatch statistics quietly optimistic — every abandoned offer invisible.
 *
 * **It reports the waves, not just a count.** `{ expired: 3, waves: [2] }` tells a caller that a whole wave timed
 * out (a signal about the zone) rather than that three riders were slow (a signal about three riders). The
 * distinction is the whole of `11 §7`'s wave model and it costs one extra `SELECT DISTINCT`.
 */
async function expireDueOffers(ctx: Ctx): Promise<Response> {
  // The route is declared anonymous so the pipeline does not demand a session from a Worker; its first act is
  // the shared token, and an absent token is a refusal rather than a wildcard (D82).
  const refused = requireInternalToken(ctx);
  if (refused !== null) return refused;
  const nowMs = Date.now();
  const swept = await expireOffers(ctx.db, nowMs);
  if (swept.expired > 0) {
    // Not an audit row: an expiry is the absence of a decision, and a ledger of things that did not happen is a
    // ledger nobody reads. The `order_offers` rows are the record, and the audit chain stays about people.
    console.warn(`offers: expired ${String(swept.expired)} offer(s) in wave(s) ${swept.waves.join(",")}`);
  }
  return successResponse({ expired: swept.expired, waves: swept.waves, atMs: nowMs }, ctx.locale, ctx.requestId);
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
  {
    method: "GET",
    path: "/v1/rider/offers",
    // A rider reading their own offers: the handler queries by the rider the token resolves to, so the key is
    // the read half of the delivery surface rather than a new key per noun.
    permission: "order.read",
    group: "ORDER_WRITE",
    run: async (ctx) => listOffers(ctx),
  },
  {
    method: "POST",
    path: "/internal/offers/expire",
    // The internal routes carry the shared token rather than a user's permission, exactly as `auto-cancel` does;
    // `INTERNAL` is the rate-limit group that exists for them.
    permission: "*",
    group: "INTERNAL",
    maxBodyBytes: 512,
    run: async (ctx) => expireDueOffers(ctx),
  },
  {
    method: "POST",
    path: "/v1/orders/{code}/offer/{offerId}/reject",
    permission: "order.deliver",
    write: true,
    group: "ORDER_WRITE",
    maxBodyBytes: 1_024,
    run: async (ctx, input) =>
      rejectOffer(ctx, input.params["code"] ?? "", input.params["offerId"] ?? "", input.body),
  },
];
