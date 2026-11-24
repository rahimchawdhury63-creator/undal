/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The API client.
 *
 * Every response Undal returns is one of two shapes — a success envelope or an error envelope —
 * so this module parses exactly that and nothing else. It never invents a type the server does
 * not send: the interfaces below are transcriptions of the Worker's own serialisers, and a
 * field that appears here without a counterpart there is a bug that the contract test catches.
 *
 * Money is integer paisa everywhere in this file. Formatting happens at the last moment, in a
 * component that knows the locale, which is why no function here returns a string for an amount.
 */

/** The base URL of `undal-core`. Same-origin `/api` in development, the API host in production. */
export const API_BASE = ((): string => {
  const configured = (import.meta as { env?: Record<string, string | undefined> }).env?.["VITE_API_BASE"];
  if (typeof configured === "string" && configured !== "") return configured.replace(/\/$/u, "");
  return "/api";
})();

/** An error the server described, or a network failure described honestly. */
export class ApiError extends Error {
  /** The stable contract code (`ORDER_NOT_FOUND`), or `NETWORK` when nothing answered. */
  readonly code: string;
  readonly status: number;
  /** The failing field path on a validation error. */
  readonly field: string | null;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;
  /** The request id, so a support conversation can find the one trace. */
  readonly requestId: string | null;

  constructor(input: {
    code: string;
    status: number;
    message: string;
    field?: string | null;
    retryable?: boolean;
    details?: Record<string, unknown>;
    requestId?: string | null;
  }) {
    super(input.message);
    this.name = "ApiError";
    this.code = input.code;
    this.status = input.status;
    this.field = input.field ?? null;
    this.retryable = input.retryable ?? false;
    this.details = input.details ?? {};
    this.requestId = input.requestId ?? null;
  }
}

interface EnvelopeMeta {
  readonly requestId?: string;
  readonly ts?: string;
  readonly nextCursor?: string;
  readonly total?: number;
}

interface ErrorEnvelope {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly messageBn?: string;
    readonly field?: string | null;
    readonly retryable?: boolean;
    readonly details?: Record<string, unknown>;
  };
  readonly meta?: EnvelopeMeta;
}

interface SuccessEnvelope<T> {
  readonly ok: true;
  readonly data: T;
  readonly meta?: EnvelopeMeta;
}

/** What a request may carry. */
export interface RequestOptions {
  readonly method?: "GET" | "POST" | "PATCH" | "DELETE";
  readonly body?: unknown;
  /** The access token, when there is a session. */
  readonly token?: string | null;
  /** Abort a request when a route changes. */
  readonly signal?: AbortSignal;
  /** Send the refresh cookie (default: same-origin requests do). */
  readonly credentials?: RequestCredentials;
}

/**
 * Perform one API call and unwrap the envelope.
 *
 * A network failure becomes an `ApiError` with code `NETWORK` rather than a rejected `TypeError`,
 * because every caller in this app branches on `error.code` and a thrown `TypeError` would fall
 * through to a blank screen at the exact moment a connection drops.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token !== undefined && options.token !== null && options.token !== "") {
    headers["authorization"] = `Bearer ${options.token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      credentials: options.credentials ?? "same-origin",
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (cause) {
    const aborted = cause instanceof DOMException && cause.name === "AbortError";
    throw new ApiError({
      code: aborted ? "ABORTED" : "NETWORK",
      status: 0,
      message: aborted ? "The request was cancelled." : "We could not reach Undal.",
      retryable: !aborted,
    });
  }

  let parsed: SuccessEnvelope<T> | ErrorEnvelope | null = null;
  try {
    parsed = (await response.json()) as SuccessEnvelope<T> | ErrorEnvelope;
  } catch {
    parsed = null;
  }

  if (parsed === null) {
    throw new ApiError({
      code: "MALFORMED_RESPONSE",
      status: response.status,
      message: "Undal answered with something that is not an envelope.",
      retryable: response.status >= 500,
    });
  }
  if (!parsed.ok) {
    throw new ApiError({
      code: parsed.error.code,
      status: response.status,
      message: parsed.error.message,
      field: parsed.error.field ?? null,
      retryable: parsed.error.retryable ?? false,
      details: parsed.error.details ?? {},
      requestId: parsed.meta?.requestId ?? response.headers.get("x-undal-request-id"),
    });
  }
  return parsed.data;
}

/** The outcome of a loader: data, or the error that stopped it. Never a thrown exception mid-render. */
export type Loaded<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ApiError };

