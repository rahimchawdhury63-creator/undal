/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { newId, toHexId } from "../../lib/ids.ts";

import type { QuotedItem, QuoteTotals } from "./quote.ts";

/**
 * Cart lines, frozen into rows.
 *
 * An `order_items` row is a photograph, not a pointer: the name the customer read, the price they
 * agreed to and the quantity they chose are copied in. A menu rename next month must not rewrite an
 * invoice from last month, and a price rise must not retroactively overcharge a delivered order.
 *
 * This module is the only place a cart becomes rows, so it is also the only place that can refuse
 * one. The refusals are catalogue codes, not order codes, because the customer is still shopping:
 * telling them `ORDER_ITEMS_CHANGED` when a line was simply out of stock is a worse message.
 */

/** How many distinct lines one order may carry. */
export const MAX_ORDER_LINES = 50;

/** The smallest quantity a line may carry; zero is a deleted line, not a cheap one. */
export const MIN_LINE_QUANTITY = 1;

/** The largest quantity one line may carry, matching `order_items.quantity`'s check constraint. */
export const MAX_LINE_QUANTITY = 20;

/** The catalogue facts a line needs, looked up once at placement. */
export interface CatalogueEntry {
  readonly menuItemId: string;
  readonly itemId: string;
  readonly variantId: string | null;
  /**
   * The price the catalogue holds *now*. It is recorded so a placement can prove it charged the
   * quoted price even if the menu has since moved; it is never used to override the quote.
   */
  readonly pricePaisa: number;
  readonly nameEn: string;
  readonly nameBn: string;
}

/** One row for `order_items`, before the id is minted by the caller's transaction. */
export interface OrderItemDraft {
  readonly id: string;
  readonly orderId: string;
  readonly itemId: string;
  readonly variantId: string | null;
  readonly seq: number;
  readonly nameEn: string;
  readonly nameBn: string;
  readonly unitPricePaisa: number;
  readonly quantity: number;
  readonly lineTotalPaisa: number;
  readonly notes: string | null;
}

/** A cart that cannot become an order, carrying a code the app already knows how to render. */
export class ItemsRefused extends Error {
  readonly code: "ORDER_ITEMS_EMPTY" | "CATALOG_ITEM_NOT_FOUND" | "CATALOG_ITEM_QTY_INVALID" | "ORDER_ITEMS_CHANGED";

  constructor(code: ItemsRefused["code"], message: string) {
    super(message);
    this.name = "ItemsRefused";
    this.code = code;
  }
}

/**
 * Turn quoted lines into order rows.
 *
 * `seq` is positional and one-based because `uq_order_items_seq` is what makes the customer's list
 * and the receipt's list the same list; a re-ordered cart needs a new order, not a re-numbering.
 * The unit price is the quoted unit price plus its modifiers — the modifier breakdown is not stored
 * per row, because the receipt shows the customer one number per line and a second number that
 * disagrees is worse than no number at all.
 */
export function buildOrderItems(
  quoted: readonly QuotedItem[],
  catalogue: ReadonlyMap<string, CatalogueEntry>,
  orderId: string,
): readonly OrderItemDraft[] {
  if (quoted.length === 0) throw new ItemsRefused("ORDER_ITEMS_EMPTY", "a cart needs at least one line");
  if (quoted.length > MAX_ORDER_LINES)
    throw new ItemsRefused("ORDER_ITEMS_CHANGED", `${quoted.length} lines exceeds the ${MAX_ORDER_LINES} an order may carry`);

  const seen = new Set<string>();
  return quoted.map((line, index) => {
    if (seen.has(line.menuItemId)) throw new ItemsRefused("ORDER_ITEMS_CHANGED", `menu item ${line.menuItemId} appears twice`);
    seen.add(line.menuItemId);

    if (!Number.isInteger(line.quantity) || line.quantity < MIN_LINE_QUANTITY || line.quantity > MAX_LINE_QUANTITY)
      throw new ItemsRefused(
        "CATALOG_ITEM_QTY_INVALID",
        `quantity ${line.quantity} is outside ${MIN_LINE_QUANTITY}..${MAX_LINE_QUANTITY}`,
      );

    const entry = catalogue.get(line.menuItemId);
    if (entry === undefined) throw new ItemsRefused("CATALOG_ITEM_NOT_FOUND", `menu item ${line.menuItemId} is not in the catalogue`);

    if (!Number.isInteger(line.unitPricePaisa) || line.unitPricePaisa < 0 || !Number.isInteger(line.modifiersPaisa) || line.modifiersPaisa < 0)
      throw new ItemsRefused("ORDER_ITEMS_CHANGED", `menu item ${line.menuItemId} carries a non-integer price`);

    const unitPricePaisa = line.unitPricePaisa + line.modifiersPaisa;
    return {
      id: toHexId(newId()),
      orderId,
      itemId: entry.itemId,
      variantId: entry.variantId,
      seq: index + 1,
      nameEn: entry.nameEn,
      nameBn: entry.nameBn,
      unitPricePaisa,
      quantity: line.quantity,
      lineTotalPaisa: unitPricePaisa * line.quantity,
      notes: null,
    };
  });
}

/** What the lines add up to, which is what `subtotal_paisa` must equal. */
export function itemsSubtotalPaisa(items: readonly OrderItemDraft[]): number {
  return items.reduce((sum, item) => sum + item.lineTotalPaisa, 0);
}

/**
 * Whether the frozen lines still explain the quoted subtotal.
 *
 * The quote stores `subtotal` as a total, and a total is a claim nobody can audit line by line. This
 * check is what turns the claim back into arithmetic: if the lines do not sum to it, the order is
 * written with a subtotal that no receipt can reproduce, and the difference shows up months later as
 * a settlement dispute nobody can adjudicate.
 */
export function itemsReconcile(items: readonly OrderItemDraft[], totals: Pick<QuoteTotals, "subtotalPaisa">): boolean {
  return itemsSubtotalPaisa(items) === totals.subtotalPaisa;
}
