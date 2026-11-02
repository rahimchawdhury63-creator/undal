/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";
import { QUOTE_ROUTES } from "../src/routes/quotes.ts";
import type { Ctx } from "../src/middleware/context.ts";
import type { Principal } from "../src/rbac/guard.ts";
import { applyPromo, priceCart, quoteLines, quoteLinesSum, CartRefused, type MenuEntry, type ModifierEntry } from "../src/domain/order/cart.ts";

/**
 * A cart, priced — and the quote endpoint that publishes it.
 *
 * The pure half is tested first because it is where the money is decided: lines, modifiers, the
 * subtotal, the promotion clamp, and the receipt's own arithmetic. The route half is tested for the
 * decisions that are not arithmetic — a closed vendor, a basket under the minimum, an address past
 * the delivery radius, a promotion that does not exist.
 */

const ITEM_ID = "0193f2a1-7c3e-7890-abcd-ef0123456701";
const ITEM_HEX = "0193f2a17c3e7890abcdef0123456701";
const VENDOR_ID = "0193f2a1-7c3e-7890-abcd-ef0123456702";
const VENDOR_HEX = "0193f2a17c3e7890abcdef0123456702";
const ZONE_HEX = "0193f2a17c3e7890abcdef0123456703";
const MODIFIER_ID = "0193f2a1-7c3e-7890-abcd-ef0123456704";
const MODIFIER_HEX = "0193f2a17c3e7890abcdef0123456704";

const bytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
};

const MENU = new Map<string, MenuEntry>([
  [ITEM_HEX, { itemId: ITEM_HEX, nameEn: "Beef Tehari", nameBn: "গরুর তেহারি", pricePaisa: 12_000, available: true, prepTimeS: 900 }],
]);
const MODIFIERS = new Map<string, ModifierEntry>([[MODIFIER_HEX, { modifierId: MODIFIER_HEX, groupId: "g1", priceDeltaPaisa: 1_500, available: true }]]);

describe("pricing a cart", () => {
  test("a line is its item plus its modifiers, times its quantity", () => {
    const priced = priceCart([{ itemId: ITEM_HEX, quantity: 2, modifiers: [MODIFIER_HEX], note: null }], MENU, MODIFIERS);
    assert.equal(priced.lines[0]?.lineTotalPaisa, 27_000);
    assert.equal(priced.subtotalPaisa, 27_000);
    assert.equal(priced.prepTimeS, 900);
  });

  test("the kitchen's promise is the longest line, not the first", () => {
    const slow = new Map(MENU);
    slow.set("other", { itemId: "other", nameEn: "Biryani", nameBn: "বিরিয়ানি", pricePaisa: 1_000, available: true, prepTimeS: 2_400 });
    const priced = priceCart(
      [
        { itemId: ITEM_HEX, quantity: 1, modifiers: [], note: null },
        { itemId: "other", quantity: 1, modifiers: [], note: null },
      ],
      slow,
      MODIFIERS,
    );
    assert.equal(priced.prepTimeS, 2_400);
  });

  test("an empty cart, a sold-out item and a bad quantity are all refusals", () => {
    assert.throws(() => priceCart([], MENU, MODIFIERS), { code: "ORDER_ITEMS_EMPTY" });
    assert.throws(() => priceCart([{ itemId: "gone", quantity: 1, modifiers: [], note: null }], MENU, MODIFIERS), { code: "CATALOG_ITEM_NOT_FOUND" });
    assert.throws(() => priceCart([{ itemId: ITEM_HEX, quantity: 21, modifiers: [], note: null }], MENU, MODIFIERS), {
      code: "CATALOG_ITEM_QTY_INVALID",
    });

    const soldOut = new Map<string, MenuEntry>([[ITEM_HEX, { ...MENU.get(ITEM_HEX)!, available: false }]]);
    assert.throws(() => priceCart([{ itemId: ITEM_HEX, quantity: 1, modifiers: [], note: null }], soldOut, MODIFIERS), {
      code: "CATALOG_ITEM_SOLD_OUT",
    });
  });

  test("the same item with the same choices twice is refused, but two notes are two lines", () => {
    assert.throws(
      () =>
        priceCart(
          [
            { itemId: ITEM_HEX, quantity: 1, modifiers: [], note: null },
            { itemId: ITEM_HEX, quantity: 1, modifiers: [], note: null },
          ],
          MENU,
          MODIFIERS,
        ),
      { code: "ORDER_ITEMS_CHANGED" },
    );

    const twoNotes = priceCart(
      [
        { itemId: ITEM_HEX, quantity: 1, modifiers: [], note: "কম ঝাল" },
        { itemId: ITEM_HEX, quantity: 1, modifiers: [], note: null },
      ],
      MENU,
      MODIFIERS,
    );
    assert.equal(twoNotes.subtotalPaisa, 24_000);
  });

  test("an unavailable modifier is an option refusal", () => {
    const off = new Map<string, ModifierEntry>([[MODIFIER_HEX, { ...MODIFIERS.get(MODIFIER_HEX)!, available: false }]]);
    assert.throws(() => priceCart([{ itemId: ITEM_HEX, quantity: 1, modifiers: [MODIFIER_HEX], note: null }], MENU, off), {
      code: "CATALOG_ITEM_OPTION_INVALID",
    });
  });
});

