/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { floorToTaka } from "@undal/money";

import { sqlDatetime } from "../db/time.ts";
import { toHexId } from "../lib/ids.ts";
import type { Ctx } from "../middleware/context.ts";
import { failureResponse } from "../middleware/envelope.ts";
import { uuidBytes } from "../middleware/auth.ts";
import { estimateRoute, parsePointE7 } from "../domain/order/distance.ts";
import { applyPromo, priceCart, CartRefused, type CartLineInput, type PricedCart } from "../domain/order/cart.ts";
import type { QuoteTotals } from "../domain/order/quote.ts";
import { findLivePromo, findMenuEntries, findModifiers, findVendorForQuote, findZonePricing, type QuoteVendorRow } from "../repositories/quote.ts";
import { LAUNCH_RATES, SMALL_ORDER_RIDER_PAISA, SMALL_ORDER_THRESHOLD_PAISA, SMALL_ORDER_VENDOR_PAISA, SURGE_NONE_BPS, type FareBreakdown, type VehicleRates } from "./fallback.ts";
import { resolveFare, type ResolvedFare } from "./resolve.ts";

/**
 * Pricing a cart request, once, for both endpoints that need a price.
 *
 * `POST /v1/orders/quote` shows a customer a price; `POST /v1/orders` re-prices from scratch and
 * compares the result to the price they were shown (`08 §4.1`). Those two must run *the same code*,
 * or the comparison is between two implementations and the mismatch it reports is its own bug. This
 * module is that code: it takes the request body, reads what it needs, and returns either a priced
 * cart or the response that refuses it.
 *
 * The straight-line distance is used and labelled `ESTIMATED`. A routed distance needs OSRM, which
 * lives behind the dispatch worker; until that binding exists, a quote that invented a routed
 * distance would quietly over- or under-charge, and an estimate that says it is an estimate is the
 * honest version (`D67`).
 */

/** Everything a caller needs once a cart has been priced. */
export interface PricedQuote {
  readonly vendor: QuoteVendorRow;
  readonly fulfilment: "DELIVERY" | "PICKUP";
  readonly priced: PricedCart;
  readonly rates: VehicleRates;
  readonly distanceM: number;
  readonly trafficDelayS: number;
  readonly surgeBps: number;
  readonly resolved: ResolvedFare;
  readonly breakdown: FareBreakdown;
  readonly totals: QuoteTotals;
  readonly promoCode: string | null;
  readonly discountPaisa: number;
  readonly warnings: readonly string[];
}

/** Either a price, or the response that says why not. */
export type PricingOutcome = { readonly ok: true; readonly value: PricedQuote } | { readonly ok: false; readonly response: Response };

/** Refuse a body that is not shaped like a cart, naming the field. */
function invalid(ctx: Ctx, field: string): Response {
  return failureResponse({ code: "VALIDATION_FAILED", details: { field } }, ctx.locale, ctx.requestId);
}

/** One cart line, or null when it is not shaped like one. */
export function lineOf(node: unknown): CartLineInput | null {
  if (typeof node !== "object" || node === null) return null;
  const { itemId, quantity, modifiers, note } = node as { itemId?: unknown; quantity?: unknown; modifiers?: unknown; note?: unknown };
  if (typeof itemId !== "string" || typeof quantity !== "number") return null;
  const list = Array.isArray(modifiers) ? modifiers.filter((entry): entry is string => typeof entry === "string") : [];
  if (note !== undefined && note !== null && typeof note !== "string") return null;
  return { itemId, quantity, modifiers: list, note: typeof note === "string" ? note : null };
}

