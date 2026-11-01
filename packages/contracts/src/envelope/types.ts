/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { ErrorCode } from "../errors/registry.ts";

/**
 * Metadata present on every response, success or failure.
 *
 * `requestId` is echoed from `X-Undal-Request-Id` (or minted) and appears in the
 * Worker log, the SSE frame and the support tool, so a customer reading it out
 * over the phone leads to exactly one trace. `ts` is server time in UTC ISO-8601
 * because clients must never trust the device clock for ordering.
 */
export interface ResponseMeta {
  readonly requestId: string;
  readonly ts: string;
  /** Present only on paginated list responses. */
  readonly nextCursor?: string;
  /** Present only where a list endpoint can cheaply produce an exact count. */
  readonly total?: number;
}

/** A successful response. `data` is the route's own shape. */
export interface SuccessEnvelope<T> {
  readonly ok: true;
  readonly data: T;
  readonly meta: ResponseMeta;
}

/** The error object carried by every failure, and by no success. */
export interface ErrorBody {
  /** The stable contract. Clients branch on this, never on `message`. */
  readonly code: ErrorCode;
  /** English copy, from the registry — never written at the call site. */
  readonly message: string;
  /** Bangla copy, from the same registry row, so the two can never disagree. */
  readonly messageBn: string;
  /** The first failing field path on validation errors, otherwise `null`. */
  readonly field: string | null;
  /** Whether the same request, retried as-is, can succeed. */
  readonly retryable: boolean;
  /** Structured, route-specific context. Never contains a stack or SQL. */
  readonly details: Record<string, unknown>;
}

/** A failed response. */
export interface ErrorEnvelope {
  readonly ok: false;
  readonly error: ErrorBody;
  readonly meta: ResponseMeta;
}

/**
 * The only two shapes any Undal endpoint may return.
 *
 * A discriminated union rather than an envelope with optional fields: it makes
 * `if (!body.ok)` narrow `body.error` automatically, which is how every client
 * handler is written, and it makes a response that is neither shape a compile
 * error rather than a runtime surprise on a rider's phone in a moving van.
 */
export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;
