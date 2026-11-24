/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Ctx, Env } from "./context.ts";
import { failureResponse } from "./envelope.ts";

/**
 * Approval and write-off are multi-statement and lack durable financial idempotency.
 * No configuration can enable them in production, preview or an unknown environment.
 * Opt-in is for isolated staging/test databases only, never a database holding live money.
 */
export function unsafeCashWritesAllowed(env: Env): boolean {
  return (env.ENVIRONMENT === "test" || env.ENVIRONMENT === "staging") && env.ALLOW_UNSAFE_CASH_WRITES === "true";
}

/** Refuse the action before any cash/ledger mutation, or allow an isolated test. */
export function unsafeCashWriteRefusal(ctx: Ctx): Response | null {
  return unsafeCashWritesAllowed(ctx.env)
    ? null
    : failureResponse({ code: "SERVICE_DEGRADED", details: { component: "cash_financial_writes" } }, ctx.locale, ctx.requestId);
}
