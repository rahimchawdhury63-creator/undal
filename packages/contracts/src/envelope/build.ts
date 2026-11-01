/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { errorDefinition, type ErrorCode } from "../errors/registry.ts";
import type { ErrorEnvelope, ResponseMeta, SuccessEnvelope } from "./types.ts";

/** What a handler supplies when it fails; the copy is looked up, never passed in. */
export interface FailureInput {
  readonly requestId: string;
  readonly details?: Record<string, unknown>;
  readonly field?: string | null;
  /** Server time; injected so tests are deterministic and Workers pass `Date`. */
  readonly now?: Date;
}

/**
 * Build a success envelope.
 *
 * `ts` defaults to now because every caller would otherwise pass it, and every
 * one of them would occasionally pass the wrong thing. Test code takes the
 * `now` parameter instead.
 */
export function success<T>(data: T, meta: Omit<ResponseMeta, "ts"> & { ts?: string }): SuccessEnvelope<T> {
  return {
    ok: true,
    data,
    meta: { ...meta, ts: meta.ts ?? new Date().toISOString() },
  };
}

/**
 * Build a failure envelope from a registry code.
 *
 * The English and Bangla messages are read out of the registry rather than
 * passed by the handler, which is what stops the third copy of "That order was
 * already cancelled" appearing in a route file and slowly drifting from the
 * other two (D33).
 */
export function failure(code: ErrorCode, input: FailureInput): ErrorEnvelope {
  const definition = errorDefinition(code);
  return {
    ok: false,
    error: {
      code,
      message: definition.en,
      messageBn: definition.bn,
      field: input.field ?? null,
      retryable: definition.retryable,
      details: input.details ?? {},
    },
    meta: {
      requestId: input.requestId,
      ts: (input.now ?? new Date()).toISOString(),
    },
  };
}

/**
 * The HTTP status that belongs to a code.
 *
 * Exported separately from `failure` because the status is a property of the
 * code, not of the request: a route that returns `ORDER_ALREADY_CANCELLED` as
 * `200` would break every HTTP client, cache and retry library downstream.
 */
export function statusFor(code: ErrorCode): number {
  return errorDefinition(code).status;
}
