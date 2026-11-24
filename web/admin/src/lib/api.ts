/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The console's API client.
 *
 * The same envelope the storefront reads, with the shapes the operations routes actually return.
 * Two differences matter. Every request carries the reviewer's access token, and every failure
 * keeps its `requestId`, because an operations screen is where somebody has to explain to a rider
 * why their money was not released — and "it failed" is not an explanation.
 *
 * Money is integer paisa here as everywhere; the console formats it at the edge with the same
 * translator the customer app uses, so ৳1,250.00 looks identical on both sides of the platform.
 */

const ENV = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

/** Where the API lives. Same-origin `/api` in production, proxied in development. */
export const API_BASE = (ENV["VITE_API_BASE"] ?? "/api").replace(/\/$/u, "");

/** An error the server described, or a failure it could not describe. */
export class ApiError extends Error {
  /** The stable contract code, or `NETWORK` when nothing answered. */
  readonly code: string;
  /** The HTTP status, or `0` when the request never reached a server. */
  readonly status: number;
  /** The failing field, when the refusal named one. */
  readonly field: string | null;
  /** Whether retrying the same request could plausibly succeed. */
  readonly retryable: boolean;
  /** The id a support conversation can quote to find this one trace. */
  readonly requestId: string | null;

  constructor(input: {
    readonly code: string;
    readonly status: number;
    readonly message: string;
    readonly field?: string | null;
    readonly retryable?: boolean;
    readonly requestId?: string | null;
  }) {
    super(input.message);
    this.name = "ApiError";
    this.code = input.code;
    this.status = input.status;
    this.field = input.field ?? null;
    this.retryable = input.retryable ?? false;
    this.requestId = input.requestId ?? null;
  }
}

/** Coerce any thrown value into an `ApiError`. */
export function toApiError(failure: unknown): ApiError {
  if (failure instanceof ApiError) return failure;
  return new ApiError({
    code: "NETWORK",
    status: 0,
    message: failure instanceof Error ? failure.message : "The console could not reach Undal.",
    retryable: true,
  });
}

/** What a call may carry. */
export interface CallOptions {
  readonly method?: "GET" | "POST" | "PATCH" | "DELETE";
  readonly body?: unknown;
  readonly token?: string | null;
  readonly signal?: AbortSignal;
  readonly query?: Readonly<Record<string, string | number | boolean | null | undefined>>;
}

/** Build a query string, dropping empty values rather than sending `undefined`. */
export function queryString(query: CallOptions["query"]): string {
  if (query === undefined) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const rendered = params.toString();
  return rendered === "" ? "" : `?${rendered}`;
}

/**
 * One API call, unwrapped.
 *
 * A `403` is turned into its own sentence because it is the failure an operator meets most often
 * and it is not a bug: it means this account does not hold the permission the route requires, and
 * the console says so instead of showing an error state that invites a retry which cannot work.
 */
