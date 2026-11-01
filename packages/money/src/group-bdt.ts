/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Paisa } from "./paisa.ts";

/** A formatted amount and the parts a caller may need to style separately. */
export interface GroupedBdt {
  /** `1,00,000.00` — lakh/crore grouping, never Western thousands. */
  readonly amount: string;
  /** `৳ 1,00,000.00` — symbol, thin space, amount. */
  readonly withSymbol: string;
  readonly negative: boolean;
}

const THIN_SPACE = "\u2009";

/**
 * Format paisa as Bangladeshi taka: last three digits, then pairs.
 *
 * ICU's `en-IN`/`bn-BD` implement this, but ICU versions differ between Android
 * releases, and an invoice that groups differently depending on the phone that
 * renders it is not an invoice. So the grouping is implemented here, tested
 * against 5 000 values including every boundary at 10³, 10⁵, 10⁷ and 10⁹, and
 * mirrored in Kotlin and Python.
 *
 * Decimals are always two, always shown: `৳320.00`, never `৳320`, because a
 * column of money with a varying number of decimals cannot be scanned.
 */
export function groupBdt(amountPaisa: Paisa | number): GroupedBdt {
  if (!Number.isSafeInteger(amountPaisa)) {
    throw new RangeError(`groupBdt: expected integer paisa, got ${amountPaisa}`);
  }

  const negative = amountPaisa < 0;
  const magnitude = Math.abs(amountPaisa);
  const taka = Math.floor(magnitude / 100);
  const sub = magnitude % 100;

  const digits = taka.toString();
  let grouped: string;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    const head = digits.slice(0, -3);
    const tail = digits.slice(-3);
    const pairs: string[] = [];
    for (let end = head.length; end > 0; end -= 2) {
      pairs.unshift(head.slice(Math.max(0, end - 2), end));
    }
    grouped = `${pairs.join(",")},${tail}`;
  }

  const amount = `${negative ? "−" : ""}${grouped}.${sub.toString().padStart(2, "0")}`;
  return {
    amount,
    withSymbol: `${negative ? "−" : ""}৳${THIN_SPACE}${grouped}.${sub.toString().padStart(2, "0")}`,
    negative,
  };
}

/**
 * The machine-readable form used in API payloads, CSV exports and the bKash
 * file: `BDT 549.00`. Never `Tk`, which is a transliteration rather than the
 * currency, and never the symbol, because a fixed-width file has no room for a
 * thin space or a Bengali digit.
 */
export function machineBdt(amountPaisa: Paisa | number): string {
  const { amount } = groupBdt(amountPaisa);
  return `BDT ${amount.replace("−", "-").replace(/,/g, "")}`;
}
