/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * A value or a reason, without an exception.
 *
 * `undal-core` has the same pair typed to its error registry. This one is generic over the reason because
 * the realtime Worker's failures are not all registry codes — a token can fail verification with a reason
 * that belongs in a log line and in no client's `switch`.
 */

/** A success or a failure. */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** A success. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** A failure. */
export function fail<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