/** The rate card for a zone, from `zone_pricing` when it has one and the launch card otherwise. */
export async function ratesFor(ctx: Ctx, zoneId: Uint8Array): Promise<VehicleRates> {
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

/** The body fields a cart request is allowed to carry. */
export interface CartBody {
  readonly vendorId: string;
  readonly fulfilment: "DELIVERY" | "PICKUP";
  readonly deliveryPoint: { readonly latE7: number; readonly lonE7: number } | null;
  readonly lines: readonly CartLineInput[];
  readonly promoCode: string | null;
  readonly tipPaisa: number;
}

/** Parse the body, or say which field is wrong. */
export function parseCartBody(ctx: Ctx, body: unknown): { readonly ok: true; readonly value: CartBody } | { readonly ok: false; readonly response: Response } {
  if (typeof body !== "object" || body === null) return { ok: false, response: invalid(ctx, "body") };
  const fields = body as Record<string, unknown>;

  if (typeof fields["vendorId"] !== "string") return { ok: false, response: invalid(ctx, "vendorId") };
  const fulfilment = fields["fulfilment"] ?? "DELIVERY";
  if (fulfilment !== "DELIVERY" && fulfilment !== "PICKUP") return { ok: false, response: invalid(ctx, "fulfilment") };
  if (!Array.isArray(fields["items"])) return { ok: false, response: invalid(ctx, "items") };

  const tipPaisa = fields["tipPaisa"] ?? 0;
  if (typeof tipPaisa !== "number" || !Number.isInteger(tipPaisa) || tipPaisa < 0) return { ok: false, response: invalid(ctx, "tipPaisa") };
  if (typeof fields["promoCode"] === "string" && fields["promoCode"].length > 0 && fields["promoCode"].length > 24)
    return { ok: false, response: invalid(ctx, "promoCode") };

  const deliveryPoint = parsePointE7(fields["deliveryPoint"]);
  if (fulfilment === "DELIVERY" && deliveryPoint === null) return { ok: false, response: invalid(ctx, "deliveryPoint") };

  const lines: CartLineInput[] = [];
  for (const node of fields["items"]) {
    const line = lineOf(node);
    if (line === null) return { ok: false, response: invalid(ctx, "items") };
    lines.push(line);
  }

  const promoCode = typeof fields["promoCode"] === "string" && fields["promoCode"].length > 0 ? fields["promoCode"].toUpperCase() : null;
  return { ok: true, value: { vendorId: fields["vendorId"], fulfilment, deliveryPoint, lines, promoCode, tipPaisa } };
}

/**
 * Price a parsed cart.
 *
 * Refusal order is deliberate: the vendor first (a closed kitchen makes every other question moot),
 * then the items, then the minimum, then the address, then the money. A customer standing outside a
 * closed shop should not be told their basket is too small.
 */
export async function priceCartBody(ctx: Ctx, body: CartBody): Promise<PricingOutcome> {
  let vendorId: Uint8Array;
  try {
    vendorId = uuidBytes(body.vendorId);
  } catch {
    return { ok: false, response: invalid(ctx, "vendorId") };
  }

  const vendor = await findVendorForQuote(ctx.db, vendorId);
  if (vendor === null || vendor.deleted_at !== null) return { ok: false, response: invalid(ctx, "vendorId") };
  if (vendor.status !== "APPROVED" || vendor.open_state !== "OPEN")
    return { ok: false, response: failureResponse({ code: "CATALOG_VENDOR_CLOSED", details: { openState: vendor.open_state } }, ctx.locale, ctx.requestId) };

  const itemBytes: { readonly hex: string; readonly bytes: Uint8Array }[] = [];
  try {
    for (const line of body.lines) itemBytes.push({ hex: toHexId(uuidBytes(line.itemId)), bytes: uuidBytes(line.itemId) });
  } catch {
    return { ok: false, response: failureResponse({ code: "CATALOG_ITEM_NOT_FOUND" }, ctx.locale, ctx.requestId) };
  }

  const menu = await findMenuEntries(ctx.db, itemBytes.map((entry) => entry.bytes));
  for (const entry of menu.values())
    if (entry.vendorId !== toHexId(vendor.id))
      return { ok: false, response: failureResponse({ code: "CATALOG_ITEM_NOT_FOUND", details: { itemId: entry.itemId } }, ctx.locale, ctx.requestId) };

  let modifierIds: Uint8Array[];
  try {
    modifierIds = [...new Set(body.lines.flatMap((line) => line.modifiers))].map((id) => uuidBytes(id));
  } catch {
    return { ok: false, response: failureResponse({ code: "CATALOG_ITEM_OPTION_INVALID" }, ctx.locale, ctx.requestId) };
  }
  const modifiers = await findModifiers(ctx.db, modifierIds);

  let priced: PricedCart;
  try {
    priced = priceCart(
      body.lines.map((line) => ({ ...line, itemId: toHexId(uuidBytes(line.itemId)) })),
      menu,
      modifiers,
    );
  } catch (error) {
    if (error instanceof CartRefused) return { ok: false, response: failureResponse({ code: error.code, details: { message: error.message } }, ctx.locale, ctx.requestId) };
    throw error;
  }

  const minOrderPaisa = Number(vendor.min_order_paisa);
  if (priced.subtotalPaisa < minOrderPaisa)
    return {
      ok: false,
      response: failureResponse({ code: "QUOTE_BELOW_MINIMUM", details: { minOrderPaisa, subtotalPaisa: priced.subtotalPaisa } }, ctx.locale, ctx.requestId),
    };

  const warnings: string[] = [];
  let discountPaisa = 0;
  let freeDelivery = false;
  if (body.promoCode !== null) {
    const promo = await findLivePromo(ctx.db, body.promoCode, sqlDatetime(new Date()));
    if (promo === null) warnings.push("PROMO_UNKNOWN");
    else {
      const effect = applyPromo(promo, priced.subtotalPaisa);
      if (effect.refused !== null) warnings.push(effect.refused);
      discountPaisa = effect.discountPaisa;
      freeDelivery = effect.freeDelivery;
    }
  }

  const pickup = { latE7: Number(vendor.lat_e7), lonE7: Number(vendor.lon_e7) };
  // A pickup has no journey, so it has no distance: a zero here means "nobody is travelling", not
  // "the journey is free".
  const route = body.deliveryPoint === null ? { distanceM: 0, durationS: 0, source: "ESTIMATED" as const } : estimateRoute(pickup, body.deliveryPoint);
  const distanceM = route.distanceM;
  if (body.fulfilment === "DELIVERY" && distanceM > Number(vendor.max_delivery_m))
    return {
      ok: false,
      response: failureResponse(
        { code: "QUOTE_ADDRESS_OUT_OF_RANGE", details: { distanceM, maxDeliveryM: Number(vendor.max_delivery_m) } },
        ctx.locale,
        ctx.requestId,
      ),
    };

  const rates = await ratesFor(ctx, vendor.zone_id);

  // The published multiplier is not read from a table yet: `zone_pricing` holds the rate card, and
  // the published surge is the Brain's output, which arrives with the realtime module. Until then a
  // cart prices at the floor rather than inventing a multiplier.
  const resolved = await resolveFare(
    null,
    {
      rates,
      fulfilment: body.fulfilment,
      surgeBps: SURGE_NONE_BPS,
      routedDistanceM: distanceM,
      trafficDelayS: 0,
      weather: "CLEAR",
      weatherConfidenceBps: 10_000,
      itemSubtotalPaisa: priced.subtotalPaisa - discountPaisa,
      tipPaisa: body.tipPaisa,
    },
    { zoneId: toHexId(vendor.zone_id), vendorId: toHexId(vendor.id), atIso: new Date().toISOString(), itemsCount: priced.lines.length },
  );

  const breakdown = resolved.breakdown;
  const deliveryFeePaisa = freeDelivery ? 0 : breakdown.deliveryFeePaisa;

  // The engine floored a total that included its own delivery fee. A free-delivery code removes that.
  const floored = floorToTaka(
    priced.subtotalPaisa - discountPaisa + deliveryFeePaisa + breakdown.smallOrderTotalPaisa + breakdown.taxPaisa + body.tipPaisa,
  );

  const totals: QuoteTotals = {
    subtotalPaisa: priced.subtotalPaisa,
    discountPaisa,
    deliveryFeePaisa,
    smallOrderFeePaisa: breakdown.smallOrderTotalPaisa,
    taxPaisa: breakdown.taxPaisa,
    tipPaisa: body.tipPaisa,
    roundingPaisa: floored.delta as number,
    totalPaisa: floored.total as number,
  };

  return {
    ok: true,
    value: {
      vendor,
      fulfilment: body.fulfilment,
      priced,
      rates,
      distanceM,
      trafficDelayS: 0,
      surgeBps: breakdown.surgeBps,
      resolved,
      breakdown,
      totals,
      promoCode: body.promoCode,
      discountPaisa,
      warnings,
    },
  };
}

/** The explain sheet for the delivery line (`08 §4.1`), which is what makes the fee auditable. */
export function deliveryExplain(value: PricedQuote): Readonly<Record<string, unknown>> {
  return {
    distanceM: value.distanceM,
    distanceSource: "ESTIMATED",
    baseFarePaisa: value.rates.baseFarePaisa,
    perKmPaisa: value.rates.perKmPaisa,
    surgeBps: value.surgeBps,
    weather: "CLEAR",
    trafficDelayS: value.trafficDelayS,
  };
}

/** The explain sheet for the small-order line, present only when the fee was charged. */
export function smallOrderExplain(value: PricedQuote): Readonly<Record<string, unknown>> | undefined {
  if (value.totals.smallOrderFeePaisa === 0) return undefined;
  return { thresholdPaisa: SMALL_ORDER_THRESHOLD_PAISA, riderSharePaisa: SMALL_ORDER_RIDER_PAISA, vendorSharePaisa: SMALL_ORDER_VENDOR_PAISA };
}
