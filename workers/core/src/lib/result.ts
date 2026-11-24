/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { ErrorCode } from "@undal/contracts";

/**
 * What a domain function returns instead of throwing.
 *
 * Handlers run inside a pipeline whose last step turns a value into an envelope, so
 * the pipeline — not the call stack — decides the HTTP status. A thrown error would
 * have to be caught somewhere central and re-classified by message, which is how
 * "unexpected 500" happens to a request whose real answer was a validation failure.
 */
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: Failure };

/** Why something failed, expressed in the codes the clients already switch on. */
export interface Failure {
  readonly code: ErrorCode;
  /** The offending field, for a validation failure the form can highlight. */
  readonly field?: string;
  /** Route-specific structure the client may act on, never prose. */
  readonly details?: Readonly<Record<string, unknown>>;
}

/** A success. */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

/** A failure, with the optional parts omitted rather than set to `undefined`. */
export function fail(
  code: ErrorCode,
  extra: { field?: string; details?: Readonly<Record<string, unknown>> } = {},
): Result<never> {
  const failure: { -readonly [K in keyof Failure]: Failure[K] } = { code };
  if (extra.field !== undefined) failure.field = extra.field;
  if (extra.details !== undefined) failure.details = extra.details;
  return { ok: false, error: failure };
}

/**
 * Collect the first failure of a list, or all the values.
 *
 * Field validation wants "first failure wins" because a form shows one error per
 * field anyway, and a caller that has to reason about partial success will forget to.
 */
export function allOrFirst<T>(results: readonly Result<T>[]): Result<T[]> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
}

/** Run a mapping that may fail, stopping at the first failure. */
export function andThen<T, U>(result: Result<T>, next: (value: T) => Result<U>): Result<U> {
  return result.ok ? next(result.value) : result;
}

/** The value, or a fallback — for the handful of places where absence is fine. */
export function unwrapOr<T>(result: Result<T>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
