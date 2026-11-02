/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";
import { PICKUP_ROUTES, orderQrSecret } from "../src/routes/pickup.ts";
import { VALIDATE_ROUTES } from "../src/routes/validate.ts";
import { renderPickupPayload } from "../src/domain/order/qr.ts";
import type { Ctx } from "../src/middleware/context.ts";
import type { Principal } from "../src/rbac/guard.ts";

/**
 * Collecting the food, and the pre-flight that comes before ordering at all.
 *
 * The pickup test scans a code minted by the real signer, from the real geofence, because the point of
 * the route is that a rider who is not at the counter cannot move an order — a hand-built payload
 * would test the parser and not the rule.
 */

const ORDER_ID = "0193f2a1-7c3e-7890-abcd-ef0123456709";
const ORDER_HEX = "0193f2a17c3e7890abcdef0123456709";
const RIDER_ID = "0193f2a1-7c3e-7890-abcd-ef0123456707";
const RIDER_HEX = "0193f2a17c3e7890abcdef0123456707";
const VENDOR_HEX = "0193f2a17c3e7890abcdef0123456702";
const CUSTOMER_HEX = "0193f2a17c3e7890abcdef012345670c";
const ZONE_HEX = "0193f2a17c3e7890abcdef0123456703";
const ORDER_CODE = "UND-7K2M9QX4";

const bytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
};

const RIDER: Principal = {
  // `principal.userId` is the canonical 32-hex form the rest of the worker compares against.
  userId: RIDER_HEX,
  actorType: "RIDER",
  role: null,
  sessionId: "s",
  deviceId: "d",
  zoneScope: null,
  stepUpAtMs: null,
  impersonating: false,
};

const ORDER_ROW = {
  id: bytes(ORDER_HEX),
  code: ORDER_CODE,
  customer_user_id: bytes(CUSTOMER_HEX),
  vendor_id: bytes(VENDOR_HEX),
  zone_id: bytes(ZONE_HEX),
  fulfilment: "DELIVERY",
  state: "RIDER_ASSIGNED",
  pickup_lat_e7: 248_981_000,
  pickup_lon_e7: 918_712_000,
  subtotal_paisa: "48000",
  discount_paisa: "0",
  delivery_fee_paisa: "7042",
  small_order_fee_paisa: "2500",
  tax_paisa: "439",
  tip_paisa: "0",
  rounding_paisa: "-81",
  total_paisa: "57900",
  cash_collected_paisa: null,
  commission_paisa: "6750",
  rider_bonus_paisa: "1350",
  rider_payout_paisa: "8370",
  vendor_payout_paisa: "37400",
  surge_bps: "10000",
  prep_time_s: "900",
  rider_id: bytes(RIDER_HEX),
  customer_note: null,
  placed_at: "2026-11-02 10:00:00.000000",
  created_at: "2026-11-02 10:00:00.000000",
  updated_at: "2026-11-02 10:00:00.000000",
};

function pickupDb(state = "RIDER_ASSIGNED") {
  return stubDb([
    { match: /FROM `orders` WHERE `id`/u, rows: [{ ...ORDER_ROW, state }] },
    { match: /MAX\(`seq`\)/u, rows: [{ last: 2 }] },
    { match: /UPDATE `orders` SET/u, affectedRows: 1 },
    { match: /INSERT INTO `order_state_events`/u, affectedRows: 1 },
    { match: /INSERT INTO `order_proofs`/u, affectedRows: 1 },
    { match: /FROM `order_proofs`/u, rows: [] },
    { match: /FROM `audit_log`/u, rows: [] },
    { match: /INSERT INTO `audit_log`/u, affectedRows: 1 },
  ]);
}

function ctxFor(db: ReturnType<typeof stubDb>, principal: Principal | null, path = "/v1/orders/x/pickup"): Ctx {
  return {
    env: testEnv(),
    db,
    url: new URL(`https://api.undal.test${path}`),
    request: new Request(`https://api.undal.test${path}`, { method: "POST" }),
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

const AT_THE_COUNTER = { lat: 24.8982, lon: 91.8713 };
const DOWN_THE_ROAD = { lat: 24.9021, lon: 91.8744 };

async function scanFor(nowMs: number): Promise<string> {
  return renderPickupPayload(orderQrSecret(testEnv().ORDER_QR_SECRET, ORDER_HEX), ORDER_CODE, nowMs);
}

const runPickup = (db: ReturnType<typeof stubDb>, body: unknown, principal: Principal | null = RIDER): Promise<Response> => {
  const route = PICKUP_ROUTES[0];
  assert.ok(route !== undefined);
  return route.run(ctxFor(db, principal), { params: { id: ORDER_ID }, body, reason: null });
};

describe("POST /v1/orders/{id}/pickup", () => {
  test("a scan at the counter moves the order and leaves a proof", async () => {
    const db = pickupDb();
    const response = await runPickup(db, { code: await scanFor(Date.now()), point: AT_THE_COUNTER });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: { state: string; seq: number; proofId: string } };
    assert.equal(body.data.state, "PICKED_UP");
    assert.equal(body.data.seq, 3);
    assert.ok(db.calls.some((call) => call.sql.startsWith("INSERT INTO `order_proofs`")));
    assert.ok(db.calls.some((call) => call.sql.startsWith("INSERT INTO `audit_log`")));
  });

  test("a scan from down the road cannot claim a meal has left the kitchen", async () => {
    const response = await runPickup(pickupDb(), { code: await scanFor(Date.now()), point: DOWN_THE_ROAD });
    assert.equal(response.status, 422);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "QR_TOO_FAR");
  });

  test("a code for another order is refused as the wrong order", async () => {
    const otherCode = await renderPickupPayload(orderQrSecret(testEnv().ORDER_QR_SECRET, ORDER_HEX), "UND-XXXXXXXX", Date.now());
    const response = await runPickup(pickupDb(), { code: otherCode, point: AT_THE_COUNTER });
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "QR_WRONG_ORDER");
  });

  test("an order that is not waiting at the counter is already scanned, whatever the code says", async () => {
    const response = await runPickup(pickupDb("PICKED_UP"), { code: await scanFor(Date.now()), point: AT_THE_COUNTER });
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "QR_ALREADY_SCANNED");
  });

  test("another rider is told the order does not exist", async () => {
    const stranger: Principal = { ...RIDER, userId: "0193f2a17c3e7890abcdef0123456708" };
    const response = await runPickup(pickupDb(), { code: await scanFor(Date.now()), point: AT_THE_COUNTER }, stranger);
    assert.equal(response.status, 404);
  });

  test("a body with no position is refused before any scan is verified", async () => {
    const response = await runPickup(pickupDb(), { code: await scanFor(Date.now()) });
    assert.equal(response.status, 422);
    const body = (await response.json()) as { error: { details: { field: string } } };
    assert.equal(body.error.details.field, "point");
  });
});