describe("a promotion", () => {
  test("a percentage discount rounds through the money law and respects its cap", () => {
    const ten = applyPromo({ code: "TEN", kind: "PERCENT", valueBps: 1_000, valuePaisa: null, minSubtotalPaisa: 0, maxDiscountPaisa: null }, 45_000);
    assert.equal(ten.discountPaisa, 4_500);
    const capped = applyPromo({ code: "TEN", kind: "PERCENT", valueBps: 5_000, valuePaisa: null, minSubtotalPaisa: 0, maxDiscountPaisa: 2_000 }, 45_000);
    assert.equal(capped.discountPaisa, 2_000);
  });

  test("a discount never exceeds the basket", () => {
    const flat = applyPromo({ code: "BIG", kind: "FLAT", valueBps: null, valuePaisa: 50_000, minSubtotalPaisa: 0, maxDiscountPaisa: null }, 9_000);
    assert.equal(flat.discountPaisa, 9_000);
  });

  test("a basket below the minimum is refused with a reason, not silently discounted", () => {
    const effect = applyPromo({ code: "MIN", kind: "PERCENT", valueBps: 1_000, valuePaisa: null, minSubtotalPaisa: 50_000, maxDiscountPaisa: null }, 45_000);
    assert.equal(effect.discountPaisa, 0);
    assert.equal(effect.refused, "PROMO_MIN_ORDER_NOT_MET");
  });
});

describe("the receipt's own arithmetic", () => {
  test("zero lines are dropped, except the subtotal and a code the customer typed", () => {
    const lines = quoteLines({
      subtotalPaisa: 45_000,
      discountPaisa: 0,
      discountCode: "NOPE",
      deliveryFeePaisa: 0,
      smallOrderFeePaisa: 0,
      taxPaisa: 0,
      tipPaisa: 0,
      roundingPaisa: 0,
    });
    assert.deepEqual(
      lines.map((line) => line.kind),
      ["SUBTOTAL", "DISCOUNT"],
    );
  });

  test("the lines add up to the total, discount included as a negative", () => {
    const lines = quoteLines({
      subtotalPaisa: 45_000,
      discountPaisa: 4_500,
      discountCode: "TEN",
      deliveryFeePaisa: 7_042,
      smallOrderFeePaisa: 2_500,
      taxPaisa: 439,
      tipPaisa: 0,
      roundingPaisa: -81,
    });
    assert.equal(quoteLinesSum(lines), 50_400);
  });
});

