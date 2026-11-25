/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The route table.
 *
 * Every route is a loader, an element and a `handle.meta` that the prerender pass reads to write
 * the page's title, description, canonical link and structured data. Loaders never throw on a
 * network failure — they return `{error}` and the page renders an error state, because a storefront
 * that white-screens when the API hiccups is a storefront that has lost the order.
 */

import { useEffect, type ReactNode } from "react";
import { Outlet, useMatches, type LoaderFunctionArgs, type RouteObject } from "react-router";

import { ApiError, getAreas, getCategories, getMenu, getVendor, getVendors, searchCatalogue, type Area, type Category, type Menu, type Vendor, toApiError } from "./lib/api.ts";
import { LocaleProvider, pick } from "./lib/locale.tsx";
import { usePrefs } from "./lib/prefs.ts";
import { SITE_URL, useHead, type Meta } from "./lib/seo.ts";
import { Layout } from "./components/Layout.tsx";
import { HomePage, type HomeData } from "./features/home.tsx";
import { VendorPage } from "./features/vendor.tsx";
import { SearchPage } from "./features/search.tsx";
import { CartPage } from "./features/cart.tsx";
import { CheckoutPage } from "./features/checkout.tsx";
import { OrderPage } from "./features/order.tsx";
import { AccountPage, SignInPage } from "./features/account.tsx";
import { NotFoundPage, PartnerPage, RiderPage, StaticPage, type StaticPageId } from "./features/pages.tsx";

/** What a route's `handle` carries. */
export interface RouteHandle {
  readonly meta: (data: unknown) => Meta;
}

/** The root loader's data: the areas the header offers. */
export interface RootData {
  readonly areas: readonly Area[];
}

/** A plain, honest fallback description for a page that has not written one. */
const FALLBACK: Meta = {
  title: "Undal",
  description: "Undal delivers food from the kitchens of Bangladesh. Order in Bangla or English, pay cash on delivery.",
  path: "/",
  locale: "bn",
};

/** Read the deepest match's metadata, so a nested route overrides its parent. */
function useRouteMeta(): Meta {
  const matches = useMatches();
  const locale = usePrefs((state) => state.locale);
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const handle = matches[index]?.handle as RouteHandle | undefined;
    if (handle !== undefined) {
      const meta = handle.meta(matches[index]?.data);
      return { ...meta, locale };
    }
  }
  return { ...FALLBACK, locale };
}

/** The frame: a locale provider, the header and footer, and the document head. */
function Root(): ReactNode {
  const data = useMatches()[0]?.data as RootData | undefined;
  const meta = useRouteMeta();
  useHead(meta, SITE_URL);
  useEffect(() => {
    usePrefs.getState().apply();
  }, []);
  return (
    <LocaleProvider>
      <Layout areas={data?.areas ?? []}>
        <Outlet />
      </Layout>
    </LocaleProvider>
  );
}

/** Fetch the catalogue a browse page needs, degrading to an error state rather than a crash. */
async function loadHome({ request }: LoaderFunctionArgs): Promise<HomeData> {
  const url = new URL(request.url);
  const areaSlug = url.searchParams.get("area");
  const sort = url.searchParams.get("sort") ?? "RECOMMENDED";
  const category = url.searchParams.get("category");
  const [areas, categories, vendors] = await Promise.all([
    getAreas().catch(() => ({ areas: [] as readonly Area[] })),
    getCategories().catch(() => ({ categories: [] as readonly Category[] })),
    getVendors({
      ...(areaSlug === null ? {} : { area: areaSlug }),
      ...(category === null ? {} : { category }),
      sort,
      limit: 24,
    }).catch((failure: unknown) => ({
      vendors: [] as readonly Vendor[],
      nextCursor: null as string | null,
      error: toApiError(failure),
    })),
  ]);
  return {
    areas: areas.areas,
    categories: categories.categories,
    vendors: vendors.vendors,
    areaSlug,
    sort,
    category,
    error: "error" in vendors ? vendors.error : null,
  };
}

/** Load one kitchen and its menu. */
async function loadVendor({ params }: LoaderFunctionArgs): Promise<{ vendor: Vendor; menu: Menu; categories: Category[] } | null> {
  const slug = params.slug;
  if (slug === undefined) return null;
  try {
    const [vendor, menu] = await Promise.all([getVendor(slug), getMenu(slug)]);
    return { vendor: vendor.vendor, menu: menu.menu, categories: [...(vendor.categories ?? [])] };
  } catch {
    return null;
  }
}

/** Search kitchens and dishes in one request. */
async function loadSearch({ request }: LoaderFunctionArgs): Promise<{
  readonly query: string;
  readonly vendors: readonly Vendor[];
  readonly items: readonly never[];
}> {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  if (query.trim() === "") return { query, vendors: [], items: [] };
  try {
    const result = await searchCatalogue(query);
    return { query, vendors: result.vendors, items: result.items as readonly never[] };
  } catch {
    return { query, vendors: [], items: [] };
  }
}

/** The static page keys and their routes. */
const STATIC_ROUTES: readonly { path: string; id: StaticPageId; title: string }[] = [
  { path: "about", id: "about", title: "About Undal" },
  { path: "help", id: "help", title: "Help" },
  { path: "contact", id: "contact", title: "Contact" },
  { path: "privacy", id: "privacy", title: "Privacy" },
  { path: "terms", id: "terms", title: "Terms" },
  { path: "licence", id: "licence", title: "Licence" },
  { path: "app", id: "app", title: "The Undal app" },
  { path: "join/restaurant", id: "joinRestaurant", title: "Join as a restaurant" },
  { path: "join/rider", id: "joinRider", title: "Ride with Undal" },
];

