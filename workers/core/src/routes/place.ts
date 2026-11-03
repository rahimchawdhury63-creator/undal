/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import * as audit from "../audit/write.ts";
import { fromHexId, newId, toHexId } from "../lib/ids.ts";
import { baseHeaders, failureResponse } from "../middleware/envelope.ts";
import { success } from "@undal/contracts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { buildOrderItems, type CatalogueEntry } from "../domain/order/items.ts";
import { announce } from "../bindings/announce.ts";
import { ringVendor } from "../bindings/ladder.ts";
import { buildStateEvent } from "../domain/order/state-events.ts";
import { planPlacement, PlacementRefused, type PlacementContext } from "../domain/order/placement.ts";
import { verifyQuoteToken, type QuoteSnapshot } from "../domain/order/quote.ts";
import { parsePointE7 } from "../domain/order/distance.ts";
import { parseCartBody, priceCartBody } from "../pricing/cart-service.ts";
import { findMenuEntries } from "../repositories/quote.ts";
import { findCustomerStatus, findZoneStatus, writePlacement } from "../repositories/placement.ts";
import { quoteSecret } from "./quotes.ts";

/**
 * Placing an order: `POST /v1/orders` (`08 §5`).
 *
 * The customer presents the quote token they were shown. This handler does the three things
 * `08 §4.1` demands, in this order: verify the token, **re-price the cart from scratch**, and compare
 * the two. Anything but an exact match is refused with the lines that moved, so the app can show
 * "the fee changed from ৳62 to ৳68 — continue?" instead of silently charging more. There is no path
 * that places an order at a price the customer did not see.
 *
 * The cart is taken from the signed token rather than from the request body: a client that sent its
 * own items alongside a stale token could otherwise order a different basket at the old price.
 */

/** The quote token's own shape, verified before a single row is read. */
function tokenFrom(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const token = (body as { quoteToken?: unknown }).quoteToken;
  return typeof token === "string" && token.length > 0 && token.length <= 8_192 ? token : null;
}

/** The refusal code and details a `PlacementRefused` becomes. */
function refusalResponse(ctx: Ctx, error: PlacementRefused): Response {
  if (error.code === "QUOTE_INGREDIENTS_CHANGED")
    return failureResponse({ code: "QUOTE_INGREDIENTS_CHANGED", details: { changed: error.diffs } }, ctx.locale, ctx.requestId);
  if (error.code === "QUOTE_EXPIRED") return failureResponse({ code: "QUOTE_EXPIRED" }, ctx.locale, ctx.requestId);
  return failureResponse({ code: "QUOTE_MISMATCH", details: { diffs: error.diffs } }, ctx.locale, ctx.requestId);
}

