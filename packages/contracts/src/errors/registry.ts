/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The error registry: 187 codes, assembled from sixteen group files.
 *
 * Assembled rather than authored in one place so each group can be read against the
 * specification table beside it, and so the compile-time check for "all six fields" is
 * a `satisfies` on the rows rather than a lint rule nobody runs.
 */

import type { ErrorDefinition } from "./types.ts";

import { AUTH_ROWS } from "./rows/auth.ts";
import { PERM_ROWS } from "./rows/perm.ts";
import { VALIDATION_ROWS } from "./rows/validation.ts";
import { CATALOG_ROWS } from "./rows/catalog.ts";
import { QUOTE_ROWS } from "./rows/quote.ts";
import { ORDER_ROWS } from "./rows/order.ts";
import { OFFER_ROWS } from "./rows/offer.ts";
import { QR_ROWS } from "./rows/qr.ts";
import { SHIFT_ROWS } from "./rows/shift.ts";
import { CASH_ROWS } from "./rows/cash.ts";
import { MONEY_ROWS } from "./rows/money.ts";
import { KYC_ROWS } from "./rows/kyc.ts";
import { MEDIA_ROWS } from "./rows/media.ts";
import { ZONE_ROWS } from "./rows/zone.ts";
import { RATE_ROWS } from "./rows/rate.ts";
import { SYSTEM_ROWS } from "./rows/system.ts";

/**
 * Every row, in specification order. Concatenated as a tuple so the code strings
 * survive as literal types and `ErrorCode` is a union of exactly these 185 values.
 */
const ALL_ROWS = [
  ...AUTH_ROWS,
  ...PERM_ROWS,
  ...VALIDATION_ROWS,
  ...CATALOG_ROWS,
  ...QUOTE_ROWS,
  ...ORDER_ROWS,
  ...OFFER_ROWS,
  ...QR_ROWS,
  ...SHIFT_ROWS,
  ...CASH_ROWS,
  ...MONEY_ROWS,
  ...KYC_ROWS,
  ...MEDIA_ROWS,
  ...ZONE_ROWS,
  ...RATE_ROWS,
  ...SYSTEM_ROWS,
] as const;

/**
 * The union of every error code Undal can return. Clients switch on this type, so a
 * handler that returns a code outside it does not compile.
 */
export type ErrorCode = (typeof ALL_ROWS)[number][0];

/**
 * The registry, keyed by code.
 *
 * Built at module load and frozen: a duplicate code is a copy-paste defect that
 * would otherwise give two different HTTP statuses to one string depending on
 * which row the lookup found first, so it throws immediately instead.
 */
export const ERRORS: Readonly<Record<ErrorCode, ErrorDefinition>> = (() => {
  const map = new Map<string, ErrorDefinition>();
  for (const [code, status, en, bn, retryable, details] of ALL_ROWS) {
    if (map.has(code)) {
      throw new Error(`duplicate error code in registry: ${code}`);
    }
    map.set(code, { code, status, en, bn, retryable, details });
  }
  return Object.freeze(Object.fromEntries(map)) as Record<ErrorCode, ErrorDefinition>;
})();

/**
 * The number of registered codes.
 *
 * Exported so the parity test can assert it equals the 185 the specification
 * registers without hard-coding the number in two places and letting them drift.
 */
export const ERROR_COUNT = ALL_ROWS.length;

/** True when a string is one of the registered codes. */
export function isErrorCode(value: string): value is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERRORS, value);
}

/**
 * Look up a definition, failing loudly.
 *
 * Used by handlers that construct a code from a variable (a prefix plus a
 * suffix). A missing lookup is a programming error, and returning a generic
 * `INTERNAL` here would hide which handler was wrong.
 */
export function errorDefinition(code: ErrorCode): ErrorDefinition {
  const definition = ERRORS[code];
  if (definition === undefined) {
    throw new RangeError(`unknown error code: ${code}`);
  }
  return definition;
}
