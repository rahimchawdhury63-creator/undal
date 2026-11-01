/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The HTTP statuses Undal returns from an error envelope.
 *
 * Enumerated rather than `number` so a typo such as `4220` fails to compile, and
 * so the envelope test can assert every code maps to a status the CDN and the
 * Android client both handle.
 */
export type ErrorStatus =
  | 400
  | 401
  | 403
  | 404
  | 405
  | 409
  | 410
  | 413
  | 415
  | 422
  | 423
  | 428
  | 429
  | 451
  | 500
  | 501
  | 502
  | 503
  | 504;

/**
 * One row of the registry in tuple form.
 *
 * Tuples keep the register dense enough to live inside the 700-line cap while
 * still making all six mandated fields mandatory at compile time: dropping the
 * Bangla message is a type error, not a review miss.
 */
export type ErrorRow = readonly [
  code: string,
  status: ErrorStatus,
  en: string,
  bn: string,
  retryable: boolean,
  details: string,
];

/**
 * A resolved error definition: what the client receives in the envelope's
 * `error` object, minus the request-specific `details` values.
 *
 * `retryable` is part of the contract rather than a client-side guess because
 * only the server knows whether the second attempt can succeed — retrying an
 * `ORDER_ALREADY_CANCELLED` wastes a rider's battery and retrying a
 * `DEPENDENCY_TIMEOUT` is exactly right.
 */
export interface ErrorDefinition {
  readonly code: string;
  readonly status: ErrorStatus;
  readonly en: string;
  readonly bn: string;
  readonly retryable: boolean;
  /** A TypeScript-shaped description of the `details` object this code carries. */
  readonly details: string;
}
