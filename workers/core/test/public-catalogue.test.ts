/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The public catalogue: what an anonymous visitor may read.
 *
 * Three promises are tested here. A browser never sees a vendor that is not approved. Money
 * arrives as integer paisa and never as a formatted string, because formatting belongs to the
 * client that knows the locale. And an empty platform answers with empty lists and a real
 * status — never an error, never invented data — because that is the state the storefront
 * ships in on day one.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { decodeCursor } from "@undal/contracts";

import { PUBLIC_ROUTES } from "../src/routes/public.ts";
import { escapeLike } from "../src/repositories/catalogue.ts";
import type { Ctx, RouteDefinition } from "../src/middleware/context.ts";
import type { Db } from "../src/db/client.ts";
import { stubDb } from "../src/db/client.ts";
import { testEnv } from "./support.ts";

const VENDOR_HEX = "0193f2a17c3e7890abcdef0123456709";
const SECTION_HEX = "0193f2a17c3e7890abcdef0123456720";
const ITEM_HEX = "0193f2a17c3e7890abcdef0123456721";
const GROUP_HEX = "0193f2a17c3e7890abcdef0123456722";
const MODIFIER_HEX = "0193f2a17c3e7890abcdef0123456723";

const LAT0 = 248_981_000;
const LON0 = 918_698_000;

function bytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "hex"));
}

function vendorRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: bytes(VENDOR_HEX),
    slug: "rahman-biriyani",
    name: "Rahman's Biriyani",
    name_bn: "রহমানের বিরিয়ানি",
    tagline: "Since 1994",
    kind: "RESTAURANT",
    open_state: "OPEN",
    busy_level: 0,
    min_order_paisa: 15_000,
    prep_time_default_s: 1_200,
    cover_url: "https://i.ibb.co/cover.jpg",
    cover_blurhash: "LEHV6n",
    logo_url: null,
    logo_blurhash: null,
    supports_pickup: 1,
    supports_delivery: 1,
    lat_e7: LAT0,
    lon_e7: LON0,
    zone_id: bytes(VENDOR_HEX),
    updated_at: "2026-11-20 10:00:00.000000",
    rating_sum: 4_520,
    rating_count: 1_000,
    orders_completed: 932,
    sort_key: 4_520,
    ...overrides,
  };
}

function ctxFor(db: Db, path: string, params: Record<string, string> = {}): Ctx {
  return {
    env: testEnv(),
    db,
    url: new URL(`https://api.undal.test${path}`),
    request: new Request(`https://api.undal.test${path}`),
    requestId: "req-public-1",
    ip: "203.0.113.9",
    userAgent: "storefront-test",
    keys: [],
    principal: null,
    locale: "en",
    startedAtMs: 0,
    waitUntil: () => undefined,
    params,
  } as unknown as Ctx;
}

function input(params: Record<string, string> = {}): { params: Record<string, string>; body: unknown; reason: string | null } {
  return { params, body: undefined, reason: null };
}

function route(path: string): RouteDefinition {
  const found = PUBLIC_ROUTES.find((definition) => definition.path === path);
  assert.ok(found !== undefined, `no route for ${path}`);
  return found;
}

async function answer(response: Response): Promise<{ status: number; data: Record<string, unknown>; code?: string; headers: Headers }> {
  const parsed = (await response.json()) as Record<string, unknown>;
  return {
    status: response.status,
    data: (parsed["data"] ?? {}) as Record<string, unknown>,
    headers: response.headers,
    ...(parsed["error"] === undefined ? {} : { code: String((parsed["error"] as { code?: string }).code ?? "") }),
  };
}

describe("platform configuration", () => {
  test("a client learns the currency, the clock and the payment method without guessing", async () => {
    const result = await answer(await route("/v1/public/config").run(ctxFor(stubDb([]), "/v1/public/config"), input()));
    assert.equal(result.status, 200);
    assert.equal(result.data["currency"], "BDT");
    assert.equal(result.data["timezone"], "Asia/Dhaka");
    assert.equal(result.data["defaultLocale"], "bn");
    assert.deepEqual(result.data["paymentMethods"], ["CASH_ON_DELIVERY"]);
  });
});

