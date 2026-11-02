/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Response shaping for the realtime worker: one envelope, one request id, two content types.
 *
 * The envelope itself belongs to `@undal/contracts`, so a failure here and a failure in `undal-core`
 * carry the same code, the same copy and the same status. This module adds only what a Worker needs:
 * a request id that is propagated rather than minted per handler, and headers that stop a proxy from
 * caching an answer that is different for every caller.
 */

import { failure, statusFor, success, type ErrorCode } from "@undal/contracts";

/** The header every request and every response carries, so one conversation has one id. */
export const REQUEST_ID_HEADER = "X-Undal-Request-Id";

/** A UUID, so a request id is usable as a trace key without a second namespace. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * The request's id: the caller's if it is a UUID, otherwise a fresh one.
 *
 * A client-supplied id is adopted because the mobile apps retry and need the retry to correlate with
 * the attempt it repeats. It is validated because an arbitrary string in a log field is how a header
 * injection reaches a dashboard.
 */
export function requestIdOf(request: Request): string {
  const supplied = request.headers.get(REQUEST_ID_HEADER);
  return supplied !== null && UUID.test(supplied) ? supplied : crypto.randomUUID();
}

/** Headers every JSON response carries. */
export function baseHeaders(requestId: string): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    [REQUEST_ID_HEADER]: requestId,
  };
}

/** Write an already-built envelope with the status the caller chose. */
export function jsonResponse(
  payload: unknown,
  status: number,
  requestId: string,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...baseHeaders(requestId), ...extra },
  });
}

/** A success envelope, `200` unless the caller says otherwise. */
export function successResponse<T>(
  data: T,
  requestId: string,
  options: { readonly status?: number; readonly headers?: Record<string, string> } = {},
): Response {
  return jsonResponse(success(data, { requestId }), options.status ?? 200, requestId, options.headers ?? {});
}

/**
 * A failure envelope whose status comes from the error registry.
 *
 * The status is never a parameter: a route that returned `OFFER_EXPIRED` as `200` would break every
 * retry library downstream, and the registry already decided which number belongs to which code.
 */
export function failureResponse(
  code: ErrorCode,
  requestId: string,
  options: {
    readonly details?: Record<string, unknown>;
    readonly field?: string | null;
    readonly headers?: Record<string, string>;
  } = {},
): Response {
  const input = {
    requestId,
    ...(options.details === undefined ? {} : { details: options.details }),
    ...(options.field === undefined ? {} : { field: options.field }),
  };
  return jsonResponse(failure(code, input), statusFor(code), requestId, options.headers ?? {});
}

/**
 * Headers for an event stream.
 *
 * `x-accel-buffering: no` is for the proxies that buffer by default and would turn a live stream into
 * a fifteen-second batch; `cache-control: no-store` keeps a CDN from replaying one user's events to
 * another. `connection: keep-alive` is ignored by HTTP/2 but costs nothing and helps HTTP/1.1.
 */
export function sseHeaders(requestId: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    [REQUEST_ID_HEADER]: requestId,
    ...extra,
  };
}
