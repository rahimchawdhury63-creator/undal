/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { applyRate } from "@undal/money";

/**
 * A cart, priced — before it is a quote and long before it is an order.
 *
 * Carts are client-owned (`08 §4`): the server never stores one, it only prices one. That decision
 * removes a whole class of sync bugs and lets an offline customer keep building a cart, and it means
 * this module is the *entire* server-side model of a cart: a request shape, the catalogue facts it
 * refers to, and the arithmetic that turns the two into money.
 *
 * Everything here is pure. The caller supplies the menu rows and the modifier rows it read, so the
 * same function can price a cart in a test with no database, in the worker with a real one, and in
 * the receipt explainer months later from stored rows.
 */

/** How many distinct lines one cart may carry; the schema's `order_items` limit is the same number. */
export const MAX_CART_LINES = 50;

/** The smallest quantity a line may carry: zero is a deleted line, not a cheap one. */
export const CART_MIN_QUANTITY = 1;

/** The largest quantity one line may carry, matching `order_items.quantity`'s check constraint. */
export const CART_MAX_QUANTITY = 20;

/** A note is a kitchen instruction, not a message: it has a hard length and no formatting. */
export const MAX_LINE_NOTE_LENGTH = 200;

/** One line as the client sent it. */
export interface CartLineInput {
  readonly itemId: string;
  readonly quantity: number;
  readonly modifiers: readonly string[];
  readonly note: string | null;
}

/** The menu facts a line needs. Availability is read, never assumed. */
export interface MenuEntry {
  readonly itemId: string;
  readonly nameEn: string;
  readonly nameBn: string;
  readonly pricePaisa: number;
  readonly available: boolean;
  readonly prepTimeS: number;
}

/** A modifier's price delta and the group it belongs to. */
export interface ModifierEntry {
  readonly modifierId: string;
  readonly groupId: string;
  readonly priceDeltaPaisa: number;
  readonly available: boolean;
}

/** A refused cart, carrying a code the app already knows how to render. */
export class CartRefused extends Error {
  readonly code:
    | "ORDER_ITEMS_EMPTY"
    | "ORDER_ITEMS_CHANGED"
    | "CATALOG_ITEM_NOT_FOUND"
    | "CATALOG_ITEM_SOLD_OUT"
    | "CATALOG_ITEM_QTY_INVALID"
    | "CATALOG_ITEM_OPTION_INVALID";

  constructor(code: CartRefused["code"], message: string) {
    super(message);
    this.name = "CartRefused";
    this.code = code;
  }
}

/** A line, priced: the item's price plus its chosen modifiers, times the quantity. */
export interface PricedLine {
  readonly itemId: string;
  readonly quantity: number;
  /** The modifier ids chosen, kept so a quote can be re-priced against the same choices. */
  readonly modifierIds: readonly string[];
  readonly unitPricePaisa: number;
  readonly modifiersPaisa: number;
  readonly lineTotalPaisa: number;
  readonly note: string | null;
  readonly prepTimeS: number;
}

/** The priced cart: what the customer is buying and what the items alone cost. */
export interface PricedCart {
  readonly lines: readonly PricedLine[];
  readonly subtotalPaisa: number;
  /** The longest prep time across the lines, which is what the kitchen is actually promising. */
  readonly prepTimeS: number;
}

/**
 * Read one line, refusing anything the catalogue cannot honour.
 *
 * Every refusal is a catalogue code rather than an order code: the customer is still shopping, and
 * `ORDER_ITEMS_CHANGED` is a message about a race they were not part of.
 */
function priceLine(input: CartLineInput, menu: ReadonlyMap<string, MenuEntry>, modifiers: ReadonlyMap<string, ModifierEntry>): PricedLine {
  if (!Number.isInteger(input.quantity) || input.quantity < CART_MIN_QUANTITY || input.quantity > CART_MAX_QUANTITY)
    throw new CartRefused("CATALOG_ITEM_QTY_INVALID", `quantity ${input.quantity} is outside ${CART_MIN_QUANTITY}..${CART_MAX_QUANTITY}`);

  const entry = menu.get(input.itemId);
  if (entry === undefined) throw new CartRefused("CATALOG_ITEM_NOT_FOUND", `item ${input.itemId} is not on this menu`);
  if (!entry.available) throw new CartRefused("CATALOG_ITEM_SOLD_OUT", `item ${input.itemId} is not available`);

  if (input.note !== null && input.note.length > MAX_LINE_NOTE_LENGTH)
    throw new CartRefused("ORDER_ITEMS_CHANGED", `a note may be at most ${MAX_LINE_NOTE_LENGTH} characters`);

  const seen = new Set<string>();
  let modifiersPaisa = 0;
  for (const modifierId of input.modifiers) {
    const modifier = modifiers.get(modifierId);
    if (modifier === undefined) throw new CartRefused("CATALOG_ITEM_OPTION_INVALID", `modifier ${modifierId} does not exist`);
    if (!modifier.available) throw new CartRefused("CATALOG_ITEM_OPTION_INVALID", `modifier ${modifierId} is not available`);
    if (seen.has(modifier.modifierId)) throw new CartRefused("CATALOG_ITEM_OPTION_INVALID", `modifier ${modifierId} was chosen twice`);
    seen.add(modifier.modifierId);
    modifiersPaisa += modifier.priceDeltaPaisa;
  }

  const unitPricePaisa = entry.pricePaisa;
  return {
    itemId: entry.itemId,
    quantity: input.quantity,
    modifierIds: [...input.modifiers],
    unitPricePaisa,
    modifiersPaisa,
    lineTotalPaisa: (unitPricePaisa + modifiersPaisa) * input.quantity,
    note: input.note,
    prepTimeS: entry.prepTimeS,
  };
}

