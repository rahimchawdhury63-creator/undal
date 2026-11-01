/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { failure, statusFor, success, type ErrorCode, type Locale } from "@undal/contracts";

import type { Failure } from "../lib/result.ts";

/**
 * Turn a handler's answer into the one envelope every client parses.
 *
 * Successes and failures both pass through `@undal/contracts`, so the status code is
 * derived from the error code in exactly one place. A route that returns its own
 * `Response` still gets the headers from here — `no-store` and the request id — because
 * a cached order state is the bug this envelope exists to prevent.
 */

/** Headers every API response carries. */
export function baseHeaders(requestId: string, extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "X-Undal-Request-Id": requestId,
    ...extra,
  };
}

/** A success envelope, with the meta the clients display in a footer. */
export function successResponse(data: unknown, locale: Locale, requestId: string, extra: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(success(data, { requestId })), {
    status: 200,
    headers: baseHeaders(requestId, extra),
  });
}

/** A failure envelope, with the status the registry assigns that code. */
export function failureResponse(failureInput: Failure, locale: Locale, requestId: string, extra: Readonly<Record<string, string>> = {}): Response {
  const body = failure(failureInput.code as ErrorCode, {
    requestId,
    ...(failureInput.field === undefined ? {} : { field: failureInput.field }),
    ...(failureInput.details === undefined ? {} : { details: failureInput.details }),
  });
  return new Response(JSON.stringify(body), {
    status: statusFor(failureInput.code as ErrorCode),
    headers: baseHeaders(requestId, extra),
  });
}