describe("the vendor list", () => {
  test("only approved, undeleted vendors are selected, and the filter is in the SQL", async () => {
    const db = stubDb([{ match: /FROM `vendors` v JOIN `zones`/u, rows: [vendorRow()] }]);
    const result = await answer(
      await route("/v1/public/vendors").run(ctxFor(db, "/v1/public/vendors?area=SYL-CENTRAL"), input()),
    );
    assert.equal(result.status, 200);
    const sql = db.calls[0]?.sql ?? "";
    assert.match(sql, /v\.`status` = 'APPROVED'/u);
    assert.match(sql, /v\.`deleted_at` IS NULL/u);
    assert.deepEqual(db.calls[0]?.params.slice(0, 1), ["SYL-CENTRAL"]);
  });

  test("money is integer paisa and the rating is basis points, never a float", async () => {
    const db = stubDb([{ match: /FROM `vendors` v JOIN `zones`/u, rows: [vendorRow()] }]);
    const result = await answer(await route("/v1/public/vendors").run(ctxFor(db, "/v1/public/vendors"), input()));
    const vendors = result.data["vendors"] as Record<string, unknown>[];
    assert.equal(vendors.length, 1);
    assert.equal(vendors[0]?.["minOrderPaisa"], 15_000);
    assert.equal(vendors[0]?.["ratingBps"], 452);
    assert.equal(vendors[0]?.["ordersCompleted"], 932);
    assert.equal(vendors[0]?.["distanceM"], null);
    assert.equal(typeof vendors[0]?.["nameBn"], "string");
  });

  test("a caller's coordinates become a rounded distance in metres", async () => {
    const db = stubDb([{ match: /FROM `vendors` v JOIN `zones`/u, rows: [vendorRow()] }]);
    const result = await answer(
      await route("/v1/public/vendors").run(
        ctxFor(db, "/v1/public/vendors?lat=24.9060&lon=91.8710"),
        input(),
      ),
    );
    const vendors = result.data["vendors"] as Record<string, unknown>[];
    const distance = vendors[0]?.["distanceM"];
    assert.equal(typeof distance, "number");
    assert.ok((distance as number) > 0 && (distance as number) < 5_000);
    assert.equal(Number.isInteger(distance), true);
  });

  test("a full page hands back a cursor that decodes to the last row", async () => {
    const db = stubDb([{ match: /FROM `vendors` v JOIN `zones`/u, rows: [vendorRow(), vendorRow({ id: bytes(VENDOR_HEX) }), vendorRow()] }]);
    const result = await answer(
      await route("/v1/public/vendors").run(ctxFor(db, "/v1/public/vendors?limit=2"), input()),
    );
    const vendors = result.data["vendors"] as unknown[];
    assert.equal(vendors.length, 2);
    const cursor = result.data["nextCursor"];
    assert.equal(typeof cursor, "string");
    const decoded = decodeCursor(cursor as string);
    assert.equal(decoded?.key, "4520");
    assert.equal(result.headers.get("x-undal-next-cursor"), cursor);
  });

  test("an empty platform is an empty list, not an error", async () => {
    const db = stubDb([{ match: /FROM `vendors` v JOIN `zones`/u, rows: [] }]);
    const result = await answer(await route("/v1/public/vendors").run(ctxFor(db, "/v1/public/vendors"), input()));
    assert.equal(result.status, 200);
    assert.deepEqual(result.data["vendors"], []);
    assert.equal(result.data["nextCursor"], null);
  });

  test("a nonsense sort falls back to recommendation instead of failing", async () => {
    const db = stubDb([{ match: /FROM `vendors` v JOIN `zones`/u, rows: [] }]);
    await route("/v1/public/vendors").run(ctxFor(db, "/v1/public/vendors?sort=DROP%20TABLE"), input());
    assert.match(db.calls[0]?.sql ?? "", /st`\.`orders_completed`/u);
  });

  test("nearest sorts in the Worker and refuses to promise a continuation", async () => {
    const near = vendorRow({ lat_e7: LAT0 + 500, lon_e7: LON0 });
    const far = vendorRow({ id: bytes(VENDOR_HEX), lat_e7: LAT0 + 90_000, lon_e7: LON0 });
    const db = stubDb([{ match: /FROM `vendors` v JOIN `zones`/u, rows: [far, near] }]);
    const result = await answer(
      await route("/v1/public/vendors").run(
        ctxFor(db, "/v1/public/vendors?sort=NEAREST&lat=24.8981&lon=91.8698"),
        input(),
      ),
    );
    const vendors = result.data["vendors"] as { distanceM: number }[];
    assert.ok((vendors[0]?.distanceM ?? 1e9) <= (vendors[1]?.distanceM ?? 1e9));
    assert.equal(result.data["nextCursor"], null);
  });
});

describe("a vendor page", () => {
  function dbForVendor(): ReturnType<typeof stubDb> {
    return stubDb([
      { match: /v\.`slug` = \?/u, rows: [vendorRow()] },
      { match: /FROM `vendor_categories`/u, rows: [{ slug: "bengali", name_en: "Bengali", name_bn: "বাংলা", is_primary: 1 }] },
      { match: /FROM `vendor_hours`/u, rows: [{ weekday: 0, opens_at: "11:00:00", closes_at: "23:00:00" }] },
    ]);
  }

  test("a slug that does not exist is a 404 with the registry's code", async () => {
    const db = stubDb([{ match: /v\.`slug` = \?/u, rows: [] }]);
    const result = await answer(
      await route("/v1/public/vendors/{slug}").run(ctxFor(db, "/v1/public/vendors/nobody"), input({ slug: "nobody" })),
    );
    assert.equal(result.status, 404);
    assert.equal(result.code, "CATALOG_VENDOR_NOT_FOUND");
  });

  test("an approved vendor answers with its categories and hours", async () => {
    const result = await answer(
      await route("/v1/public/vendors/{slug}").run(
        ctxFor(dbForVendor(), "/v1/public/vendors/rahman-biriyani"),
        input({ slug: "rahman-biriyani" }),
      ),
    );
    assert.equal(result.status, 200);
    const vendor = result.data["vendor"] as Record<string, unknown>;
    assert.equal(vendor["slug"], "rahman-biriyani");
    assert.deepEqual(result.data["categories"], [
      { slug: "bengali", nameEn: "Bengali", nameBn: "বাংলা", isPrimary: true },
    ]);
    assert.equal((result.data["hours"] as unknown[]).length, 1);
  });
});

describe("a menu", () => {
  function dbForMenu(): ReturnType<typeof stubDb> {
    return stubDb([
      { match: /v\.`slug` = \?/u, rows: [vendorRow()] },
      { match: /FROM `vendor_categories`/u, rows: [] },
      { match: /FROM `vendor_hours`/u, rows: [] },
      { match: /FROM `menu_sections`/u, rows: [{ id: bytes(SECTION_HEX), name_en: "Biriyani", name_bn: "বিরিয়ানি" }] },
      {
        match: /FROM `menu_items` WHERE `vendor_id`/u,
        rows: [
          {
            id: bytes(ITEM_HEX),
            section_id: bytes(SECTION_HEX),
            name: "Mutton Biriyani",
            name_bn: "খাসির বিরিয়ানি",
            description: "Slow-cooked",
            description_bn: "ধীরে রান্না",
            price_paisa: 32_000,
            compare_at_paisa: null,
            image_url: null,
            image_blurhash: null,
            image_is_cutout: 0,
            prep_time_s: 900,
            calories: 720,
            spice_level: 1,
            is_vegetarian: 0,
            is_halal: 1,
            availability: "AVAILABLE",
            sold_out_until: null,
            contains_allergens: '["DAIRY","NUTS"]',
          },
        ],
      },
      {
        match: /FROM `modifier_groups` WHERE `vendor_id`/u,
        rows: [
          { id: bytes(GROUP_HEX), name: "Add extras", name_bn: "অতিরিক্ত", selection: "MULTIPLE", min_select: 0, max_select: 3, is_required: 0 },
        ],
      },
      {
        match: /FROM `modifiers` `md`/u,
        rows: [{ id: bytes(MODIFIER_HEX), group_id: bytes(GROUP_HEX), name_en: "Borhani", name_bn: "বোরহানি", price_delta_paisa: 3_000, available: 1 }],
      },
      { match: /FROM `item_modifier_groups`/u, rows: [{ item_id: bytes(ITEM_HEX), group_id: bytes(GROUP_HEX) }] },
    ]);
  }

  test("sections, items, groups and modifiers assemble without a join multiplying rows", async () => {
    const result = await answer(
      await route("/v1/public/vendors/{slug}/menu").run(
        ctxFor(dbForMenu(), "/v1/public/vendors/rahman-biriyani/menu"),
        input({ slug: "rahman-biriyani" }),
      ),
    );
    assert.equal(result.status, 200);
    const menu = result.data["menu"] as Record<string, unknown>;
    const sections = menu["sections"] as { nameEn: string; items: Record<string, unknown>[] }[];
    assert.equal(sections.length, 1);
    assert.equal(sections[0]?.items.length, 1);
    const item = sections[0]?.items[0] as Record<string, unknown>;
    assert.equal(item["pricePaisa"], 32_000);
    assert.deepEqual(item["allergenCodes"], ["DAIRY", "NUTS"]);
    assert.deepEqual(item["modifierGroupIds"], [GROUP_HEX]);
    const groups = menu["modifierGroups"] as { modifiers: { priceDeltaPaisa: number }[] }[];
    assert.equal(groups[0]?.modifiers.length, 1);
    assert.equal(groups[0]?.modifiers[0]?.priceDeltaPaisa, 3_000);
    assert.equal(menu["currency"], "BDT");
  });

  test("hidden and sold-out items are excluded by the query, not by the browser", async () => {
    const db = dbForMenu();
    await route("/v1/public/vendors/{slug}/menu").run(
      ctxFor(db, "/v1/public/vendors/rahman-biriyani/menu"),
      input({ slug: "rahman-biriyani" }),
    );
    const itemsSql = db.calls.map((call) => call.sql).find((sql) => /FROM `menu_items` WHERE/u.test(sql)) ?? "";
    assert.match(itemsSql, /`availability` <> 'HIDDEN'/u);
    assert.match(itemsSql, /`deleted_at` IS NULL/u);
  });

  test("a menu with no items is an empty section list, and the page still renders", async () => {
    const db = stubDb([
      { match: /v\.`slug` = \?/u, rows: [vendorRow()] },
      { match: /FROM `vendor_categories`/u, rows: [] },
      { match: /FROM `vendor_hours`/u, rows: [] },
      { match: /FROM `menu_sections`/u, rows: [] },
      { match: /FROM `menu_items` WHERE `vendor_id`/u, rows: [] },
      { match: /FROM `modifier_groups` WHERE `vendor_id`/u, rows: [] },
      { match: /FROM `modifiers` `md`/u, rows: [] },
      { match: /FROM `item_modifier_groups`/u, rows: [] },
    ]);
    const result = await answer(
      await route("/v1/public/vendors/{slug}/menu").run(
        ctxFor(db, "/v1/public/vendors/x/menu"),
        input({ slug: "x" }),
      ),
    );
    const menu = result.data["menu"] as Record<string, unknown>;
    assert.deepEqual(menu["sections"], []);
    assert.deepEqual(menu["modifierGroups"], []);
  });
});

describe("search", () => {
  test("an empty query costs no database call", async () => {
    const db = stubDb([]);
    const result = await answer(await route("/v1/public/search").run(ctxFor(db, "/v1/public/search?q=%20"), input()));
    assert.deepEqual(result.data["vendors"], []);
    assert.deepEqual(result.data["items"], []);
    assert.equal(db.calls.length, 0);
  });

  test("a term matches kitchens and dishes, wildcards escaped", async () => {
    const db = stubDb([
      { match: /FROM `vendors` v LEFT JOIN/u, rows: [vendorRow()] },
      {
        match: /FROM `menu_items` `mi`/u,
        rows: [
          {
            id: bytes(ITEM_HEX),
            name: "Mutton Biriyani",
            name_bn: "খাসির বিরিয়ানি",
            price_paisa: 32_000,
            image_url: null,
            availability: "AVAILABLE",
            slug: "rahman-biriyani",
            vendor_name: "Rahman's Biriyani",
            vendor_name_bn: null,
            open_state: "OPEN",
          },
        ],
      },
    ]);
    const result = await answer(
      await route("/v1/public/search").run(ctxFor(db, "/v1/public/search?q=biriyani"), input()),
    );
    assert.equal((result.data["vendors"] as unknown[]).length, 1);
    const items = result.data["items"] as Record<string, unknown>[];
    assert.equal(items[0]?.["vendorSlug"], "rahman-biriyani");
    assert.equal(items[0]?.["pricePaisa"], 32_000);
  });

  test("a percent sign searches for a percent sign", () => {
    assert.equal(escapeLike("100%"), "100\\%");
    assert.equal(escapeLike("a_b"), "a\\_b");
    assert.equal(escapeLike("c\\d"), "c\\\\d");
  });
});

describe("the prerender manifest", () => {
  test("areas, categories and vendors become the route list, and an empty platform is an empty manifest", async () => {
    const db = stubDb([
      { match: /FROM `zones` `z` WHERE/u, rows: [{ code: "SYL-CENTRAL", name: "Sylhet Central", name_bn: "সিলেট সদর", city: "Sylhet", vendor_count: 12 }] },
      { match: /FROM `categories` `c` LEFT JOIN/u, rows: [{ slug: "bengali", name_en: "Bengali", name_bn: "বাংলা", vendor_count: 8 }] },
      { match: /SELECT `slug`, `updated_at` FROM `vendors`/u, rows: [{ slug: "rahman-biriyani", updated_at: "2026-11-20 10:00:00.000000" }] },
    ]);
    const result = await answer(
      await route("/v1/public/sitemap-data").run(ctxFor(db, "/v1/public/sitemap-data"), input()),
    );
    const areas = result.data["areas"] as { slug: string; vendorCount: number }[];
    assert.equal(areas[0]?.slug, "syl-central");
    assert.equal(areas[0]?.vendorCount, 12);
    assert.equal((result.data["vendors"] as unknown[]).length, 1);
  });

  test("an empty platform produces no routes at all", async () => {
    const db = stubDb([
      { match: /FROM `zones` `z` WHERE/u, rows: [] },
      { match: /FROM `categories` `c` LEFT JOIN/u, rows: [] },
      { match: /SELECT `slug`, `updated_at` FROM `vendors`/u, rows: [] },
    ]);
    const result = await answer(
      await route("/v1/public/sitemap-data").run(ctxFor(db, "/v1/public/sitemap-data"), input()),
    );
    assert.deepEqual(result.data, { areas: [], categories: [], vendors: [] });
  });
});
