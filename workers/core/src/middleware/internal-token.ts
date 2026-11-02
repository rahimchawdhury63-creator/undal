/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The shared token that lets `undal-realtime` call this Worker's internal surface (D82, D84).
 *
 * The internal routes are declared anonymous so the pipeline does not demand a user session from a Worker,
 * and each handler's first act is this check. Two rules rather than one: a route that forgot the check
 * would otherwise be served to anybody who found the path, and a token that is absent from the deployment
 * is a refusal rather than a wildcard — "configure me and I will answer" is an open surface.
 */

import { failureResponse } from "./envelope.ts";
import type { Ctx } from "./context.ts";

/**
 * Refuse unless the request presents the internal token.
 *
 * Returns the refusal to send back, or `null` when the caller may proceed. A `null` return is the only
 * thing a route may treat as permission, which is why the helper returns a `Response` rather than a
 * boolean: a boolean invites `if (!ok) { /* forget to return *\/ }`.
 */
export function requireInternalToken(ctx: Ctx): Response | null {
  const expected = ctx.env.INTERNAL_TOKEN;
  const presented = ctx.request.headers.get("authorization") ?? "";
  if (expected === undefined || expected === "" || presented !== `Bearer ${expected}`) {
    return failureResponse({ code: "AUTH_TOKEN_INVALID" }, ctx.locale, ctx.requestId);
  }
  return null;
}