export async function apiCall<T>(path: string, options: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (typeof options.token === "string" && options.token !== "") headers["authorization"] = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}${queryString(options.query)}`, {
      method: options.method ?? "GET",
      headers,
      credentials: "same-origin",
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (cause) {
    const aborted =
      (options.signal !== undefined && options.signal.aborted) ||
      (cause instanceof DOMException && cause.name === "AbortError");
    throw new ApiError({
      code: aborted ? "ABORTED" : "NETWORK",
      status: 0,
      message: aborted ? "The request was cancelled." : "The console could not reach Undal.",
      retryable: !aborted,
    });
  }

  let parsed: { ok: true; data: T; meta?: { requestId?: string; nextCursor?: string } } | { ok: false; error: { code: string; message: string; field?: string | null; retryable?: boolean }; meta?: { requestId?: string } } | null = null;
  try {
    parsed = await response.json();
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
      requestId: parsed.meta?.requestId ?? response.headers.get("x-undal-request-id"),
    });
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------------------------
// Shapes.
// ---------------------------------------------------------------------------------------------

/** The signed-in reviewer. */
export interface AdminUser {
  readonly userId: string;
  readonly actorType: string;
  readonly role: string;
  readonly phone?: string | null;
}

/** The token pair the auth routes return. */
export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
}

/** One rider's cash claim, as the reviewer's queue presents it. */
export interface SettlementEntry {
  readonly id: string;
  readonly rider: { readonly id: string; readonly name: string | null; readonly code: string | null };
  readonly amountPaisa: number;
  readonly method: string;
  readonly trxId: string | null;
  readonly submittedAt: string;
  readonly ageMinutes: number | null;
  readonly reviewDueBy: string | null;
  readonly slaBreached: boolean;
  readonly partial: boolean;
  readonly escalated: boolean;
  readonly escalationNote: string | null;
  readonly numberMatches: boolean | null;
  readonly nameMatches: boolean | null;
  readonly screenshotUrl: string | null;
  readonly selfieUrl: string | null;
  readonly status: string;
  readonly confirmedAt: string | null;
  readonly rejectionReason: string | null;
  readonly approvedPaisa: number | null;
}

/** The settlement queue's page and its header numbers. */
export interface SettlementQueue {
  readonly settlements: readonly SettlementEntry[];
  readonly summary: {
    readonly total: number;
    readonly pending: number;
    readonly oldestMinutes: number | null;
    readonly breaches: number;
    readonly limit: number;
    readonly state: string;
    readonly method: string | null;
  };
  readonly nextCursor: string | null;
}

/** One declaration: a robbery, a dispute or an emergency an operator must answer. */
export interface DeclarationEntry {
  readonly id: string;
  readonly riderId?: string;
  readonly riderName?: string | null;
  readonly kind: string;
  readonly note?: string | null;
  readonly outstandingPaisa?: number | null;
  readonly snapshotDifferencePaisa?: number | null;
  readonly createdAt?: string;
  readonly status?: string;
  readonly [key: string]: unknown;
}

/** The declaration queue. */
export interface DeclarationQueue {
  readonly declarations: readonly DeclarationEntry[];
  readonly summary: {
    readonly total: number;
    readonly robberies: number;
    readonly disputes: number;
    readonly emergencies: number;
    readonly limit: number;
    readonly state: string;
    readonly kind: string | null;
  };
  readonly nextCursor: string | null;
}

/** One order as the console lists it (the same serialiser the customer sees). */
export interface OrderRow {
  readonly id: string;
  readonly code: string;
  readonly state: string;
  readonly fulfilment: string;
  readonly vendorId: string;
  readonly riderId: string | null;
  readonly money: { readonly totalPaisa: number; readonly subtotalPaisa: number };
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------------------------
// Endpoints.
// ---------------------------------------------------------------------------------------------

/** Exchange a phone number and password for a token pair. */
export async function login(phone: string, password: string, fingerprint: string): Promise<TokenPair> {
  return apiCall<TokenPair>("/v1/auth/login", {
    method: "POST",
    body: { phone, password, fingerprint, platform: "WEB" },
  });
}

/** Exchange a refresh token for a fresh pair. */
export async function refresh(refreshToken: string): Promise<TokenPair> {
  return apiCall<TokenPair>("/v1/auth/refresh", { method: "POST", body: { refreshToken } });
}

/** The reviewer this token belongs to. */
export async function whoAmI(token: string): Promise<AdminUser> {
  return apiCall<AdminUser>("/v1/auth/me", { token });
}

/** End this session on the server. */
export async function logout(token: string): Promise<void> {
  await apiCall<{ loggedOut: boolean }>("/v1/auth/logout", { method: "POST", token });
}

/** The reviewer's settlement queue. */
export async function settlementQueue(
  token: string,
  query: { state?: string; method?: string | null; breach?: boolean | null; limit?: number; cursor?: string | null } = {},
): Promise<SettlementQueue> {
  return apiCall<SettlementQueue>("/v1/finance/cash/settlements", { token, query });
}

/** The reviewer's declaration queue. */
export async function declarationQueue(
  token: string,
  query: { state?: string; kind?: string | null; limit?: number; cursor?: string | null } = {},
): Promise<DeclarationQueue> {
  return apiCall<DeclarationQueue>("/v1/finance/cash/declarations", { token, query });
}

/** The audit reasons a reviewer may approve a settlement with. */
export const APPROVAL_REASONS = ["BKASH_TRANSFER_CONFIRMED", "CASH_HANDOVER_CONFIRMED", "CASH_COUNTED_SHORT"] as const;

/**
 * The nine reasons a reviewer may reject a settlement with.
 *
 * A closed list, because each code becomes a specific instruction on the rider's blocked screen;
 * free text at 1 am would invent a translation the rider cannot act on.
 */
export const REJECTION_REASONS = [
  "TRXID_NOT_FOUND",
  "TRXID_ALREADY_USED",
  "AMOUNT_MISMATCH",
  "SCREENSHOT_UNREADABLE",
  "SCREENSHOT_MISMATCH",
  "SELFIE_UNCLEAR",
  "NUMBER_MISMATCH",
  "PAYMENT_NOT_RECEIVED",
  "OTHER",
] as const;

/** Approve a settlement, releasing the rider's block. */
export async function approveSettlement(
  token: string,
  id: string,
  reason: (typeof APPROVAL_REASONS)[number],
  note: string | null,
): Promise<unknown> {
  return apiCall(`/v1/finance/cash/settlements/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    token,
    body: note === null || note === "" ? { reason } : { reason, note },
  });
}

