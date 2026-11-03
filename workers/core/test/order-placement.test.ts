/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";
import { PLACEMENT_ROUTES } from "../src/routes/place.ts";
import { QUOTE_ROUTES } from "../src/routes/quotes.ts";
import type { Ctx } from "../src/middleware/context.ts";
import type { Principal } from "../src/rbac/guard.ts";

/**
 * Placing an order from a signed quote (`08 §5`).
 *
 * The property under test is the one the whole quote module exists for: an order is placed at the
 * price the customer was shown, or it is not placed at all. The token is minted by the real quote
 * endpoint rather than hand-built, so these tests exercise the same signing path production uses —
 * a hand-built token would pass a signing test that a real token could fail.
 */

const ITEM_ID = "0193f2a1-7c3e-7890-abcd-ef0123456701";
const ITEM_HEX = "0193f2a17c3e7890abcdef0123456701";
const VENDOR_ID = "0193f2a1-7c3e-7890-abcd-ef0123456702";
const VENDOR_HEX = "0193f2a17c3e7890abcdef0123456702";
const ZONE_HEX = "0193f2a17c3e7890abcdef0123456703";
const CUSTOMER_ID = "0193f2a1-7c3e-7890-abcd-ef012345670c";

const bytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return out;
};

const CUSTOMER: Principal = {
  userId: CUSTOMER_ID,
  actorType: "CUSTOMER",
  role: null,
  sessionId: "s",
  deviceId: "d",
  zoneScope: null,
  stepUpAtMs: null,
  impersonating: false,
};

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

const menuRow = (pricePaisa: number) => ({
  id: bytes(ITEM_HEX),
  name: "Beef Tehari",
  name_bn: "গরুর তেহারি",
  price_paisa: String(pricePaisa),
  availability: "AVAILABLE",
  prep_time_s: "900",
  deleted_at: null,
  vendor_id: bytes(VENDOR_HEX),
});

const OWNER_HEX = "0193f2a17c3e7890abcdef01234567aa";
const ADDRESS_HEX = "0193f2a17c3e7890abcdef01234567bb";

/**
 * A database for one placement.
 *
 * `devices` is what the vendor's owner has registered: the ladder's ring resolves them through
 * `vendors.owner_user_id` → `device_tokens` → `devices`, so a test that places an order now needs answers for
 * those three reads as well as the ones the order itself needs (D94). They are matched before the generic
 * `FROM vendors` handler, which returns the vendor row the placement reads for its open state.
 */
function dbFor(
  options: { menu?: unknown[]; users?: unknown[]; zones?: unknown[]; devices?: string[] } = {},
) {
  return stubDb([
    { match: /owner_user_id/u, rows: [{ owner_user_id: bytes(OWNER_HEX) }] },
    {
      match: /FROM `device_tokens`/u,
      rows: (options.devices ?? ["phone-token-1", "phone-token-2"]).map((fcm_token) => ({ fcm_token })),
    },
    { match: /delivery_address_id/u, rows: [{ delivery_address_id: bytes(ADDRESS_HEX) }] },
    { match: /FROM `addresses`/u, rows: [{ area: "Mirpur" }] },
    { match: /FROM `vendors`/u, rows: [VENDOR_ROW] },
    { match: /FROM `menu_items`/u, rows: options.menu ?? [menuRow(12_000)] },
    { match: /FROM `modifiers`/u, rows: [] },
    { match: /FROM `promo_codes`/u, rows: [] },
    { match: /FROM `zone_pricing`/u, rows: [] },
    { match: /FROM `users`/u, rows: options.users ?? [{ status: "ACTIVE" }] },
    { match: /FROM `zones`/u, rows: options.zones ?? [{ status: "ACTIVE" }] },
    { match: /INSERT INTO `orders`/u, affectedRows: 1 },
    { match: /INSERT INTO `order_items`/u, affectedRows: 1 },
    { match: /INSERT INTO `order_state_events`/u, affectedRows: 1 },
    { match: /FROM `audit_log`/u, rows: [] },
    { match: /INSERT INTO `audit_log`/u, affectedRows: 1 },
  ]);
}

/** The environment a deployment with a stream configured has: somewhere to send a ring. */
const STREAM_ENV = testEnv({
  REALTIME_BASE: "https://rt.undal.example",
  INTERNAL_TOKEN: "internal-token",
} as never);

/** How a test builds the context one placement runs in. */
interface CtxOptions {
  /** The environment, when the test needs the stream configured. */
  readonly env?: ReturnType<typeof testEnv>;
  /** Every promise the route handed to `waitUntil`, so a test can wait for the ring it started. */
  readonly pending?: Promise<unknown>[];
}