const PRINCIPAL: Principal = {
  userId: "0193f2a1-7c3e-7890-abcd-ef0123456709",
  actorType: "CUSTOMER",
  role: null,
  sessionId: "s",
  deviceId: "d",
  zoneScope: null,
  stepUpAtMs: null,
  impersonating: false,
};

function ctxFor(db: ReturnType<typeof stubDb>, principal: Principal | null = null): Ctx {
  return {
    env: testEnv(),
    db,
    url: new URL("https://api.undal.test/v1/orders/quote"),
    request: new Request("https://api.undal.test/v1/orders/quote", { method: "POST" }),
    requestId: "0193f2a1-7c3e-7890-abcd-ef0123456700",
    ip: "1.2.3.4",
    userAgent: "test",
    keys: [],
    principal,
    locale: "en",
    startedAtMs: 0,
    waitUntil: () => undefined,
  } as Ctx;
}

const VENDOR_ROW = {
  id: bytes(VENDOR_HEX),
  zone_id: bytes(ZONE_HEX),
  name: "Tehari Ghor",
  status: "APPROVED",
  open_state: "OPEN",
  lat_e7: 24_898_1000,
  lon_e7: 91_871_2000,
  min_order_paisa: "10000",
  max_delivery_m: "8000",
  deleted_at: null,
};

const MENU_ROW = {
  id: bytes(ITEM_HEX),
  name: "Beef Tehari",
  name_bn: "গরুর তেহারি",
  price_paisa: "12000",
  availability: "AVAILABLE",
  prep_time_s: "900",
  deleted_at: null,
  vendor_id: bytes(VENDOR_HEX),
  created_at: "2026-11-01 10:00:00.000000",
};

function quoteDb(overrides: { vendor?: Partial<typeof VENDOR_ROW>; promo?: unknown[] } = {}) {
  return stubDb([
    { match: /FROM `vendors`/u, rows: [{ ...VENDOR_ROW, ...overrides.vendor }] },
    { match: /FROM `menu_items`/u, rows: [MENU_ROW] },
    { match: /FROM `modifiers`/u, rows: [] },
    { match: /FROM `promo_codes`/u, rows: overrides.promo ?? [] },
    { match: /FROM `zone_pricing`/u, rows: [] },
  ]);
}

const BODY = {
  vendorId: VENDOR_ID,
  fulfilment: "DELIVERY",
  deliveryPoint: { lat: 24.8981, lon: 91.8712 },
  items: [{ itemId: ITEM_ID, quantity: 4, modifiers: [], note: null }],
  tipPaisa: 0,
};

const runQuote = (db: ReturnType<typeof stubDb>, body: unknown, principal: Principal | null = null): Promise<Response> => {
  const route = QUOTE_ROUTES[0];
  assert.ok(route !== undefined);
  return route.run(ctxFor(db, principal), { params: {}, body, reason: null });
};

