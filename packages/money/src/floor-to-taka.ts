/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Paisa } from "./paisa.ts";

/** A floored total and the rounding delta the platform absorbs. */
export interface FlooredTotal {
  /** The amount the customer actually pays: always a whole number of taka. */
  readonly total: Paisa;
  /**
   * `total − raw`, always in (−100, 0]. Negative because the customer is
   * never rounded up: cash is counted in taka, and asking for ৳549.81 at a door
   * is asking for an argument.
   */
  readonly delta: Paisa;
}

/**
 * Floor a customer total to the taka, once, at the very end of fare assembly.
 *
 * Every intermediate step keeps paisa precision; only the customer's payable
 * total is floored, and the 0–99 paisa the platform gives up is booked to
 * `PLATFORM:EXPENSE_ROUNDING` so the ledger still closes. Property P3 asserts
 * the delta never exceeds 99 paisa.
 *
 * Negative amounts are rejected rather than floored. A refund must return the
 * exact amount that was charged — which lives on the order row — and deriving
 * it by flooring a negative would hand back a paisa the customer never paid.
 */
export function floorToTaka(amountPaisa: Paisa | number): FlooredTotal {
  if (!Number.isSafeInteger(amountPaisa)) {
    throw new RangeError(`floorToTaka: expected integer paisa, got ${amountPaisa}`);
  }
  if (amountPaisa < 0) {
    throw new RangeError(`floorToTaka: customer totals are never negative, got ${amountPaisa}`);
  }

  const remainder = amountPaisa % 100;
  return {
    total: (amountPaisa - remainder) as Paisa,
    // Guard the -0 that `-0 % 100` would otherwise produce: it compares equal
    // to 0 but serialises as "0" only by accident, and a ledger column that
    // sometimes holds -0 is a support ticket waiting to happen.
    delta: (remainder === 0 ? 0 : -remainder) as Paisa,
  };
}
