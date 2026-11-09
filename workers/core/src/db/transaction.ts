/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { classifyError, type Db } from "./client.ts";

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

/** A commit failed or its acknowledgement was lost; the database outcome is unknown. */
export class TransactionCommitUnknownError extends Error {
  constructor(cause: unknown) {
    super("transaction commit outcome is unknown; reconcile before retrying", { cause });
    this.name = "TransactionCommitUnknownError";
  }
}

/** Rollback was not confirmed, so automatic retry cannot be assumed safe. */
export class TransactionRollbackUnknownError extends Error {
  readonly workError: unknown;
  constructor(workError: unknown, cause: unknown) {
    super("transaction rollback outcome is unknown; do not retry automatically", { cause });
    this.name = "TransactionRollbackUnknownError";
    this.workError = workError;
  }
}

/**
 * Run database-only work in a transaction. Retry only a deadlock/lock timeout after a
 * confirmed rollback. Never retry an ambiguous commit, connection error, or failed rollback.
 * The callback can run more than once; external effects must occur only after commit.
 */
export async function withTransaction<T>(
  runner: Transactional,
  work: (tx: Db) => Promise<T>,
  options: { attempts?: number; sleepFn?: (ms: number) => Promise<void>; random?: () => number } = {},
): Promise<T> {
  const attempts = options.attempts ?? MAX_ATTEMPTS;
  if (!Number.isSafeInteger(attempts) || attempts < 1) throw new RangeError("attempts must be a positive integer");
  const sleepFn = options.sleepFn ?? sleep;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const tx = await runner.begin();
    let result: T;
    try {
      result = await work(tx);
    } catch (error) {
      try {
        await tx.rollback();
      } catch (rollbackError) {
        throw new TransactionRollbackUnknownError(error, rollbackError);
      }
      const kind = classifyError(error);
      if ((kind !== "DEADLOCK" && kind !== "LOCK_TIMEOUT") || attempt === attempts - 1) throw error;
      await sleepFn(backoffDelay(attempt, options.random));
      continue;
    }
    try {
      await tx.commit();
    } catch (error) {
      // It may have committed and lost its response. A rollback or replay is not proof
      // of either outcome; a durable operation ID and reconciliation are required.
      throw new TransactionCommitUnknownError(error);
    }
    return result;
  }
  throw new Error("unreachable transaction retry state");
}