/** Build a static route with its metadata. */
function staticRoute(path: string, id: StaticPageId, title: string): RouteObject {
  return {
    path,
    element: <StaticPage id={id} />,
    handle: {
      meta: (): Meta => ({ title: `${title} · Undal`, description: `${title} — Undal, food delivery for Bangladesh.`, path: `/${path}`, locale: "bn" }),
    } satisfies RouteHandle,
  };
}

/** The storefront's routes, shared by the browser and the prerender pass. */
export const routes: RouteObject[] = [
  {
    id: "root",
    path: "/",
    element: <Root />,
    loader: async (): Promise<RootData> => {
      try {
        const result = await getAreas();
        return { areas: result.areas };
      } catch {
        return { areas: [] };
      }
    },
    handle: { meta: (): Meta => FALLBACK } satisfies RouteHandle,
    children: [
      {
        index: true,
        loader: loadHome,
        element: <HomeRoute />,
        handle: {
          meta: (data: unknown): Meta => ({
            title: "Undal · Food delivery in Bangladesh",
            description: "Order from the kitchens near you. Live prices, honest ETAs, cash on delivery. খাবার পৌঁছে যাক আপনার দরজায়।",
            path: "/",
            locale: "bn",
            jsonLd: {
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "Undal",
              url: SITE_URL,
              potentialAction: {
                "@type": "SearchAction",
                target: `${SITE_URL}/search?q={search_term_string}`,
                "query-input": "required name=search_term_string",
              },
            },
          }),
        },
      },
      {
        path: "r/:slug",
        loader: loadVendor,
        element: <VendorRoute />,
        handle: {
          meta: (data: unknown): Meta => {
            const vendor = (data as { vendor?: Vendor } | null)?.vendor;
            if (vendor === undefined) return { ...FALLBACK, title: "Restaurant · Undal", path: "/r" };
            return {
              title: `${picker(vendor.name, vendor.nameBn)} · Undal`,
              description: vendor.tagline ?? `Order from ${vendor.name} on Undal.`,
              path: `/r/${vendor.slug}`,
              locale: "bn",
              jsonLd: {
                "@context": "https://schema.org",
                "@type": "Restaurant",
                name: vendor.name,
                ...(vendor.ratingBps === null
                  ? {}
                  : { aggregateRating: { "@type": "AggregateRating", ratingValue: vendor.ratingBps / 100, ratingCount: vendor.ratingCount } }),
              },
            };
          },
        },
      },
      { path: "a/:slug", loader: loadHome, element: <HomeRoute />, handle: { meta: (): Meta => ({ ...FALLBACK, path: "/" }) } },
      { path: "c/:slug", loader: loadHome, element: <HomeRoute />, handle: { meta: (): Meta => ({ ...FALLBACK, path: "/" }) } },
      {
        path: "search",
        loader: loadSearch,
        element: <SearchRoute />,
        handle: {
          meta: (data: unknown): Meta => ({
            title: `Search · Undal`,
            description: `Search results for ${(data as { query?: string } | undefined)?.query ?? ""} on Undal.`,
            path: "/search",
            locale: "bn",
            noindex: true,
          }),
        },
      },
      { path: "cart", element: <CartPage />, handle: { meta: (): Meta => ({ ...FALLBACK, title: "Cart · Undal", path: "/cart", noindex: true }) } },
      { path: "checkout", element: <CheckoutPage />, handle: { meta: (): Meta => ({ ...FALLBACK, title: "Checkout · Undal", path: "/checkout", noindex: true }) } },
      { path: "o/:code", element: <OrderPage />, handle: { meta: (): Meta => ({ ...FALLBACK, title: "Order · Undal", path: "/o", noindex: true }) } },
      { path: "track/:code", element: <OrderPage mode="track" />, handle: { meta: (): Meta => ({ ...FALLBACK, title: "Track · Undal", path: "/track", noindex: true }) } },
      { path: "account", element: <AccountPage />, handle: { meta: (): Meta => ({ ...FALLBACK, title: "Account · Undal", path: "/account", noindex: true }) } },
      { path: "sign-in", element: <SignInPage />, handle: { meta: (): Meta => ({ ...FALLBACK, title: "Sign in · Undal", path: "/sign-in", noindex: true }) } },
      { path: "partner", element: <PartnerPage />, handle: { meta: (): Meta => ({ ...FALLBACK, title: "Partner console · Undal", path: "/partner" }) } },
      { path: "rider", element: <RiderPage />, handle: { meta: (): Meta => ({ ...FALLBACK, title: "Rider console · Undal", path: "/rider" }) } },
      ...STATIC_ROUTES.map((route) => staticRoute(route.path, route.id, route.title)),
      { path: "*", element: <NotFoundPage />, handle: { meta: (): Meta => ({ ...FALLBACK, title: "Not found · Undal", path: "/", noindex: true }) } },
    ],
  },
];

/** Pick a display name for metadata, where no locale context exists yet. */
function picker(en: string, bn: string | null): string {
  return bn ?? en;
}

/** The home page, fed by its loader. */
function HomeRoute(): ReactNode {
  const data = useMatches().at(-1)?.data as HomeData;
  return <HomePage data={data} />;
}

/** The vendor page, fed by its loader. */
function VendorRoute(): ReactNode {
  const data = useMatches().at(-1)?.data as { vendor: Vendor; menu: Menu; categories: Category[] } | null;
  if (data === null) return <NotFoundPage />;
  return <VendorPage data={{ vendor: data.vendor, menu: data.menu, categories: data.categories }} />;
}

/** The search page, fed by its loader. */
function SearchRoute(): ReactNode {
  const data = useMatches().at(-1)?.data as Parameters<typeof SearchPage>[0]["data"];
  return <SearchPage data={data} />;
}

export { pick };
