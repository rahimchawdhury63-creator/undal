/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { haversineMeters } from "@undal/contracts";
import { floorToTaka as floorPaisaToTaka } from "@undal/money";

import { uuidBytes } from "../middleware/auth.ts";
import { failureResponse, successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import { newId, toHexId } from "../lib/ids.ts";
import { sqlDatetime } from "../db/time.ts";
import { ANONYMOUS } from "../middleware/auth.ts";
import { applyPromo, priceCart, quoteLines, quoteLinesSum, CartRefused, type CartLineInput, type PricedCart, type QuoteLine } from "../domain/order/cart.ts";
import { issueQuote, encodeQuote, QUOTE_TTL_MS } from "../domain/order/quote.ts";
import { LAUNCH_RATES, SMALL_ORDER_RIDER_PAISA, SMALL_ORDER_THRESHOLD_PAISA, SMALL_ORDER_VENDOR_PAISA, SURGE_NONE_BPS, type VehicleRates } from "../pricing/fallback.ts";
import { resolveFare } from "../pricing/resolve.ts";
import { findLivePromo, findMenuEntries, findModifiers, findVendorForQuote, findZonePricing } from "../repositories/quote.ts";

/**
 * Quoting a cart: `POST /v1/orders/quote` (`08 §4.1`).
 *
 * This is the endpoint that decides what a customer is shown before they commit, so its rules are
 * the product: the price is computed once, signed, and becomes the price the order is placed at
 * (`D62`). Authentication is *optional* — a guest may price a cart, and a signed-in customer's
 * quote carries their id so a later placement cannot be released to somebody else.
 *
 * The straight-line distance is used and labelled `ESTIMATED`. A routed distance needs OSRM, which
 * lives behind the dispatch worker; until that binding exists, a quote that invented a routed
 * distance would be a quote that quietly over- or under-charges, and an estimate that says it is an
 * estimate is the honest version. `08 §4.1` already puts `distanceM` in the explain sheet, so the
 * provenance travels with the number.
 */

/** The average speed an ETA is estimated at: 18 km/h, Sylhet traffic, motorbike. */
export const ESTIMATED_SPEED_MPS = 5;

/** The quote secret is derived from the JWT key by purpose, never reused from it. */
export function quoteSecret(jwtSigningKey: string): string {
  return `${jwtSigningKey}:quote-token-v1`;
}

/** Refuse a body that is not shaped like a quote request, naming the field. */
function invalid(ctx: Ctx, field: string): Response {
  return failureResponse({ code: "VALIDATION_FAILED", details: { field } }, ctx.locale, ctx.requestId);
}

/** A delivery point, as the client sends it (floating degrees) and as we store it (E7 integers). */
function pointE7(node: unknown): { latE7: number; lonE7: number } | null {
  if (typeof node !== "object" || node === null) return null;
  const { lat, lon } = node as { lat?: unknown; lon?: unknown };
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { latE7: Math.round(lat * 1e7), lonE7: Math.round(lon * 1e7) };
}

/** One cart line, or null when it is not shaped like one. */
function lineOf(node: unknown): CartLineInput | null {
  if (typeof node !== "object" || node === null) return null;
  const { itemId, quantity, modifiers, note } = node as {
    itemId?: unknown;
    quantity?: unknown;
    modifiers?: unknown;
    note?: unknown;
  };
  if (typeof itemId !== "string" || typeof quantity !== "number") return null;
  const list = Array.isArray(modifiers) ? modifiers.filter((entry): entry is string => typeof entry === "string") : [];
  if (note !== undefined && note !== null && typeof note !== "string") return null;
  return { itemId, quantity, modifiers: list, note: typeof note === "string" ? note : null };
}

/** The rate card for a vehicle, from the zone's pricing when it has one and the launch card otherwise. */
async function ratesFor(ctx: Ctx, zoneId: Uint8Array): Promise<VehicleRates> {
  const row = await findZonePricing(ctx.db, zoneId, "MOTORBIKE");
  if (row === null) return LAUNCH_RATES.MOTORBIKE;
  return {
    ...LAUNCH_RATES.MOTORBIKE,
    baseFarePaisa: Number(row.base_fare_paisa),
    baseDistanceM: Number(row.base_distance_m),
    perKmPaisa: Number(row.per_km_paisa),
    maxRadiusM: Number(row.max_radius_m),
    minPayoutPaisa: Number(row.min_payout_paisa),
    surgeCapBps: Number(row.surge_cap_bps),
  };
}

/** Price a cart. */
async function quote(ctx: Ctx, body: unknown): Promise<Response> {
  if (typeof body !== "object" || body === null) return invalid(ctx, "body");
  const fields = body as Record<string, unknown>;

  if (typeof fields["vendorId"] !== "string") return invalid(ctx, "vendorId");
  const fulfilment = fields["fulfilment"] ?? "DELIVERY";
  if (fulfilment !== "DELIVERY" && fulfilment !== "PICKUP") return invalid(ctx, "fulfilment");
  if (!Array.isArray(fields["items"])) return invalid(ctx, "items");
  const tipPaisa = fields["tipPaisa"] === undefined ? 0 : fields["tipPaisa"];
  if (typeof tipPaisa !== "number" || !Number.isInteger(tipPaisa) || tipPaisa < 0) return invalid(ctx, "tipPaisa");

  const deliveryPoint = pointE7(fields["deliveryPoint"]);
  if (fulfilment === "DELIVERY" && deliveryPoint === null) return invalid(ctx, "deliveryPoint");

  const rawLines: CartLineInput[] = [];
  for (const node of fields["items"]) {
    const line = lineOf(node);
    if (line === null) return invalid(ctx, "items");
    rawLines.push(line);
  }

  let vendorId: Uint8Array;
  try {
    vendorId = uuidBytes(fields["vendorId"]);
  } catch {
    return failureResponse({ code: "VALIDATION_FAILED", details: { field: "vendorId" } }, ctx.locale, ctx.requestId);
  }

  const vendor = await findVendorForQuote(ctx.db, vendorId);
  if (vendor === null || vendor.deleted_at !== null) return failureResponse({ code: "VALIDATION_FAILED", details: { field: "vendorId" } }, ctx.locale, ctx.requestId);
  if (vendor.status !== "APPROVED") return failureResponse({ code: "CATALOG_VENDOR_CLOSED" }, ctx.locale, ctx.requestId);
  if (vendor.open_state !== "OPEN") return failureResponse({ code: "CATALOG_VENDOR_CLOSED", details: { openState: vendor.open_state } }, ctx.locale, ctx.requestId);

  let itemIds: Uint8Array[];
  try {
    itemIds = rawLines.map((line) => uuidBytes(line.itemId));
  } catch {
    return failureResponse({ code: "CATALOG_ITEM_NOT_FOUND" }, ctx.locale, ctx.requestId);
  }

  const menu = await findMenuEntries(ctx.db, itemIds);
  for (const entry of menu.values())
    if (entry.vendorId !== toHexId(vendor.id)) return failureResponse({ code: "CATALOG_ITEM_NOT_FOUND", details: { itemId: entry.itemId } }, ctx.locale, ctx.requestId);

  let modifierIds: Uint8Array[];
  try {
    modifierIds = [...new Set(rawLines.flatMap((line) => line.modifiers))].map((id) => uuidBytes(id));
  } catch {
    return failureResponse({ code: "CATALOG_ITEM_OPTION_INVALID" }, ctx.locale, ctx.requestId);
  }
  const modifiers = await findModifiers(ctx.db, modifierIds);

  // `priceCart` speaks in hex ids, which is what the menu and modifier maps are keyed by.
  let priced: PricedCart;
  try {
    priced = priceCart(
      rawLines.map((line) => ({ ...line, itemId: toHexId(uuidBytes(line.itemId)) })),
      menu,
      modifiers,
    );
  } catch (error) {
    if (error instanceof CartRefused) return failureResponse({ code: error.code, details: { message: error.message } }, ctx.locale, ctx.requestId);
    throw error;
  }

  const minOrderPaisa = Number(vendor.min_order_paisa);
  if (priced.subtotalPaisa < minOrderPaisa)
    return failureResponse({ code: "QUOTE_BELOW_MINIMUM", details: { minOrderPaisa, subtotalPaisa: priced.subtotalPaisa } }, ctx.locale, ctx.requestId);

  const warnings: string[] = [];
  const promoCode = typeof fields["promoCode"] === "string" && fields["promoCode"].length > 0 ? fields["promoCode"].toUpperCase() : null;
  let discountPaisa = 0;
  let freeDelivery = false;
  if (promoCode !== null) {
    const promo = await findLivePromo(ctx.db, promoCode, sqlDatetime(new Date()));
    if (promo === null) warnings.push("PROMO_UNKNOWN");
    else {
      const effect = applyPromo(promo, priced.subtotalPaisa);
      if (effect.refused !== null) warnings.push(effect.refused);
      discountPaisa = effect.discountPaisa;
      freeDelivery = effect.freeDelivery;
    }
  }

  const pickup = { latE7: Number(vendor.lat_e7), lonE7: Number(vendor.lon_e7) };
  const distanceM = deliveryPoint === null ? 0 : Math.round(haversineMeters(pickup, deliveryPoint));
  if (fulfilment === "DELIVERY" && distanceM > Number(vendor.max_delivery_m))
    return failureResponse({ code: "QUOTE_ADDRESS_OUT_OF_RANGE", details: { distanceM, maxDeliveryM: Number(vendor.max_delivery_m) } }, ctx.locale, ctx.requestId);

  const rates = await ratesFor(ctx, vendor.zone_id);

  // The published multiplier is not read from a table yet: `zone_pricing` holds the rate card, and
  // the published surge is the Brain's output, which arrives with the realtime module. Until then a
  // quote prices at the floor rather than inventing a multiplier — and says so in `fareSource`.
  const resolved = await resolveFare(null, {
    rates,
    fulfilment,
    surgeBps: SURGE_NONE_BPS,
    routedDistanceM: distanceM,
    trafficDelayS: 0,
    weather: "CLEAR",
    weatherConfidenceBps: 10_000,
    itemSubtotalPaisa: priced.subtotalPaisa - discountPaisa,
    tipPaisa,
  }, {
    zoneId: toHexId(vendor.zone_id),
    vendorId: toHexId(vendor.id),
    atIso: new Date().toISOString(),
    itemsCount: priced.lines.length,
  });

  const breakdown = resolved.breakdown;
  const deliveryFeePaisa = freeDelivery ? 0 : breakdown.deliveryFeePaisa;
  // The engine floored the total *including* its own delivery fee. A free-delivery code removes that
  // fee afterwards, so the total and its rounding line are re-derived here from the components that
  // survived — floored once, at the end, exactly as the money law requires. When no code applies the
  // two agree to the paisa, and the test suite asserts that they do.
  const preRound =
    priced.subtotalPaisa - discountPaisa + deliveryFeePaisa + breakdown.smallOrderTotalPaisa + breakdown.taxPaisa + tipPaisa;
  const floored = floorPaisaToTaka(preRound);
  const totals = {
    subtotalPaisa: priced.subtotalPaisa,
    discountPaisa,
    deliveryFeePaisa,
    smallOrderFeePaisa: breakdown.smallOrderTotalPaisa,
    taxPaisa: breakdown.taxPaisa,
    tipPaisa,
    roundingPaisa: floored.delta as number,
    totalPaisa: floored.total as number,
  };
  const totalPaisa = totals.totalPaisa;

  const signed = await issueQuote(
    {
      quoteId: toHexId(newId()),
      customerId: ctx.principal?.userId ?? "",
      vendorId: toHexId(vendor.id),
      zoneId: toHexId(vendor.zone_id),
      fulfilment,
      items: priced.lines.map((line) => ({
        menuItemId: line.itemId,
        quantity: line.quantity,
        unitPricePaisa: line.unitPricePaisa,
        modifiersPaisa: line.modifiersPaisa,
      })),
      totals: { ...totals, totalPaisa },
      surgeBps: breakdown.surgeBps,
      weatherCondition: "CLEAR",
      routeDistanceM: distanceM,
      routeDurationS: Math.round(distanceM / ESTIMATED_SPEED_MPS),
      trafficDelayS: 0,
      fareSource: resolved.source,
    },
    quoteSecret(ctx.env.JWT_SIGNING_KEY),
    Date.now(),
  );

  const lines: readonly QuoteLine[] = quoteLines({
    subtotalPaisa: totals.subtotalPaisa,
    discountPaisa,
    discountCode: promoCode,
    deliveryFeePaisa,
    smallOrderFeePaisa: totals.smallOrderFeePaisa,
    taxPaisa: totals.taxPaisa,
    tipPaisa,
    roundingPaisa: totals.roundingPaisa,
    deliveryExplain: {
      distanceM,
      distanceSource: "ESTIMATED",
      baseFarePaisa: rates.baseFarePaisa,
      perKmPaisa: rates.perKmPaisa,
      surgeBps: breakdown.surgeBps,
      weather: "CLEAR",
      trafficDelayS: 0,
    },
    smallOrderExplain:
      totals.smallOrderFeePaisa === 0
        ? undefined
        : { thresholdPaisa: SMALL_ORDER_THRESHOLD_PAISA, riderSharePaisa: SMALL_ORDER_RIDER_PAISA, vendorSharePaisa: SMALL_ORDER_VENDOR_PAISA },
  });

  // The signed token is the quote's proof and the lines are its explanation; a receipt whose lines do
  // not sum to its total is a bug the customer can find with a pen, so it is refused here instead.
  if (quoteLinesSum(lines) !== totalPaisa) return failureResponse({ code: "MONEY_INVOICE_UNBALANCED" }, ctx.locale, ctx.requestId);

  const travelSeconds = Math.round(distanceM / ESTIMATED_SPEED_MPS);
  const etaSeconds = priced.prepTimeS + travelSeconds;

  return successResponse(
    {
      quoteId: signed.snapshot.quoteId,
      quoteToken: encodeQuote(signed),
      expiresAt: new Date(signed.snapshot.expiresAtMs).toISOString(),
      ttlSeconds: QUOTE_TTL_MS / 1000,
      lines,
      totalPaisa,
      etaMinMinutes: Math.max(1, Math.round((etaSeconds * 0.9) / 60)),
      etaMaxMinutes: Math.max(2, Math.round((etaSeconds * 1.15) / 60)),
      fareSource: resolved.source,
      distanceSource: "ESTIMATED",
      warnings,
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