function ctxFor(db: ReturnType<typeof stubDb>, principal: Principal | null, options: CtxOptions = {}): Ctx {
  return {
    env: options.env ?? testEnv(),
    db,
    url: new URL("https://api.undal.test/v1/orders"),
    request: new Request("https://api.undal.test/v1/orders", { method: "POST" }),
    requestId: "0193f2a1-7c3e-7890-abcd-ef0123456700",
    ip: "1.2.3.4",
    userAgent: "test",
    keys: [],
    principal,
    locale: "en",
    startedAtMs: 0,
    waitUntil: (promise: Promise<unknown>) => {
      options.pending?.push(promise);
    },
  } as Ctx;
}

const CART = {
  vendorId: VENDOR_ID,
  fulfilment: "DELIVERY",
  deliveryPoint: { lat: 24.8981, lon: 91.8712 },
  items: [{ itemId: ITEM_ID, quantity: 4, modifiers: [], note: null }],
  tipPaisa: 0,
};

/** Ask the real quote endpoint for a token, the way a client would. */
async function quoteToken(db: ReturnType<typeof stubDb>): Promise<{ token: string; totalPaisa: number }> {
  const route = QUOTE_ROUTES[0];
  assert.ok(route !== undefined);
  const response = await route.run(ctxFor(db, null), { params: {}, body: CART, reason: null });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: { quoteToken: string; totalPaisa: number } };
  return { token: body.data.quoteToken, totalPaisa: body.data.totalPaisa };
}

const place = (
  db: ReturnType<typeof stubDb>,
  token: string,
  principal: Principal | null = CUSTOMER,
  options: CtxOptions = {},
): Promise<Response> => {
  const route = PLACEMENT_ROUTES[0];
  assert.ok(route !== undefined);
  return route.run(ctxFor(db, principal, options), {
    params: {},
    body: { quoteToken: token, deliveryPoint: { lat: 24.8981, lon: 91.8712 } },
    reason: null,
  });
};

describe("POST /v1/orders", () => {
  test("a valid quote becomes an order at exactly the price it promised", async () => {
    const quoteDb = dbFor();
    const { token, totalPaisa } = await quoteToken(quoteDb);

    const db = dbFor();
    const response = await place(db, token);
    assert.equal(response.status, 201);
    const body = (await response.json()) as { data: { id: string; code: string; state: string; totalPaisa: number; cashDuePaisa: number } };
    assert.equal(body.data.state, "PLACED");
    assert.equal(body.data.totalPaisa, totalPaisa, "the customer pays what they were shown");
    assert.equal(body.data.cashDuePaisa, totalPaisa, "cash on delivery is the whole total");
    assert.match(body.data.code, /^UND-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/u);

    const writes = db.calls.map((call) => call.sql);
    assert.ok(writes.some((sql) => sql.startsWith("INSERT INTO `orders`")));
    assert.ok(writes.some((sql) => sql.startsWith("INSERT INTO `order_items`")));
    assert.ok(writes.some((sql) => sql.startsWith("INSERT INTO `order_state_events`")));
    assert.ok(writes.some((sql) => sql.startsWith("INSERT INTO `audit_log`")), "a placement is audited");
  });

  test("a price that moved while the customer was deciding is refused with the lines that moved", async () => {
    const { token } = await quoteToken(dbFor());
    const response = await place(dbFor({ menu: [menuRow(13_000)] }), token);
    assert.equal(response.status, 409);
    const body = (await response.json()) as { error: { code: string; details: { diffs: { field: string }[] } } };
    assert.equal(body.error.code, "QUOTE_MISMATCH");
    assert.ok(body.error.details.diffs.length > 0, "the customer is told which lines moved");
  });

  test("an item that left the menu is an ingredient change, not a price change", async () => {
    const { token } = await quoteToken(dbFor());
    const response = await place(dbFor({ menu: [] }), token);
    assert.equal(response.status, 409);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "QUOTE_INGREDIENTS_CHANGED");
  });

  test("a token we did not sign is refused before anything is read", async () => {
    const db = dbFor();
    const response = await place(db, "not.a.token");
    assert.equal(response.status, 409);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "QUOTE_MISMATCH");
    assert.equal(db.calls.length, 0, "a forged token never reaches the database");
  });

  test("an expired quote is expired even at an unchanged price", async () => {
    const { signedQuoteFor } = await import("./helpers/expired-quote.ts");
    const secret = (await import("../src/routes/quotes.ts")).quoteSecret(testEnv().JWT_SIGNING_KEY);
    // Six minutes old: the five-minute promise is about *when* the customer agreed.
    const token = await signedQuoteFor(secret, Date.now() - 6 * 60 * 1000, VENDOR_HEX, ZONE_HEX, ITEM_HEX);
    const response = await place(dbFor(), token);
    // 410 Gone, not 409: the quote is not wrong, it is over — and the app's copy differs accordingly.
    assert.equal(response.status, 410);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "QUOTE_EXPIRED");
  });

  test("a banned customer cannot place", async () => {
    const { token } = await quoteToken(dbFor());
    const response = await place(dbFor({ users: [{ status: "BANNED" }] }), token);
    assert.equal(response.status, 451, "suspended accounts are refused with the legal code");
  });

  test("a guest quote still needs a signed-in customer to place", async () => {
    const { token } = await quoteToken(dbFor());
    const response = await place(dbFor(), token, null);
    assert.equal(response.status, 401);
  });
});

