/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The request id, which is the only thread that ties a client report to a log line.
 *
 * A caller may supply one so that a mobile app's crash report and the server's log
 * agree; it is accepted only in the documented header and only when it looks like an
 * id, because an id that a caller controls freely is a log-injection surface.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** The header the clients send and the Worker echoes. */
export const REQUEST_ID_HEADER = "X-Undal-Request-Id";

/** The inbound id when it is well-formed, otherwise a new UUIDv4-shaped id. */
export function resolveRequestId(request: Request): string {
  const supplied = request.headers.get(REQUEST_ID_HEADER);
  if (supplied !== null && UUID.test(supplied)) return supplied.toLowerCase();
  return crypto.randomUUID();
}

/** The caller's address, taken from the header the edge guarantees. */
export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

/** The user agent, truncated to the column's width. */
export function clientUserAgent(request: Request): string {
  return (request.headers.get("User-Agent") ?? "unknown").slice(0, 512);
}