/** Place an order from a signed quote. */
async function place(ctx: Ctx, body: unknown): Promise<Response> {
  const principal = ctx.principal;
  if (principal === null) return failureResponse({ code: "AUTH_TOKEN_MISSING" }, ctx.locale, ctx.requestId);

  const token = tokenFrom(body);
  if (token === null) return failureResponse({ code: "VALIDATION_FAILED", details: { field: "quoteToken" } }, ctx.locale, ctx.requestId);

  const secret = quoteSecret(ctx.env.JWT_SIGNING_KEY);
  const nowMs = Date.now();
  const verdict = await verifyQuoteToken(token, secret, nowMs);
  if (!verdict.ok) return failureResponse({ code: verdict.code }, ctx.locale, ctx.requestId);

  const quoted: QuoteSnapshot = verdict.snapshot;
  // A guest quote carries no customer. Once one does, only that customer may place against it.
  if (quoted.customerId !== "" && quoted.customerId !== principal.userId)
    return failureResponse({ code: "QUOTE_MISMATCH", details: { reason: "quote belongs to another customer" } }, ctx.locale, ctx.requestId);

  const fields = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const note = fields["customerNote"] ?? null;
  if (note !== null && typeof note !== "string") return failureResponse({ code: "VALIDATION_FAILED", details: { field: "customerNote" } }, ctx.locale, ctx.requestId);
  if (typeof note === "string" && note.length > 280) return failureResponse({ code: "VALIDATION_FAILED", details: { field: "customerNote" } }, ctx.locale, ctx.requestId);

  const deliveryPoint = parsePointE7(fields["deliveryPoint"]);
  if (quoted.fulfilment === "DELIVERY" && deliveryPoint === null)
    return failureResponse({ code: "VALIDATION_FAILED", details: { field: "deliveryPoint" } }, ctx.locale, ctx.requestId);

  // Re-price the *quoted* cart, with the quoted choices, against today's menu and today's rates.
  const cartBody = parseCartBody(ctx, {
    vendorId: quoted.vendorId,
    fulfilment: quoted.fulfilment,
    deliveryPoint: deliveryPoint === null ? undefined : { lat: deliveryPoint.latE7 / 1e7, lon: deliveryPoint.lonE7 / 1e7 },
    items: quoted.items.map((item) => ({ itemId: item.menuItemId, quantity: item.quantity, modifiers: item.modifierIds ?? [], note: null })),
    promoCode: typeof fields["promoCode"] === "string" ? fields["promoCode"] : undefined,
    tipPaisa: quoted.totals.tipPaisa,
  });
  if (!cartBody.ok) return cartBody.response;

  // An item that left the menu is an ingredient change, not a price change, and it is checked before
  // the re-price so the customer is told the item is gone rather than that "the total changed".
  const nowMenu = await findMenuEntries(ctx.db, quoted.items.map((item) => fromHexId(item.menuItemId)));
  for (const item of quoted.items) {
    const entry = nowMenu.get(item.menuItemId);
    if (entry === undefined || !entry.available)
      return failureResponse({ code: "QUOTE_INGREDIENTS_CHANGED", details: { itemId: item.menuItemId } }, ctx.locale, ctx.requestId);
  }

  const priced = await priceCartBody(ctx, cartBody.value);
  if (!priced.ok) return priced.response;
  const fresh = priced.value;

  const customerStatus = await findCustomerStatus(ctx.db, fromHexId(principal.userId));
  if (customerStatus === "BANNED") return failureResponse({ code: "AUTH_ACCOUNT_SUSPENDED" }, ctx.locale, ctx.requestId);
  const zoneStatus = await findZoneStatus(ctx.db, fresh.vendor.zone_id);

  const context: PlacementContext = {
    vendorApproved: fresh.vendor.status === "APPROVED",
    vendorOpenState: fresh.vendor.open_state as PlacementContext["vendorOpenState"],
    unavailableItemCount: 0,
    addressZoneActive: zoneStatus === "ACTIVE",
    customerBanned: customerStatus === "BANNED",
    fulfilment: quoted.fulfilment,
  };

  let plan;
  try {
    plan = await planPlacement({
      request: {
        quoteToken: token,
        customerId: principal.userId,
        vendorId: quoted.vendorId,
        zoneId: quoted.zoneId,
        fulfilment: quoted.fulfilment,
        customerNote: note,
        pickupPointE7: { latE7: Number(fresh.vendor.lat_e7), lonE7: Number(fresh.vendor.lon_e7) },
        deliveryPointE7: deliveryPoint,
      },
      // The items are the quoted ones by construction — the cart came from the token — so the
      // comparison that matters is the money: `diffQuote` names every line that moved.
      price: { items: quoted.items, totals: fresh.totals, surgeBps: fresh.surgeBps, fareSource: fresh.resolved.source },
      context,
      secret,
      nowMs,
      nextSeq: 1,
    });
  } catch (error) {
    if (error instanceof PlacementRefused) return refusalResponse(ctx, error);
    throw error;
  }

  // The names on the receipt come from the menu as it is now, and the prices from the quote that was
  // signed: a line reads "Beef Tehari ৳120 ×2" with the name a customer recognises and the number
  // they agreed to.
  const catalogue = new Map<string, CatalogueEntry>();
  for (const [hex, entry] of nowMenu) catalogue.set(hex, { menuItemId: hex, itemId: entry.itemId, variantId: null, pricePaisa: entry.pricePaisa, nameEn: entry.nameEn, nameBn: entry.nameBn });

  const items = buildOrderItems(
    quoted.items.map((item) => ({ menuItemId: item.menuItemId, quantity: item.quantity, unitPricePaisa: item.unitPricePaisa, modifiersPaisa: item.modifiersPaisa })),
    catalogue,
    plan.order.id,
  );

  const event = buildStateEvent({
    orderId: plan.order.id,
    seq: plan.event.seq,
    fromState: plan.event.fromState,
    toState: plan.event.toState,
    actor: plan.event.actor,
    actorUserId: principal.userId,
    reasonCode: null,
    reasonText: null,
    metadata: { quoteId: quoted.quoteId, fareSource: fresh.resolved.source, distanceSource: "ESTIMATED" },
    occurredAtMs: nowMs,
  });

  await writePlacement(ctx.db, {
    order: plan.order,
    items,
    event,
    money: {
      commissionPaisa: fresh.breakdown.commissionPaisa,
      riderBonusPaisa: fresh.breakdown.riderBonusPaisa,
      riderPayoutPaisa: fresh.breakdown.riderPayoutPaisa,
      vendorPayoutPaisa: fresh.breakdown.vendorPayoutPaisa,
      platformRevenuePaisa:
        fresh.breakdown.commissionPaisa +
        fresh.breakdown.platformSmallOrderPaisa +
        fresh.breakdown.platformDeliveryNetPaisa -
        fresh.breakdown.platformWeatherExpensePaisa,
    },
    nowMs,
  });

  await audit.appendAudit(
    ctx.db,
    {
      actorId: principal.userId,
      actorType: principal.actorType === "VENDOR_OWNER" ? "VENDOR" : principal.actorType,
      actorRole: principal.role,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      action: "order.create",
      resourceType: "ORDER",
      resourceId: plan.order.id,
      subjectId: null,
      before: null,
      after: { code: plan.order.code, state: plan.order.state, totalPaisa: plan.order.totals.totalPaisa, quoteId: quoted.quoteId },
      reason: null,
      severity: "NOTICE",
    },
    nowMs,
  );

  // The order exists; the vendor's screen and the zone's map hear about it before the customer's receipt is
  // parsed. A failed broadcast degrades to a poll, never to a lost order (D85).
  announce(ctx, {
    zoneId: plan.order.zoneId,
    orderId: plan.order.code,
    event: plan.event.event,
    payload: { orderId: plan.order.code, state: plan.order.state, seq: plan.event.seq, vendorId: plan.order.vendorId },
    seq: plan.event.seq,
  });

  // The order is placed, so the vendor's phone starts ringing — 120 s, three rungs, and a cancellation nobody
  // chose at the end of it. Handed to `waitUntil` because the ring is not a precondition of the order, and
  // written down when it did not happen because a ring that failed is a customer waiting two minutes for
  // nothing (D93).
  const publishedAtMs = nowMs;
  ctx.waitUntil(
    ringVendor(ctx, {
      orderId: plan.order.id,
      orderCode: plan.order.code,
      zoneId: plan.order.zoneId,
      vendorId: plan.order.vendorId,
      itemCount: items.length,
      totalPaisa: plan.order.totals.totalPaisa,
      publishedAtMs,
    }),
  );

  // `201 Created`, built through the same envelope as every other response: a placement that reused
  // the 200 helper would be the one endpoint whose success could not be told from a replayed read.
  return new Response(
    JSON.stringify(
      success(
        {
          id: plan.order.id,
          code: plan.order.code,
          state: plan.order.state,
          totalPaisa: plan.order.totals.totalPaisa,
          cashDuePaisa: plan.cashDuePaisa,
          paymentMethod: plan.order.paymentMethod,
          fulfilment: plan.order.fulfilment,
          fareSource: fresh.resolved.source,
          placedAt: plan.order.placedAtIso,
        },
        { requestId: ctx.requestId },
      ),
    ),
    { status: 201, headers: baseHeaders(ctx.requestId) },
  );
}

/** The placement routes. */
export const PLACEMENT_ROUTES: readonly RouteDefinition[] = [
  {
    method: "POST",
    path: "/v1/orders",
    permission: "order.create",
    write: true,
    group: "ORDER_WRITE",
    maxBodyBytes: 16_384,
    run: async (ctx, input) => place(ctx, input.body),
  },
];