/**
 * The ring, from the route that starts it (D94).
 *
 * D93 wired `ringVendor` into the placement path and recorded that nothing would fail if the call were
 * deleted. These tests are that missing coverage: they place a real order through the real route with a stream
 * configured, wait for whatever the route handed to `waitUntil`, and assert that the vendor's phone was told to
 * ring — or that the failure to tell it was written down.
 */
describe("the vendor's phone", () => {
  /** A fetch stub that answers every call and records it. */
  function stubFetch() {
    const calls: { url: string; body: string }[] = [];
    const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    return { calls, transport };
  }

  /** Run a placement with the stub installed, and wait for the background work it started. */
  async function placeWithRing(db: ReturnType<typeof stubDb>, pending: Promise<unknown>[], transport: typeof fetch) {
    const original = globalThis.fetch;
    globalThis.fetch = transport;
    try {
      const { token } = await quoteToken(db);
      const response = await place(db, token, CUSTOMER, { env: STREAM_ENV, pending });
      assert.equal(response.status, 201);
      await Promise.all(pending);
    } finally {
      globalThis.fetch = original;
    }
  }

  test("a placed order rings every device the vendor's owner registered", async () => {
    const db = dbFor();
    const { calls, transport } = stubFetch();
    const pending: Promise<unknown>[] = [];
    await placeWithRing(db, pending, transport);

    assert.equal(pending.length > 0, true, "the ring is background work, not a blocking call");
    const ring = calls.find((call) => call.url.endsWith("/internal/ladder/begin"));
    assert.notEqual(ring, undefined, "the ladder was told to begin");
    const body = JSON.parse(ring?.body ?? "{}") as {
      orderCode: string;
      zoneId: string;
      devices: string[];
      push: { severity: string; totalPaisa: number; customerArea: string; expiresAtMs: number; issuedAtMs: number };
    };
    assert.match(body.orderCode, /^UND-/u);
    assert.equal(body.zoneId !== "", true);
    assert.deepEqual(body.devices, ["phone-token-1", "phone-token-2"]);
    assert.equal(body.push.severity, "CRITICAL");
    assert.equal(body.push.customerArea, "Mirpur");
    assert.equal(body.push.totalPaisa > 0, true);
    assert.equal(body.push.expiresAtMs - body.push.issuedAtMs, 120_000, "the push expires with the ladder");
  });

  test("a vendor with no registered phone is written down instead of rung", async () => {
    const db = dbFor({ devices: [] });
    const { calls, transport } = stubFetch();
    const pending: Promise<unknown>[] = [];
    await placeWithRing(db, pending, transport);

    assert.equal(calls.some((call) => call.url.endsWith("/internal/ladder/begin")), false, "nothing to ring");
    const audit = db.calls.filter((call) => /INSERT INTO `audit_log`/u.test(call.sql));
    const written = audit.map((call) => JSON.stringify(call.params)).join("\n");
    assert.match(written, /ladder\.unrung/u);
    assert.match(written, /no_device/u);
  });

  test("a deployment with no stream configured places the order and rings nothing", async () => {
    const db = dbFor();
    const { calls, transport } = stubFetch();
    const original = globalThis.fetch;
    globalThis.fetch = transport;
    try {
      const { token } = await quoteToken(db);
      const pending: Promise<unknown>[] = [];
      const response = await place(db, token, CUSTOMER, { pending });
      assert.equal(response.status, 201);
      await Promise.all(pending);
    } finally {
      globalThis.fetch = original;
    }
    assert.deepEqual(calls, []);
  });
});