describe("POST /v1/orders/validate", () => {
  const CUSTOMER: Principal = { ...RIDER, userId: CUSTOMER_HEX, actorType: "CUSTOMER" };

  const VALID_BODY = {
    vendorId: "0193f2a1-7c3e-7890-abcd-ef0123456702",
    fulfilment: "DELIVERY",
    deliveryPoint: { lat: 24.8981, lon: 91.8712 },
    items: [{ itemId: "0193f2a1-7c3e-7890-abcd-ef0123456701", quantity: 4, modifiers: [], note: null }],
    tipPaisa: 0,
  };

  const validateDb = (overrides: { openState?: string; minOrderPaisa?: string } = {}) =>
    stubDb([
      {
        match: /FROM `vendors`/u,
        rows: [
          {
            id: bytes(VENDOR_HEX),
            zone_id: bytes(ZONE_HEX),
            name: "Tehari Ghor",
            status: "APPROVED",
            open_state: overrides.openState ?? "OPEN",
            lat_e7: 248_981_000,
            lon_e7: 918_712_000,
            min_order_paisa: overrides.minOrderPaisa ?? "10000",
            max_delivery_m: "8000",
            deleted_at: null,
          },
        ],
      },
      {
        match: /FROM `menu_items`/u,
        rows: [
          {
            id: bytes("0193f2a17c3e7890abcdef0123456701"),
            name: "Beef Tehari",
            name_bn: "গরুর তেহারি",
            price_paisa: "12000",
            availability: "AVAILABLE",
            prep_time_s: "900",
            deleted_at: null,
            vendor_id: bytes(VENDOR_HEX),
          },
        ],
      },
      { match: /FROM `modifiers`/u, rows: [] },
      { match: /FROM `promo_codes`/u, rows: [] },
      { match: /FROM `zone_pricing`/u, rows: [] },
    ]);

  const runValidate = (db: ReturnType<typeof stubDb>, body: unknown): Promise<Response> => {
    const route = VALIDATE_ROUTES[0];
    assert.ok(route !== undefined);
    return route.run(ctxFor(db, CUSTOMER, "/v1/orders/validate"), { params: {}, body, reason: null });
  };

  test("a placeable cart answers 200 with every check passing", async () => {
    const response = await runValidate(validateDb(), VALID_BODY);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: { canPlace: boolean; checks: { name: string; ok: boolean }[]; prepTimeS: number } };
    assert.equal(body.data.canPlace, true);
    assert.equal(body.data.checks.length, 4);
    assert.ok(body.data.checks.every((check) => check.ok));
    assert.equal(body.data.prepTimeS, 900);
  });

  test("a closed kitchen is a failed check, not an error", async () => {
    const response = await runValidate(validateDb({ openState: "CLOSED" }), VALID_BODY);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: { canPlace: boolean; checks: { name: string; ok: boolean; code: string | null }[] } };
    assert.equal(body.data.canPlace, false);
    const vendorCheck = body.data.checks.find((check) => check.name === "VENDOR_OPEN");
    assert.equal(vendorCheck?.ok, false);
    assert.equal(vendorCheck?.code, "CATALOG_VENDOR_CLOSED");
    assert.equal(body.data.checks.find((check) => check.name === "ITEMS_AVAILABLE")?.ok, true);
  });

  test("a basket under the minimum names the minimum it is under", async () => {
    const response = await runValidate(validateDb({ minOrderPaisa: "60000" }), VALID_BODY);
    const body = (await response.json()) as { data: { canPlace: boolean; checks: { name: string; ok: boolean; details: { minOrderPaisa?: number } }[] } };
    assert.equal(body.data.canPlace, false);
    const minimum = body.data.checks.find((check) => check.name === "MINIMUM_MET");
    assert.equal(minimum?.ok, false);
    assert.equal(minimum?.details.minOrderPaisa, 60_000);
  });

  test("a malformed body is still an error, because there is no cart to opine about", async () => {
    const response = await runValidate(validateDb(), { vendorId: "x" });
    assert.equal(response.status, 422);
  });
});