/** Reject a settlement, with the code the rider reads and the note beside it. */
export async function rejectSettlement(
  token: string,
  id: string,
  reason: (typeof REJECTION_REASONS)[number],
  note: string | null,
): Promise<unknown> {
  return apiCall(`/v1/finance/cash/settlements/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    token,
    body: note === null || note === "" ? { reason } : { reason, note },
  });
}

/** Hand a settlement to another reviewer, with a note they inherit. */
export async function escalateSettlement(token: string, id: string, note: string): Promise<unknown> {
  return apiCall(`/v1/finance/cash/settlements/${encodeURIComponent(id)}/escalate`, {
    method: "POST",
    token,
    body: { note },
  });
}

/** Claim a declaration for this reviewer, so two people do not answer the same rider. */
export async function claimDeclaration(token: string, id: string): Promise<unknown> {
  return apiCall(`/v1/finance/cash/declarations/${encodeURIComponent(id)}/claim`, { method: "POST", token, body: {} });
}

/** Release a claim, putting the case back in the queue. */
export async function releaseDeclaration(token: string, id: string): Promise<unknown> {
  return apiCall(`/v1/finance/cash/declarations/${encodeURIComponent(id)}/release`, { method: "POST", token, body: {} });
}

/** Write off a rider's outstanding balance, with the reason an auditor will read next year. */
export async function writeOffRider(token: string, riderId: string, reason: string): Promise<unknown> {
  return apiCall(`/v1/finance/cash/riders/${encodeURIComponent(riderId)}/write-off`, {
    method: "POST",
    token,
    body: { reason },
  });
}

/** One vendor as the console reads it. Amounts are absent; finance is its own permission. */
export interface AdminVendor {
  readonly id: string;
  readonly kind: string;
  readonly slug: string;
  readonly name: string;
  readonly nameBn: string | null;
  readonly tagline: string | null;
  readonly phone: string;
  readonly zoneId: string;
  readonly status: string;
  readonly openState: string;
  readonly busyLevel: number;
  readonly pausedUntil: string | null;
  readonly pauseReason: string | null;
  readonly commissionBps: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A page of vendors. */
export interface VendorPage {
  readonly vendors: readonly AdminVendor[];
  readonly nextCursor: string | null;
}

/** The vendor list, filtered and paged. */
export async function listVendors(
  token: string,
  query: { status?: string | null; q?: string | null; zoneId?: string | null; limit?: number; cursor?: string | null } = {},
): Promise<VendorPage> {
  return apiCall<VendorPage>("/v1/vendors", { token, query });
}

/**
 * Pause a kitchen until a known moment.
 *
 * `minutes` is bounded by the server at one day: an indefinite pause is a suspension wearing the
 * wrong name, and the console cannot express one.
 */
export async function pauseVendor(token: string, id: string, minutes: number, reason: string): Promise<{ readonly vendor: AdminVendor; readonly pausedUntil: string }> {
  return apiCall(`/v1/vendors/${encodeURIComponent(id)}/pause`, { method: "POST", token, body: { minutes, reason } });
}

/** Clear a pause. */
export async function resumeVendor(token: string, id: string): Promise<{ readonly vendor: AdminVendor }> {
  return apiCall(`/v1/vendors/${encodeURIComponent(id)}/resume`, { method: "POST", token, body: {} });
}

/** The order board. */
export async function listOrders(token: string, limit = 50): Promise<{ readonly orders: readonly OrderRow[] }> {
  return apiCall<{ readonly orders: readonly OrderRow[] }>("/v1/orders", { token, query: { limit } });
}
