/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { classifyError, isRetryable, type Db, type DbErrorKind } from "./client.ts";

/**
 * How a transaction is written here: a callback that gets a `Db`, retried on the
 * conditions that mean "the database, not the request, was unlucky".
 *
 * The HTTP driver's interactive transactions are documented as not concurrency-safe
 * and are auto-rolled-back after ten minutes idle (R33 in the risk register), so
 * this wrapper exists to make them **rare and short**: everything that can be one
 * statement is one statement, and what is left here is the ledger, where atomicity
 * across several rows is not negotiable.
 */

/** Attempts before giving up. Five is the number that covers a lunch-rush deadlock. */
export const MAX_ATTEMPTS = 5;
/** Base delay in milliseconds; the jitter is added on top of a doubling backoff. */
export const BASE_DELAY_MS = 25;

/** A runner that can open an interactive transaction and roll it back on error. */
export interface Transactional {
  begin(): Promise<Db & { commit(): Promise<void>; rollback(): Promise<void> }>;
}

/**
 * Full jitter, as the AWS builders describe it: `random(0, base * 2^attempt)`.
 *
 * Without the jitter, two Workers deadlocked on the same two ledger accounts retry
 * in lockstep and deadlock again. The random term is what breaks the symmetry, and it
 * is the reason this is not a fixed backoff.
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = BASE_DELAY_MS * 2 ** attempt;
  return Math.floor(random() * ceiling);
}

/** Sleep, which a Worker can only do by awaiting a timer. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `work` in a transaction, retrying deadlocks and lock timeouts.
 *
 * The callback may run more than once, so it must be free of side effects outside
 * the database — no pushes, no `waitUntil`. Effects are collected during the
 * transaction and dispatched after it commits, by the caller.
 */
export async function withTransaction<T>(
  runner: Transactional,
  work: (tx: Db) => Promise<T>,
  options: { attempts?: number; sleepFn?: (ms: number) => Promise<void>; random?: () => number } = {},
): Promise<T> {
  const attempts = options.attempts ?? MAX_ATTEMPTS;
  const sleepFn = options.sleepFn ?? sleep;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const tx = await runner.begin();
    try {
      const value = await work(tx);
      await tx.commit();
      return value;
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      lastError = error;
      const kind: DbErrorKind = classifyError(error);
      if (!isRetryable(kind) || attempt === attempts - 1) throw error;
      await sleepFn(backoffDelay(attempt, options.random));
    }
  }
  throw lastError;
}