/**
 * Price a whole cart.
 *
 * The subtotal is the sum of the lines and nothing else: a discount is a separate, labelled line in
 * the response, because a customer who sees ৳500 of food and ৳450 of subtotal has been told two
 * things and believes neither.
 */
export function priceCart(
  inputs: readonly CartLineInput[],
  menu: ReadonlyMap<string, MenuEntry>,
  modifiers: ReadonlyMap<string, ModifierEntry>,
): PricedCart {
  if (inputs.length === 0) throw new CartRefused("ORDER_ITEMS_EMPTY", "a cart needs at least one line");
  if (inputs.length > MAX_CART_LINES)
    throw new CartRefused("ORDER_ITEMS_CHANGED", `${inputs.length} lines exceeds the ${MAX_CART_LINES} a cart may carry`);

  const lines = inputs.map((input) => priceLine(input, menu, modifiers));
  const duplicated = new Set<string>();
  for (const line of lines) {
    // Two lines of the same item with different notes are legitimate; two lines of the same item
    // with the same choices are a client bug that would double the receipt.
    const key = `${line.itemId}|${line.modifiersPaisa}|${line.note ?? ""}`;
    if (duplicated.has(key)) throw new CartRefused("ORDER_ITEMS_CHANGED", `item ${line.itemId} appears twice with the same choices`);
    duplicated.add(key);
  }

  return {
    lines,
    subtotalPaisa: lines.reduce((sum, line) => sum + line.lineTotalPaisa, 0),
    prepTimeS: lines.reduce((longest, line) => Math.max(longest, line.prepTimeS), 0),
  };
}

/** A promotion, as `promo_codes` holds it. */
export interface PromoRule {
  readonly code: string;
  readonly kind: "PERCENT" | "FLAT" | "FREE_DELIVERY";
  readonly valueBps: number | null;
  readonly valuePaisa: number | null;
  readonly minSubtotalPaisa: number;
  readonly maxDiscountPaisa: number | null;
}

/** What a promotion does to a cart. */
export interface PromoEffect {
  readonly discountPaisa: number;
  readonly freeDelivery: boolean;
  /** Why the code applied nothing, when it applied nothing. */
  readonly refused: null | "PROMO_MIN_ORDER_NOT_MET" | "PROMO_NOT_APPLICABLE";
}

/**
 * Apply a promotion to a priced cart.
 *
 * A discount never exceeds the subtotal: a free-delivery code against a ৳0 basket, or a 50% code on
 * a ৳1 item, must not turn into money the platform owes a customer. The clamp is here rather than at
 * the caller because every caller would otherwise need to remember it.
 */
export function applyPromo(promo: PromoRule, subtotalPaisa: number): PromoEffect {
  if (subtotalPaisa < promo.minSubtotalPaisa) return { discountPaisa: 0, freeDelivery: false, refused: "PROMO_MIN_ORDER_NOT_MET" };

  if (promo.kind === "FREE_DELIVERY") return { discountPaisa: 0, freeDelivery: true, refused: null };

  if (promo.kind === "PERCENT") {
    if (promo.valueBps === null) return { discountPaisa: 0, freeDelivery: false, refused: "PROMO_NOT_APPLICABLE" };
    const raw = applyRate(subtotalPaisa, promo.valueBps);
    const capped = promo.maxDiscountPaisa === null ? raw : Math.min(raw, promo.maxDiscountPaisa);
    return { discountPaisa: Math.min(capped, subtotalPaisa), freeDelivery: false, refused: null };
  }

  if (promo.valuePaisa === null) return { discountPaisa: 0, freeDelivery: false, refused: "PROMO_NOT_APPLICABLE" };
  const capped = promo.maxDiscountPaisa === null ? promo.valuePaisa : Math.min(promo.valuePaisa, promo.maxDiscountPaisa);
  return { discountPaisa: Math.min(capped, subtotalPaisa), freeDelivery: false, refused: null };
}

