/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { encodeQuote, issueQuote } from "../../src/domain/order/quote.ts";

/**
 * A quote minted in the past, for the expiry test.
 *
 * `issueQuote` stamps the expiry from the moment it is given, so an old quote can only be produced by
 * issuing one "then" — which is exactly what this helper does, rather than hand-editing a token's
 * payload and testing a forgery path instead of the expiry path.
 */
export async function signedQuoteFor(
  secret: string,
  issuedAtMs: number,
  vendorId: string,
  zoneId: string,
  menuItemId: string,
): Promise<string> {
  const signed = await issueQuote(
    {
      quoteId: "0193f2a17c3e7890abcdef0123456700",
      customerId: "",
      vendorId,
      zoneId,
      fulfilment: "DELIVERY",
      items: [{ menuItemId, quantity: 4, unitPricePaisa: 12_000, modifiersPaisa: 0 }],
      totals: {
        subtotalPaisa: 48_000,
        discountPaisa: 0,
        deliveryFeePaisa: 7_042,
        smallOrderFeePaisa: 2_500,
        taxPaisa: 439,
        tipPaisa: 0,
        roundingPaisa: -81,
        totalPaisa: 57_900,
      },
      surgeBps: 10_000,
      weatherCondition: "CLEAR",
      routeDistanceM: 0,
      routeDurationS: 0,
      trafficDelayS: 0,
      fareSource: "FALLBACK",
    },
    secret,
    issuedAtMs,
  );
  return encodeQuote(signed);
}
