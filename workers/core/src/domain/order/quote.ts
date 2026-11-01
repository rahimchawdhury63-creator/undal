/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Quotes: a signed price the customer can look at, and a placement that cannot quietly change it.
 *
 * A quote is not a row. It is a snapshot — the fare inputs and the totals they produced — signed
 * with HMAC-SHA256 and handed to the client. That shape is what makes the five-minute promise
 * enforce­able: the server can recompute the price from scratch at placement and compare, so a
 * customer who was quoted ৳549 is either charged ৳549 or told, line by line, what moved and why.
 *
 * Nothing here trusts the client. The token is a *claim* about what was quoted; the signature
 * only proves the platform issued it. The truth is the re-price.
 */

/** A quote lives for five minutes: long enough to read a cart, short enough to stay true. */
export const QUOTE_TTL_MS = 5 * 60 * 1000;

/** One line of a quoted cart, with its price fixed at quote time. */
export interface QuotedItem {
  readonly menuItemId: string;
  readonly quantity: number;
  /** The unit price in paisa at quote time, before item-level discounts. */
  readonly unitPricePaisa: number;
  /** Modifier total per unit, already summed. */
  readonly modifiersPaisa: number;
}

/** The money a quote promises. Every field is what the customer will be asked to pay. */
export interface QuoteTotals {
  readonly subtotalPaisa: number;
  readonly discountPaisa: number;
  readonly deliveryFeePaisa: number;
  readonly smallOrderFeePaisa: number;
  readonly taxPaisa: number;
  readonly tipPaisa: number;
  readonly roundingPaisa: number;
  readonly totalPaisa: number;
}

/** A quote, as issued. */
export interface QuoteSnapshot {
  readonly quoteId: string;
  readonly customerId: string;
  readonly vendorId: string;
  readonly zoneId: string;
  readonly fulfilment: "DELIVERY" | "PICKUP";
  readonly items: readonly QuotedItem[];
  readonly totals: QuoteTotals;
  readonly surgeBps: number;
  readonly weatherCondition: string;
  readonly routeDistanceM: number;
  readonly routeDurationS: number;
  readonly trafficDelayS: number;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly fareSource: "BRAIN" | "FALLBACK" | "ADMIN_OVERRIDE";
}

/** A quote as it travels to the client: the snapshot and the proof it came from us. */
export interface SignedQuote {
  readonly snapshot: QuoteSnapshot;
  readonly token: string;
}

/** Why a quote was refused. Each maps to a contract code. */
export type QuoteRefusal = "QUOTE_EXPIRED" | "QUOTE_MISMATCH" | "QUOTE_ALREADY_USED";

/** One line of a price difference, as the customer is shown it. */
export interface PriceDiff {
  readonly field: keyof QuoteTotals | "items";
  readonly quotedPaisa: number;
  readonly nowPaisa: number;
  readonly deltaPaisa: number;
}

const encoder = new TextEncoder();

/**
 * Canonical JSON: sorted keys, no whitespace.
 *
 * The signature has to be stable across two processes that may serialise an object differently,
 * and JSON key order is not part of the language specification. Sorting is the least clever way
 * to make the bytes deterministic, and clever here would be a signature that verifies on one
 * runtime and not the other.
 */
export function canonicalQuote(snapshot: QuoteSnapshot): string {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => (left < right ? -1 : 1))
          .map(([key, inner]) => [key, sorted(inner)]),
      );
    }
    return value;
  };
  return JSON.stringify(sorted(snapshot));
}

async function keyBytes(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function mac(secret: string, payload: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await keyBytes(secret), encoder.encode(payload));
  const bytes = new Uint8Array(signature);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Issue a quote, signed and dated.
 *
 * The expiry is stamped here rather than trusted from the caller, because a client-supplied
 * expiry is a client-supplied discount: the whole value of the five minutes is that the server
 * decided when they started.
 */
export async function issueQuote(
  input: Omit<QuoteSnapshot, "issuedAtMs" | "expiresAtMs">,
  secret: string,
  nowMs: number,
): Promise<SignedQuote> {
  assertNonNegative(input.totals);
  const snapshot: QuoteSnapshot = { ...input, issuedAtMs: nowMs, expiresAtMs: nowMs + QUOTE_TTL_MS };
  return { snapshot, token: await mac(secret, canonicalQuote(snapshot)) };
}

/** The verdict on a presented quote token. */
export type QuoteVerdict =
  | { readonly ok: true; readonly snapshot: QuoteSnapshot }
  | { readonly ok: false; readonly code: QuoteRefusal };

/**
 * Verify a token without re-pricing: is this ours, and is it still alive?
 *
 * A tampered token is `QUOTE_MISMATCH` rather than a server error, because from the customer's
 * point of view they presented a price and it was not the price — the diff screen is where the
 * explanation belongs.
 */
export async function verifyQuoteToken(token: string, secret: string, nowMs: number): Promise<QuoteVerdict> {
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return { ok: false, code: "QUOTE_MISMATCH" };

  const payload = token.slice(0, separator);
  const presented = token.slice(separator + 1);
  if (!(await constantTimeEquals(await mac(secret, payload), presented))) return { ok: false, code: "QUOTE_MISMATCH" };

  const snapshot = JSON.parse(payload) as QuoteSnapshot;
  if (nowMs > snapshot.expiresAtMs) return { ok: false, code: "QUOTE_EXPIRED" };
  return { ok: true, snapshot };
}

/** Serialise a signed quote for the wire: payload, then signature. */
export function encodeQuote(signed: SignedQuote): string {
  return `${canonicalQuote(signed.snapshot)}.${signed.token}`;
}

/**
 * Compare what was quoted with what the price is now.
 *
 * Every difference is returned, not just the first: a customer whose voucher expired and whose
 * delivery fee rose is owed both facts, and a diff that reports one is a support ticket.
 */
export function diffQuote(quoted: QuoteTotals, now: QuoteTotals): readonly PriceDiff[] {
  const diffs: PriceDiff[] = [];
  for (const field of Object.keys(quoted) as (keyof QuoteTotals)[]) {
    if (quoted[field] !== now[field]) {
      diffs.push({ field, quotedPaisa: quoted[field], nowPaisa: now[field], deltaPaisa: now[field] - quoted[field] });
    }
  }
  return diffs;
}

/** Whether two carts are the same lines at the same prices. */
export function sameItems(left: readonly QuotedItem[], right: readonly QuotedItem[]): boolean {
  if (left.length !== right.length) return false;
  const key = (item: QuotedItem): string => `${item.menuItemId}|${item.quantity}|${item.unitPricePaisa}|${item.modifiersPaisa}`;
  const leftKeys = left.map(key).sort();
  const rightKeys = right.map(key).sort();
  return leftKeys.every((value, index) => value === rightKeys[index]);
}

function assertNonNegative(totals: QuoteTotals): void {
  for (const [field, value] of Object.entries(totals)) {
    if (field === "roundingPaisa") continue;
    if (!Number.isInteger(value) || value < 0) throw new RangeError(`quote: ${field} must be non-negative integer paisa`);
  }
  if (!Number.isInteger(totals.totalPaisa)) throw new RangeError("quote: total must be integer paisa");
}

async function constantTimeEquals(left: string, right: string): Promise<boolean> {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
