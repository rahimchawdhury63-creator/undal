/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The public catalogue API.
 *
 * Everything here is readable without a token, because a storefront that requires a login to
 * show a menu is a storefront nobody enters from a search result. That makes these the only
 * routes where the caller is unknown by design, which is why each one carries a rate-limit
 * group, returns a bounded page, and serialises through an allowlist rather than a row.
 *
 * The responses are shaped for the two consumers that actually exist: the React storefront,
 * which needs money as integer paisa and names in both languages, and the prerender pass,
 * which needs a manifest of real route slugs and nothing else.
 */

import { decodeCursor, encodeCursor, haversineMeters, normalizeLimit } from "@undal/contracts";

import { failureResponse, successResponse } from "../middleware/envelope.ts";
import type { Ctx, RouteDefinition } from "../middleware/context.ts";
import {
  findVendorBySlug,
  listVendors,
  readMenu,
  serialiseVendor,
  type VendorSort,
} from "../repositories/catalogue.ts";
import { listAreas, listCategories, search, sitemapData } from "../repositories/catalogue-discovery.ts";

/** The sorts the storefront may ask for; anything else falls back to recommendation. */
const SORTS: readonly VendorSort[] = ["RECOMMENDED", "TOP_RATED", "FASTEST", "NEAREST", "NAME"];

/** Parse a sort parameter without ever trusting it. */
function parseSort(raw: string | null): VendorSort {
  const upper = (raw ?? "").toUpperCase();
  return (SORTS as readonly string[]).includes(upper) ? (upper as VendorSort) : "RECOMMENDED";
}

/**
 * Parse a decimal-degree coordinate into the platform's fixed-point integer.
 *
 * The database and the Worker both work in `lat_e7`/`lon_e7` because an integer comparison is
 * what makes the cell grid and the bounding boxes work without a spatial type. Out-of-range
 * input becomes `null` rather than a silently clamped coordinate: a customer in Norway is not
 * "near" Sylhet at latitude 90.
 */
export function parseCoordinate(raw: string | null, kind: "lat" | "lon"): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const limit = kind === "lat" ? 90 : 180;
  if (value < -limit || value > limit) return null;
  return Math.round(value * 10_000_000);
}

/**
 * The platform facts a client needs before it can render anything.
 *
 * Not configuration read from the environment: these are properties of the product — the
 * currency is taka, the clock is Dhaka, the languages are Bangla and English — and a client
 * that had to guess them would guess wrong exactly once, on a receipt.
 */
const PLATFORM_CONFIG = {
  name: "Undal",
  currency: "BDT",
  currencySymbol: "৳",
  timezone: "Asia/Dhaka",
  locales: ["bn", "en"] as const,
  defaultLocale: "bn" as const,
  fulfilmentModes: ["DELIVERY", "PICKUP"] as const,
  paymentMethods: ["CASH_ON_DELIVERY"] as const,
  vehicles: ["MOTORBIKE", "BICYCLE"] as const,
  moneyMinorUnits: 100,
  contact: { supportHours: "09:00–23:00 Asia/Dhaka" },
} as const;

/** `GET /v1/public/config`. */
async function getConfig(ctx: Ctx): Promise<Response> {
  return successResponse(PLATFORM_CONFIG, ctx.locale, ctx.requestId);
}

/**
 * `GET /v1/public/categories` — the cuisines on their own.
 *
 * `areas` already carries them, but the storefront's category rail asks for the list by itself and
 * does so on first paint; making it fetch every zone to render a rail of eight chips would be a
 * heavier request for a smaller answer. Both routes read the same repository, so they cannot drift.
 */
async function getCategories(ctx: Ctx): Promise<Response> {
  const categories = await listCategories(ctx.db);
  return successResponse({ categories }, ctx.locale, ctx.requestId, {
    "cache-control": "public, max-age=60",
  });
}

/** `GET /v1/public/areas` — every live zone plus every active cuisine. */
async function getAreas(ctx: Ctx): Promise<Response> {
  const [areas, categories] = await Promise.all([listAreas(ctx.db), listCategories(ctx.db)]);
  return successResponse({ areas, categories }, ctx.locale, ctx.requestId, {
    "cache-control": "public, max-age=60",
  });
}