describe("POST /v1/orders/quote", () => {
  test("a guest gets a signed quote whose lines sum to its total", async () => {
    const response = await runQuote(quoteDb(), BODY);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      data: { totalPaisa: number; quoteToken: string; lines: { amountPaisa: number }[]; fareSource: string; warnings: string[] };
    };
    assert.equal(typeof body.data.quoteToken, "string");
    assert.equal(body.data.fareSource, "FALLBACK");
    assert.equal(
      body.data.lines.reduce((sum, line) => sum + line.amountPaisa, 0),
      body.data.totalPaisa,
    );
    assert.deepEqual(body.data.warnings, []);
  });

  test("the total is whole taka even when a code zeroes the delivery fee", async () => {
    const free = [
      {
        code: "FREEDEL",
        kind: "FREE_DELIVERY",
        value_bps: null,
        value_paisa: null,
        min_subtotal_paisa: "0",
        max_discount_paisa: null,
        active: "1",
        starts_at: "2026-01-01 00:00:00.000000",
        ends_at: null,
      },
    ];
    const response = await runQuote(quoteDb({ promo: free }), { ...BODY, promoCode: "FREEDEL" });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: { totalPaisa: number; lines: { kind: string; amountPaisa: number }[] } };
    assert.equal(body.data.totalPaisa % 100, 0, "a total the customer pays in cash is whole taka");
    assert.equal(
      body.data.lines.reduce((sum, line) => sum + line.amountPaisa, 0),
      body.data.totalPaisa,
    );
    assert.equal(
      body.data.lines.some((line) => line.kind === "DELIVERY_FEE"),
      false,
      "a free delivery is not shown as a ৳0 charge",
    );
  });

  test("the quote records the customer when one is signed in", async () => {
    const response = await runQuote(quoteDb(), BODY, PRINCIPAL);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: { quoteToken: string } };
    assert.match(body.data.quoteToken.split(".")[0] ?? "", new RegExp(PRINCIPAL.userId, "u"));
  });

  test("a closed kitchen is refused before any price is computed", async () => {
    const response = await runQuote(quoteDb({ vendor: { open_state: "CLOSED" } }), BODY);
    assert.equal(response.status, 409);
  });

  test("a basket under the vendor's minimum is refused, with both numbers", async () => {
    const small = { ...BODY, items: [{ itemId: ITEM_ID, quantity: 1, modifiers: [], note: null }] };
    const response = await runQuote(quoteDb({ vendor: { min_order_paisa: "20000" } }), small);
    assert.equal(response.status, 422);
    const body = (await response.json()) as { error: { code: string; details: { minOrderPaisa: number; subtotalPaisa: number } } };
    assert.equal(body.error.code, "QUOTE_BELOW_MINIMUM");
    assert.equal(body.error.details.minOrderPaisa, 20_000);
    assert.equal(body.error.details.subtotalPaisa, 12_000);
  });

  test("an address past the delivery radius is refused with the distance", async () => {
    const far = { ...BODY, deliveryPoint: { lat: 24.99, lon: 91.99 } };
    const response = await runQuote(quoteDb(), far);
    assert.equal(response.status, 422);
    const body = (await response.json()) as { error: { code: string; details: { distanceM: number } } };
    assert.equal(body.error.code, "QUOTE_ADDRESS_OUT_OF_RANGE");
    assert.ok(body.error.details.distanceM > 8_000);
  });

  test("a promotion that does not exist is a warning, and the price is still honest", async () => {
    const response = await runQuote(quoteDb(), { ...BODY, promoCode: "GHOST" });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: { warnings: string[]; lines: { kind: string }[] } };
    assert.deepEqual(body.data.warnings, ["PROMO_UNKNOWN"]);
    assert.equal(
      body.data.lines.some((line) => line.kind === "DISCOUNT"),
      true,
      "a code the customer typed is always answered",
    );
  });

  test("a live percentage code reduces the total by exactly its discount", async () => {
    const plain = (await (await runQuote(quoteDb(), BODY)).json()) as { data: { totalPaisa: number } };
    const promo = [
      {
        code: "TEN",
        kind: "PERCENT",
        value_bps: "1000",
        value_paisa: null,
        min_subtotal_paisa: "0",
        max_discount_paisa: null,
        active: "1",
        starts_at: "2026-01-01 00:00:00.000000",
        ends_at: null,
      },
    ];
    const discounted = (await (await runQuote(quoteDb({ promo }), { ...BODY, promoCode: "ten" })).json()) as {
      data: { totalPaisa: number; lines: { kind: string; amountPaisa: number }[] };
    };
    const line = discounted.data.lines.find((candidate) => candidate.kind === "DISCOUNT");
    assert.ok(line !== undefined);
    assert.equal(line.amountPaisa, -4_800);
    assert.ok(discounted.data.totalPaisa < plain.data.totalPaisa);
  });

  test("a body that is not a quote request is refused by field name", async () => {
    const response = await runQuote(quoteDb(), { vendorId: VENDOR_ID, items: [] });
    assert.equal(response.status, 422);
    const body = (await response.json()) as { error: { details: { field: string } } };
    assert.equal(body.error.details.field, "deliveryPoint");
  });
});