/**
 * Run a request and describe the failure instead of throwing.
 *
 * React Router's loaders render a route either way; a loader that throws blanks the page, and a
 * storefront cannot afford a blank page because a kitchen's menu timed out. Routes decide what
 * an error looks like, which is why the error travels as a value.
 */
export async function loaded<T>(work: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error };
    return {
      ok: false,
      error: new ApiError({
        code: "UNEXPECTED",
        status: 0,
        message: error instanceof Error ? error.message : "Something went wrong.",
        retryable: true,
      }),
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Response shapes. Each mirrors a serialiser in `workers/core`.
// ---------------------------------------------------------------------------------------------

/** A vendor as the public catalogue returns it. */
export interface Vendor {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly nameBn: string | null;
  readonly tagline: string | null;
  readonly kind: string;
  readonly openState: string;
  readonly busyLevel: number;
  readonly ratingBps: number | null;
  readonly ratingCount: number;
  readonly ordersCompleted: number;
  readonly minOrderPaisa: number;
  readonly prepTimeSeconds: number;
  readonly coverUrl: string | null;
  readonly coverBlurhash: string | null;
  readonly logoUrl: string | null;
  readonly logoBlurhash: string | null;
  readonly supportsPickup: boolean;
  readonly supportsDelivery: boolean;
  readonly latE7: number;
  readonly lonE7: number;
  readonly distanceM: number | null;
  readonly updatedAt: string;
}

/** A menu item. Prices are integer paisa; `availability` is the state the kitchen set. */
export interface MenuItem {
  readonly id: string;
  readonly sectionId: string;
  readonly name: string;
  readonly nameBn: string | null;
  readonly description: string | null;
  readonly descriptionBn: string | null;
  readonly pricePaisa: number;
  readonly compareAtPaisa: number | null;
  readonly imageUrl: string | null;
  readonly imageBlurhash: string | null;
  readonly imageIsCutout: boolean;
  readonly prepTimeSeconds: number;
  readonly calories: number | null;
  readonly spiceLevel: number | null;
  readonly isVegetarian: boolean;
  readonly isHalal: boolean;
  readonly availability: string;
  readonly soldOutUntil: string | null;
  readonly allergenCodes: readonly string[];
  readonly modifierGroupIds: readonly string[];
}

/** A modifier option. */
export interface Modifier {
  readonly id: string;
  readonly nameEn: string;
  readonly nameBn: string;
  readonly priceDeltaPaisa: number;
  readonly available: boolean;
}

/** A modifier group attached to items. */
export interface ModifierGroup {
  readonly id: string;
  readonly name: string;
  readonly nameBn: string | null;
  readonly selection: string;
  readonly minSelect: number;
  readonly maxSelect: number;
  readonly isRequired: boolean;
  readonly modifiers: readonly Modifier[];
}

/** A menu section. */
export interface MenuSection {
  readonly id: string;
  readonly nameEn: string;
  readonly nameBn: string;
  readonly items: readonly MenuItem[];
}

/** A menu. */
export interface Menu {
  readonly vendorId: string;
  readonly sections: readonly MenuSection[];
  readonly modifierGroups: readonly ModifierGroup[];
  readonly currency: string;
}

/** An area the platform delivers in. */
export interface Area {
  readonly slug: string;
  readonly code: string;
  readonly name: string;
  readonly nameBn: string;
  readonly city: string;
  readonly vendorCount: number;
}

/** A cuisine category. */
export interface Category {
  readonly slug: string;
  readonly nameEn: string;
  readonly nameBn: string;
  /** Present on the public category list; absent where a vendor page lists its own categories. */
  readonly vendorCount?: number;
}

/** One line of a signed quote. */
export interface QuoteLine {
  readonly labelEn?: string;
  readonly labelBn?: string;
  readonly kind?: string;
  readonly amountPaisa?: number;
  readonly [key: string]: unknown;
}

/** A signed price for a cart. */
export interface Quote {
  readonly quoteId: string;
  readonly quoteToken: string;
  readonly expiresAt: string;
  readonly ttlSeconds: number;
  readonly lines: readonly QuoteLine[];
  readonly totalPaisa: number;
  readonly etaMinMinutes: number;
  readonly etaMaxMinutes: number;
  readonly fareSource: string;
  readonly warnings: readonly string[];
}

/** One order as the customer sees it. */
export interface Order {
  readonly id: string;
  readonly code: string;
  readonly state: string;
  readonly fulfilment: string;
  readonly vendorId: string;
  readonly riderId: string | null;
  readonly money: {
    readonly subtotalPaisa: number;
    readonly discountPaisa: number;
    readonly deliveryFeePaisa: number;
    readonly smallOrderFeePaisa: number;
    readonly taxPaisa: number;
    readonly tipPaisa: number;
    readonly roundingPaisa: number;
    readonly totalPaisa: number;
    readonly cashCollectedPaisa: number | null;
  };
  readonly prepTimeSeconds: number | null;
  readonly customerNote: string | null;
  readonly placedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The signed-in user. */
export interface SessionUser {
  readonly userId: string;
  readonly actorType: string;
  readonly role: string;
  readonly phone?: string | null;
}

// ---------------------------------------------------------------------------------------------
// Endpoints.
// ---------------------------------------------------------------------------------------------

/** The platform facts the storefront renders from. */
export async function getConfig(options: RequestOptions = {}): Promise<{
  readonly name: string;
  readonly currency: string;
  readonly currencySymbol: string;
  readonly timezone: string;
  readonly locales: readonly string[];
  readonly defaultLocale: string;
}> {
  return apiRequest("/v1/public/config", options);
}

/** Every live area and cuisine, with how many kitchens each has. */
export async function getAreas(options: RequestOptions = {}): Promise<{
  readonly areas: readonly Area[];
  readonly categories: readonly Category[];
}> {
  return apiRequest("/v1/public/areas", options);
}

/** A page of vendors, filtered the way the storefront's rail filters. */
export async function getVendors(
  params: {
    readonly area?: string | null;
    readonly category?: string | null;
    readonly q?: string | null;
    readonly sort?: string;
    readonly limit?: number;
    readonly lat?: number;
    readonly lon?: number;
    readonly cursor?: string | null;
  },
  options: RequestOptions = {},
): Promise<{ readonly vendors: readonly Vendor[]; readonly nextCursor: string | null }> {
  const search = new URLSearchParams();
  if (params.area) search.set("area", params.area);
  if (params.category) search.set("category", params.category);
  if (params.q) search.set("q", params.q);
  if (params.sort) search.set("sort", params.sort);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.lat !== undefined) search.set("lat", String(params.lat / 10_000_000));
  if (params.lon !== undefined) search.set("lon", String(params.lon / 10_000_000));
  if (params.cursor) search.set("cursor", params.cursor);
  return apiRequest(`/v1/public/vendors?${search.toString()}`, options);
}

/** One vendor's page data. */
export async function getVendor(
  slug: string,
  options: RequestOptions = {},
): Promise<{
  readonly vendor: Vendor;
  readonly categories: readonly { slug: string; nameEn: string; nameBn: string; isPrimary: boolean }[];
  readonly hours: readonly { weekday: number; opensAt: string; closesAt: string }[];
}> {
  return apiRequest(`/v1/public/vendors/${encodeURIComponent(slug)}`, options);
}

/** One vendor's menu, with its vendor header. */
export async function getMenu(
  slug: string,
  options: RequestOptions = {},
): Promise<{ readonly vendor: Vendor; readonly menu: Menu }> {
  return apiRequest(`/v1/public/vendors/${encodeURIComponent(slug)}/menu`, options);
}

/** Kitchens and dishes matching a term. */
export async function searchCatalogue(
  q: string,
  options: RequestOptions = {},
): Promise<{
  readonly query: string;
  readonly vendors: readonly Vendor[];
  readonly items: readonly {
    id: string;
    name: string;
    nameBn: string | null;
    pricePaisa: number;
    imageUrl: string | null;
    availability: string;
    vendorSlug: string;
    vendorName: string;
    vendorPanelName: string | null;
    vendorOpenState: string;
  }[];
}> {
  return apiRequest(`/v1/public/search?q=${encodeURIComponent(q)}`, options);
}

/** The manifest the prerender pass walks. */
export async function getSitemapData(options: RequestOptions = {}): Promise<{
  readonly areas: readonly { slug: string; vendorCount: number }[];
  readonly categories: readonly { slug: string; vendorCount: number }[];
  readonly vendors: readonly { slug: string; updatedAt: string }[];
}> {
  return apiRequest("/v1/public/sitemap-data", options);
}

/** The body a quote and a placement both take. */
export interface CartRequest {
  readonly vendorId: string;
  readonly fulfilment: "DELIVERY" | "PICKUP";
  readonly deliveryPoint?: { readonly lat: number; readonly lon: number };
  readonly items: readonly { readonly itemId: string; readonly quantity: number; readonly modifiers?: readonly string[]; readonly note?: string | null }[];
  readonly promoCode?: string | null;
  readonly tipPaisa?: number;
}

/** Price a cart. Safe to call as often as the cart changes: it writes nothing. */
export async function quoteCart(body: CartRequest, options: RequestOptions = {}): Promise<Quote> {
  return apiRequest("/v1/orders/quote", { ...options, method: "POST", body });
}

/** Place an order against a signed quote. */
export async function placeOrder(
  body: { readonly quoteToken: string; readonly customerNote?: string | null; readonly deliveryPoint?: { readonly lat: number; readonly lon: number } },
  options: RequestOptions = {},
): Promise<{ readonly order: Order }> {
  return apiRequest("/v1/orders", { ...options, method: "POST", body });
}

/** One order by the code a customer reads aloud. */
export async function getOrderByCode(code: string, options: RequestOptions = {}): Promise<{ readonly order: Order }> {
  return apiRequest(`/v1/orders/code/${encodeURIComponent(code)}`, options);
}

/** The signed-in customer's orders. */
export async function listOrders(options: RequestOptions = {}): Promise<{ readonly orders: readonly Order[] }> {
  return apiRequest("/v1/orders", options);
}

/** Sign in with the number and password a customer registered with. */
export async function signIn(
  body: { readonly phone: string; readonly password: string },
  options: RequestOptions = {},
): Promise<{ readonly accessToken: string; readonly refreshToken: string }> {
  return apiRequest("/v1/auth/login", { ...options, method: "POST", body: { ...body, fingerprint: fingerprint() } });
}

/** Rotate a refresh token for a fresh pair. */
export async function refreshSession(
  refreshToken: string,
  options: RequestOptions = {},
): Promise<{ readonly accessToken: string; readonly refreshToken: string }> {
  return apiRequest("/v1/auth/refresh", { ...options, method: "POST", body: { refreshToken } });
}

/** Who this token belongs to. */
export async function whoAmI(options: RequestOptions = {}): Promise<SessionUser> {
  return apiRequest("/v1/auth/me", options);
}

/** End the session. */
export async function signOut(options: RequestOptions = {}): Promise<{ readonly loggedOut: boolean }> {
  return apiRequest("/v1/auth/logout", { ...options, method: "POST" });
}

/** A taboo-free device fingerprint: the browser's own description, hashed by the server. */
export function fingerprint(): string {
  if (typeof navigator === "undefined") return "undal-storefront-prerender";
  return [navigator.userAgent, navigator.language, screen.width, screen.height, screen.colorDepth].join("|");
}