/** One line of the fee breakdown the customer reads (`08 §4.1`). */
export interface QuoteLine {
  readonly kind: "SUBTOTAL" | "DISCOUNT" | "DELIVERY_FEE" | "SMALL_ORDER_FEE" | "TAX" | "TIP" | "ROUNDING";
  readonly labelEn: string;
  readonly labelBn: string;
  readonly amountPaisa: number;
  readonly fundedBy?: "PLATFORM" | "VENDOR";
  readonly explain?: Readonly<Record<string, unknown>>;
}

/**
 * The labels, in both languages, in one place.
 *
 * They are server-side because the two clients and the web storefront must agree with the receipt:
 * a fee labelled "Order fee" in the app and "Small order fee" on the invoice is a support ticket
 * about a charge that was correct.
 */
export const QUOTE_LABELS = {
  SUBTOTAL: { en: "Items", bn: "আইটেম" },
  DELIVERY_FEE: { en: "Delivery", bn: "ডেলিভারি" },
  SMALL_ORDER_FEE: { en: "Small order fee", bn: "ছোট অর্ডার ফি" },
  TAX: { en: "Tax (5%)", bn: "কর (৫%)" },
  TIP: { en: "Tip", bn: "টিপ" },
  ROUNDING: { en: "Rounding", bn: "রাউন্ডিং" },
} as const;

/** What the breakdown needs from a finished fare. */
export interface QuoteLineInput {
  readonly subtotalPaisa: number;
  readonly discountPaisa: number;
  readonly discountCode: string | null;
  readonly deliveryFeePaisa: number;
  readonly smallOrderFeePaisa: number;
  readonly taxPaisa: number;
  readonly tipPaisa: number;
  readonly roundingPaisa: number;
  readonly deliveryExplain?: Readonly<Record<string, unknown>> | undefined;
  readonly smallOrderExplain?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Render the breakdown, dropping the lines that are zero.
 *
 * A `৳0.00` delivery line on a pickup is noise that invites the question "why is delivery free?", and
 * a zero rounding line invites "what is rounding?". The two exceptions are the subtotal, which is
 * always shown, and a discount, which is shown whenever a code was supplied — even at zero, because
 * a customer who typed a code is owed an answer about it.
 */
export function quoteLines(input: QuoteLineInput): readonly QuoteLine[] {
  const lines: QuoteLine[] = [
    { kind: "SUBTOTAL", labelEn: QUOTE_LABELS.SUBTOTAL.en, labelBn: QUOTE_LABELS.SUBTOTAL.bn, amountPaisa: input.subtotalPaisa },
  ];

  if (input.discountCode !== null)
    lines.push({
      kind: "DISCOUNT",
      labelEn: input.discountCode,
      labelBn: input.discountCode,
      amountPaisa: -input.discountPaisa,
      fundedBy: "PLATFORM",
    });

  if (input.deliveryFeePaisa !== 0)
    lines.push({
      kind: "DELIVERY_FEE",
      labelEn: QUOTE_LABELS.DELIVERY_FEE.en,
      labelBn: QUOTE_LABELS.DELIVERY_FEE.bn,
      amountPaisa: input.deliveryFeePaisa,
      ...(input.deliveryExplain === undefined ? {} : { explain: input.deliveryExplain }),
    });

  if (input.smallOrderFeePaisa !== 0)
    lines.push({
      kind: "SMALL_ORDER_FEE",
      labelEn: QUOTE_LABELS.SMALL_ORDER_FEE.en,
      labelBn: QUOTE_LABELS.SMALL_ORDER_FEE.bn,
      amountPaisa: input.smallOrderFeePaisa,
      ...(input.smallOrderExplain === undefined ? {} : { explain: input.smallOrderExplain }),
    });

  if (input.taxPaisa !== 0) lines.push({ kind: "TAX", labelEn: QUOTE_LABELS.TAX.en, labelBn: QUOTE_LABELS.TAX.bn, amountPaisa: input.taxPaisa });
  if (input.tipPaisa !== 0) lines.push({ kind: "TIP", labelEn: QUOTE_LABELS.TIP.en, labelBn: QUOTE_LABELS.TIP.bn, amountPaisa: input.tipPaisa });
  if (input.roundingPaisa !== 0)
    lines.push({ kind: "ROUNDING", labelEn: QUOTE_LABELS.ROUNDING.en, labelBn: QUOTE_LABELS.ROUNDING.bn, amountPaisa: input.roundingPaisa });

  return lines;
}

/** The lines must add up to the total, or the receipt is a lie the customer can do arithmetic on. */
export function quoteLinesSum(lines: readonly QuoteLine[]): number {
  return lines.reduce((sum, line) => sum + line.amountPaisa, 0);
}
