/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MAX_ORDER_LINES,
  MAX_LINE_QUANTITY,
  buildOrderItems,
  itemsReconcile,
  itemsSubtotalPaisa,
  type CatalogueEntry,
} from "../src/domain/order/items.ts";
import { buildStateEvent, firstGap, orderTopic, sseEventName, sseFrame } from "../src/domain/order/state-events.ts";
import type { QuotedItem } from "../src/domain/order/quote.ts";

/**
 * Cart lines and the order's history.
 *
 * Both modules exist to make a claim auditable later: the lines must sum to the subtotal the customer
 * agreed to, and the events must form a dense sequence with no invented steps. These tests are cheap
 * because the failures they prevent are not — a receipt that cannot be reproduced and a history with
 * a hole in it are both discovered by someone angry.
 */

const ORDER_ID = "0193f2a1-7c3e-7890-abcd-ef0123456789";

function catalogue(...entries: readonly (readonly [string, string, number])[]): Map<string, CatalogueEntry> {
  return new Map(
    entries.map(([menuItemId, name, pricePaisa]) => [
      menuItemId,
      { menuItemId, itemId: `item-${name}`, variantId: null, pricePaisa, nameEn: name, nameBn: name },
    ]),
  );
}

const line = (menuItemId: string, quantity: number, unitPricePaisa: number, modifiersPaisa = 0): QuotedItem => ({
  menuItemId,
  quantity,
  unitPricePaisa,
  modifiersPaisa,
});

describe("a cart becoming order rows", () => {
  test("sequence is positional and the line total carries the modifiers", () => {
    const items = buildOrderItems(
      [line("m1", 2, 12_000, 1_500), line("m2", 1, 8_000)],
      catalogue(["m1", "Beef Tehari", 12_000], ["m2", "Borhani", 8_000]),
      ORDER_ID,
    );
    assert.deepEqual(
      items.map((item) => [item.seq, item.quantity, item.unitPricePaisa, item.lineTotalPaisa]),
      [
        [1, 2, 13_500, 27_000],
        [2, 1, 8_000, 8_000],
      ],
    );
    assert.equal(itemsSubtotalPaisa(items), 35_000);
    assert.equal(new Set(items.map((item) => item.id)).size, 2, "each row gets its own id");
  });

  test("the names are frozen from the catalogue, not taken from the cart", () => {
    const items = buildOrderItems([line("m1", 1, 12_000)], catalogue(["m1", "Beef Tehari", 12_000]), ORDER_ID);
    assert.equal(items[0]?.nameEn, "Beef Tehari");
    assert.equal(items[0]?.nameBn, "Beef Tehari");
  });

  test("an empty cart is refused before anything else", () => {
    assert.throws(() => buildOrderItems([], catalogue(), ORDER_ID), { code: "ORDER_ITEMS_EMPTY" });
  });

  test("the same item twice is a changed cart, not a bigger order", () => {
    assert.throws(
      () => buildOrderItems([line("m1", 1, 1_000), line("m1", 2, 1_000)], catalogue(["m1", "Tea", 1_000]), ORDER_ID),
      { code: "ORDER_ITEMS_CHANGED" },
    );
  });

  test("a quantity outside the schema's window is a catalogue refusal", () => {
    for (const quantity of [0, MAX_LINE_QUANTITY + 1, 2.5]) {
      assert.throws(
        () => buildOrderItems([line("m1", quantity, 1_000)], catalogue(["m1", "Tea", 1_000]), ORDER_ID),
        { code: "CATALOG_ITEM_QTY_INVALID" },
      );
    }
  });

  test("an item that has left the catalogue is named as such", () => {
    assert.throws(() => buildOrderItems([line("gone", 1, 1_000)], catalogue(), ORDER_ID), { code: "CATALOG_ITEM_NOT_FOUND" });
  });

  test("more lines than an order may carry is refused", () => {
    const lines = Array.from({ length: MAX_ORDER_LINES + 1 }, (_, index) => line(`m${index}`, 1, 1_000));
    const entries = Array.from({ length: MAX_ORDER_LINES + 1 }, (_, index) => [`m${index}`, `Item ${index}`, 1_000] as const);
    assert.throws(() => buildOrderItems(lines, catalogue(...entries), ORDER_ID), { code: "ORDER_ITEMS_CHANGED" });
  });

  test("the lines must sum to the quoted subtotal", () => {
    const items = buildOrderItems([line("m1", 2, 12_000)], catalogue(["m1", "Tehari", 12_000]), ORDER_ID);
    assert.equal(itemsReconcile(items, { subtotalPaisa: 24_000 }), true);
    assert.equal(itemsReconcile(items, { subtotalPaisa: 24_001 }), false, "one paisa is still a lie");
  });
});

describe("the order's history", () => {
  test("a row defaults its metadata to an empty object and its reasons to null", () => {
    const event = buildStateEvent({ orderId: ORDER_ID, seq: 1, fromState: "DRAFT", toState: "PLACED", actor: "CUSTOMER" });
    assert.deepEqual(event.metadata, {});
    assert.equal(event.reasonCode, null);
    assert.equal(event.actorUserId, null);
  });

  test("a sequence number that is not a positive integer cannot be written", () => {
    for (const seq of [0, -1, 1.5]) {
      assert.throws(() => buildStateEvent({ orderId: ORDER_ID, seq, fromState: "PLACED", toState: "ACCEPTED", actor: "VENDOR" }), RangeError);
    }
  });

  test("a system move cannot claim a person made it", () => {
    assert.throws(
      () => buildStateEvent({ orderId: ORDER_ID, seq: 2, fromState: "PLACED", toState: "AUTO_CANCELLED", actor: "SYSTEM", actorUserId: "0193f2a1-7c3e-7890-abcd-ef0123456700" }),
      /SYSTEM transition carries no user/,
    );
  });

  test("the frame's name comes from the machine", () => {
    assert.equal(sseEventName("PLACED", "ACCEPTED"), "order.accepted");
    assert.equal(sseEventName(null, "DRAFT"), "order.created");
    assert.throws(() => sseEventName("PLACED", "DELIVERED"), /no transition/);
  });

  test("the frame carries state and money together", () => {
    const event = buildStateEvent({ orderId: ORDER_ID, seq: 3, fromState: "ARRIVED", toState: "DELIVERED", actor: "RIDER" });
    const frame = sseFrame(event, { totalPaisa: 54_900, cashCollectedPaisa: 54_900 });
    assert.equal(frame["type"], "order.delivered");
    assert.equal(frame["totalPaisa"], 54_900);
    assert.equal(orderTopic(ORDER_ID), `order:${ORDER_ID}`);
  });

  test("a gap in the sequence is the first number missing, not the last", () => {
    assert.equal(firstGap([1, 2, 3]), null);
    assert.equal(firstGap([1, 3, 4]), 2);
    assert.equal(firstGap([2, 3]), 1);
    assert.equal(firstGap([]), null);
  });
});
