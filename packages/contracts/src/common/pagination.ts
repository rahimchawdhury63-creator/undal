/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/** A page of results plus the token that continues it. */
export interface CursorPage<T> {
  readonly items: readonly T[];
  /** `null` when this is the last page — never an empty string, never omitted. */
  readonly nextCursor: string | null;
}

/** A decoded cursor: the sort key of the last row plus its id as a tiebreak. */
export interface Cursor {
  /** The `sort` value of the last returned row, as a string. */
  readonly key: string;
  /** The row's UUIDv7, so equal keys still page deterministically. */
  readonly id: string;
}

const MAX_CURSOR_LENGTH = 256;

/**
 * Encode a cursor as base64url.
 *
 * Opaque on purpose: clients must not construct one, because the moment a
 * cursor is readable it becomes an API surface that cannot change. Base64url
 * (not base64) because it travels in query strings where `+` and `/` get mangled
 * by proxies that predate percent-encoding.
 */
export function encodeCursor(cursor: Cursor): string {
  if (cursor.id.length === 0) {
    throw new RangeError("cursor id must not be empty");
  }
  const payload = JSON.stringify([cursor.key, cursor.id]);
  return Buffer.from(payload, "utf8").toString("base64url");
}

/**
 * Decode a cursor, returning `null` for anything malformed.
 *
 * Malformed cursors are not an error the customer can act on — the correct
 * behaviour is to serve the first page, which is what every list endpoint does
 * with `null`. Throwing here would turn a truncated link in a WhatsApp message
 * into a 500.
 */
export function decodeCursor(token: string | null | undefined): Cursor | null {
  if (token === null || token === undefined || token.length === 0 || token.length > MAX_CURSOR_LENGTH) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (!Array.isArray(decoded) || decoded.length !== 2) {
      return null;
    }
    const [key, id] = decoded;
    if (typeof key !== "string" || typeof id !== "string" || id.length === 0) {
      return null;
    }
    return { key, id };
  } catch {
    return null;
  }
}

/** The page size limits every list endpoint shares. */
export const PAGE_LIMIT = Object.freeze({ default: 20, min: 1, max: 100 });

/**
 * Clamp a requested `limit` into the supported range.
 *
 * Clamped rather than rejected because `?limit=500` is a client bug that must
 * not become a customer-visible error, and because an unbounded limit is how a
 * free-tier Worker runs out of memory on a vendor with a large menu.
 */
export function normalizeLimit(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined || raw === "") {
    return PAGE_LIMIT.default;
  }
  const parsed = typeof raw === "number" ? raw : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return PAGE_LIMIT.default;
  }
  const floored = Math.trunc(parsed);
  if (floored < PAGE_LIMIT.min) {
    return PAGE_LIMIT.min;
  }
  if (floored > PAGE_LIMIT.max) {
    return PAGE_LIMIT.max;
  }
  return floored;
}

/**
 * Build the cursor for the next page from a fetched page.
 *
 * Callers fetch `limit + 1` rows: if the extra row exists there is another page,
 * and the cursor points at the last row actually returned. This avoids the
 * `COUNT(*)` that TiDB would otherwise run on every list request.
 */
export function nextCursor<T>(
  rows: readonly T[],
  limit: number,
  keyOf: (row: T) => string,
  idOf: (row: T) => string,
): { page: readonly T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  if (!hasMore || last === undefined) {
    return { page, nextCursor: null };
  }
  return { page, nextCursor: encodeCursor({ key: keyOf(last), id: idOf(last) }) };
}