/** `GET /v1/public/vendors` — the storefront list. */
async function getVendors(ctx: Ctx): Promise<Response> {
  const url = ctx.url;
  const limit = normalizeLimit(url.searchParams.get("limit"));
  const latE7 = parseCoordinate(url.searchParams.get("lat"), "lat");
  const lonE7 = parseCoordinate(url.searchParams.get("lon"), "lon");
  const origin = latE7 !== null && lonE7 !== null ? { latE7, lonE7 } : null;

  const page = await listVendors(ctx.db, {
    zoneCode: url.searchParams.get("area"),
    categorySlug: url.searchParams.get("category"),
    q: url.searchParams.get("q"),
    sort: parseSort(url.searchParams.get("sort")),
    origin,
    limit,
    cursor: decodeCursor(url.searchParams.get("cursor")),
  });

  const nextCursor = page.nextKey === null ? null : encodeCursor(page.nextKey);
  return successResponse(
    {
      vendors: page.vendors.map((row) =>
        serialiseVendor(
          row,
          origin === null
            ? null
            : haversineMeters(
                { latE7: Number(row.lat_e7), lonE7: Number(row.lon_e7) },
                { latE7: origin.latE7, lonE7: origin.lonE7 },
              ),
        ),
      ),
      nextCursor,
    },
    ctx.locale,
    ctx.requestId,
    {
      ...(nextCursor === null ? {} : { "X-Undal-Next-Cursor": nextCursor }),
      "cache-control": "public, max-age=30",
    },
  );
}

/** `GET /v1/public/vendors/{slug}`. */
async function getVendor(ctx: Ctx, slug: string): Promise<Response> {
  const detail = await findVendorBySlug(ctx.db, slug);
  if (detail === null) return failureResponse({ code: "CATALOG_VENDOR_NOT_FOUND" }, ctx.locale, ctx.requestId);
  return successResponse(
    {
      vendor: serialiseVendor(detail.vendor),
      categories: detail.categories,
      hours: detail.hours,
    },
    ctx.locale,
    ctx.requestId,
    { "cache-control": "public, max-age=60" },
  );
}

/** `GET /v1/public/vendors/{slug}/menu`. */
async function getMenu(ctx: Ctx, slug: string): Promise<Response> {
  const detail = await findVendorBySlug(ctx.db, slug);
  if (detail === null) return failureResponse({ code: "CATALOG_VENDOR_NOT_FOUND" }, ctx.locale, ctx.requestId);
  const menu = await readMenu(ctx.db, detail.vendor.id);
  return successResponse(
    { vendor: serialiseVendor(detail.vendor), menu },
    ctx.locale,
    ctx.requestId,
    { "cache-control": "public, max-age=60" },
  );
}

/** `GET /v1/public/search` — kitchens and dishes in one answer. */
async function searchAll(ctx: Ctx): Promise<Response> {
  const term = ctx.url.searchParams.get("q") ?? "";
  const limit = Math.min(normalizeLimit(ctx.url.searchParams.get("limit")), 30);
  const results = await search(ctx.db, term, limit);
  return successResponse(
    {
      query: term.trim(),
      vendors: results.vendors.map((row) => serialiseVendor(row)),
      items: results.items,
    },
    ctx.locale,
    ctx.requestId,
  );
}

/** `GET /v1/public/sitemap-data` — the manifest the prerender pass walks. */
async function getSitemapData(ctx: Ctx): Promise<Response> {
  return successResponse(await sitemapData(ctx.db), ctx.locale, ctx.requestId, {
    "cache-control": "public, max-age=300",
  });
}

/**
 * The routes.
 *
 * `permission: "*"` means anonymous, which `middleware/rbac.ts` reads as "no key required" —
 * it is a deliberate declaration rather than a missing one, and the rate-limit group beside it
 * is what keeps an unauthenticated endpoint from being an unthrottled one.
 */
export const PUBLIC_ROUTES: readonly RouteDefinition[] = [
  {
    method: "GET",
    path: "/v1/public/config",
    permission: "*",
    group: "CATALOGUE",
    run: (ctx) => getConfig(ctx),
  },
  {
    method: "GET",
    path: "/v1/public/categories",
    permission: "*",
    group: "CATALOGUE",
    run: (ctx) => getCategories(ctx),
  },
  {
    method: "GET",
    path: "/v1/public/areas",
    permission: "*",
    group: "CATALOGUE",
    run: (ctx) => getAreas(ctx),
  },
  {
    method: "GET",
    path: "/v1/public/vendors",
    permission: "*",
    group: "CATALOGUE",
    run: (ctx) => getVendors(ctx),
  },
  {
    method: "GET",
    path: "/v1/public/vendors/{slug}",
    permission: "*",
    group: "CATALOGUE",
    run: (ctx, input) => getVendor(ctx, input.params.slug ?? ""),
  },
  {
    method: "GET",
    path: "/v1/public/vendors/{slug}/menu",
    permission: "*",
    group: "CATALOGUE",
    run: (ctx, input) => getMenu(ctx, input.params.slug ?? ""),
  },
  {
    method: "GET",
    path: "/v1/public/search",
    permission: "*",
    group: "SEARCH",
    run: (ctx) => searchAll(ctx),
  },
  {
    method: "GET",
    path: "/v1/public/sitemap-data",
    permission: "*",
    group: "CATALOGUE",
    run: (ctx) => getSitemapData(ctx),
  },
];

/** Exported for the storefront's contract test: the shape this module promises for a vendor page. */
export type PublicVendorResponse = ReturnType<typeof serialiseVendor>;
