/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { toHexId, newId } from "../lib/ids.ts";
import { failureResponse, successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { ANONYMOUS } from "../middleware/auth.ts";
import { quoteLines, quoteLinesSum } from "../domain/order/cart.ts";
import { issueQuote, encodeQuote, QUOTE_TTL_MS } from "../domain/order/quote.ts";
import { ESTIMATED_SPEED_MPS } from "../domain/order/distance.ts";
import { deliveryExplain, parseCartBody, priceCartBody, smallOrderExplain } from "../pricing/cart-service.ts";

/**
 * Quoting a cart: `POST /v1/orders/quote` (`08 §4.1`).
 *
 * This endpoint decides what a customer is shown before they commit, so its output is a signed
 * promise: the token it returns carries the price, and placement re-prices against it (`D62`). The
 * pricing itself lives in `pricing/cart-service.ts` and is shared with `POST /v1/orders`, because a
 * quote compared against a differently-computed re-price would be comparing two implementations.
 *
 * Authentication is *optional*: a guest may price a cart, and a signed-in customer's quote records
 * who asked so a later placement cannot release the order to somebody else.
 */

/** The quote secret is derived from the JWT key by purpose, never reused from it. */
export function quoteSecret(jwtSigningKey: string): string {
  return `${jwtSigningKey}:quote-token-v1`;
}

/** Price a cart and sign the answer. */
async function quote(ctx: Ctx, body: unknown): Promise<Response> {
  const parsed = parseCartBody(ctx, body);
  if (!parsed.ok) return parsed.response;

  const outcome = await priceCartBody(ctx, parsed.value);
  if (!outcome.ok) return outcome.response;
  const value = outcome.value;

  const signed = await issueQuote(
    {
      quoteId: toHexId(newId()),
      customerId: ctx.principal?.userId ?? "",
      vendorId: toHexId(value.vendor.id),
      zoneId: toHexId(value.vendor.zone_id),
      fulfilment: value.fulfilment,
      items: value.priced.lines.map((line) => ({
        menuItemId: line.itemId,
        quantity: line.quantity,
        modifierIds: line.modifierIds,
        unitPricePaisa: line.unitPricePaisa,
        modifiersPaisa: line.modifiersPaisa,
      })),
      totals: value.totals,
      surgeBps: value.surgeBps,
      weatherCondition: "CLEAR",
      routeDistanceM: value.distanceM,
      routeDurationS: Math.round(value.distanceM / ESTIMATED_SPEED_MPS),
      trafficDelayS: value.trafficDelayS,
      fareSource: value.resolved.source,
    },
    quoteSecret(ctx.env.JWT_SIGNING_KEY),
    Date.now(),
  );

  const lines = quoteLines({
    subtotalPaisa: value.totals.subtotalPaisa,
    discountPaisa: value.discountPaisa,
    discountCode: value.promoCode,
    deliveryFeePaisa: value.totals.deliveryFeePaisa,
    smallOrderFeePaisa: value.totals.smallOrderFeePaisa,
    taxPaisa: value.totals.taxPaisa,
    tipPaisa: value.totals.tipPaisa,
    roundingPaisa: value.totals.roundingPaisa,
    deliveryExplain: deliveryExplain(value),
    smallOrderExplain: smallOrderExplain(value),
  });

  // The token is the promise and the lines are its explanation. A receipt whose lines do not sum to
  // its total is a bug the customer can find with a pen, so it is refused here rather than shipped.
  if (quoteLinesSum(lines) !== value.totals.totalPaisa) return failureResponse({ code: "MONEY_INVOICE_UNBALANCED" }, ctx.locale, ctx.requestId);

  const travelSeconds = Math.round(value.distanceM / ESTIMATED_SPEED_MPS);
  const etaSeconds = value.priced.prepTimeS + travelSeconds;

  return successResponse(
    {
      quoteId: signed.snapshot.quoteId,
      quoteToken: encodeQuote(signed),
      expiresAt: new Date(signed.snapshot.expiresAtMs).toISOString(),
      ttlSeconds: QUOTE_TTL_MS / 1000,
      lines,
      totalPaisa: value.totals.totalPaisa,
      etaMinMinutes: Math.max(1, Math.round((etaSeconds * 0.9) / 60)),
      etaMaxMinutes: Math.max(2, Math.round((etaSeconds * 1.15) / 60)),
      fareSource: value.resolved.source,
      distanceSource: "ESTIMATED",
      warnings: value.warnings,
    },
    ctx.locale,
    ctx.requestId,
  );
}

/** The quote routes. */
export const QUOTE_ROUTES: readonly RouteDefinition[] = [
  {
    method: "POST",
    path: "/v1/orders/quote",
    permission: ANONYMOUS,
    // A POST that writes nothing: it prices a cart and signs the answer.
    readOnly: true,
    // Optional, not absent: a guest may price a cart, and a signed-in caller's quote records who asked.
    optionalAuth: true,
    group: "QUOTE",
    maxBodyBytes: 8_192,
    run: async (ctx, input) => quote(ctx, input.body),
  },
];
