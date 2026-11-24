/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { safeLedgerNumber } from "./exact.ts";
import type { EntryType, Posting } from "./types.ts";

/**
 * Closure: the one rule a ledger cannot break, checked in three places.
 *
 * Checked in the posting set before it reaches SQL, checked again after the postings are
 * written by the transactional posting foundation, and asserted by property tests. Existing
 * legacy writers are not atomic; aggregate reports alone do not prove every entry closed.
 */

/** A posting set that does not close, with the arithmetic that says so. */
export class LedgerImbalanceError extends Error {
  readonly entryType: EntryType | "UNKNOWN";
  readonly sumPaisa: number;
  readonly postings: readonly Posting[];

  constructor(entryType: EntryType | "UNKNOWN", sumPaisa: number, postings: readonly Posting[]) {
    super(`posting set ${entryType} sums to ${sumPaisa} paisa, not zero`);
    this.name = "LedgerImbalanceError";
    this.entryType = entryType;
    this.sumPaisa = sumPaisa;
    this.postings = postings;
  }
}

/** The signed total of a set. Zero is the only acceptable value. */
export function sumPaisa(postings: readonly Posting[]): number {
  let total = 0n;
  for (const posting of postings) {
    if (!Number.isSafeInteger(posting.amountPaisa)) throw new RangeError("posting amount must be a safe integer");
    total += BigInt(posting.amountPaisa);
  }
  return safeLedgerNumber(total);
}

/**
 * Refuse a posting set that cannot be recorded.
 *
 * Four refusals, each a real bug that reaches production otherwise: a set that does not
 * sum to zero; a set with fewer than two postings (one-sided entries are how a ledger
 * becomes a list); a non-integer amount (the money law); and a zero amount, which the
 * application rejects because a zero posting is noise that makes "who touched this account"
 * unanswerable. Migration 012 also declares a nonzero CHECK; its live enforcement must be verified.
 */
export function assertClosed(entryType: EntryType, postings: readonly Posting[]): void {
  if (postings.length < 2) {
    throw new LedgerImbalanceError(entryType, sumPaisa(postings), postings);
  }
  for (const posting of postings) {
    if (!Number.isSafeInteger(posting.amountPaisa)) {
      throw new RangeError(`${entryType}: ${posting.account.code} holds non-integer paisa ${posting.amountPaisa}`);
    }
    if (posting.amountPaisa === 0) {
      throw new RangeError(`${entryType}: ${posting.account.code} has a zero posting`);
    }
  }
  const total = sumPaisa(postings);
  if (total !== 0) throw new LedgerImbalanceError(entryType, total, postings);
}

/**
 * Whether the set closes, without throwing — for a validator that must not crash a request.
 *
 * The distinction matters in one place: an inbound webhook describing a settlement has
 * already happened outside the platform, so the caller logs an imbalance and raises an
 * exception rather than rejecting a fact.
 */
export function isClosed(postings: readonly Posting[]): boolean {
  return sumPaisa(postings) === 0;
}

/** Merge postings that share an account, which is what a trial balance needs. */
export function byAccount(postings: readonly Posting[]): Map<string, number> {
  const totals = new Map<string, bigint>();
  for (const posting of postings) {
    if (!Number.isSafeInteger(posting.amountPaisa)) throw new RangeError("posting amount must be a safe integer");
    const key = posting.account.code;
    totals.set(key, (totals.get(key) ?? 0n) + BigInt(posting.amountPaisa));
  }
  return new Map([...totals].map(([code, amount]) => [code, safeLedgerNumber(amount)]));
}
