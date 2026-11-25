/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * Money, rendered once, correctly.
 *
 * Amounts arrive as integer paisa and leave as a formatted string from the translator, which is
 * the same implementation the invoice uses. The component exists so that no screen has to decide
 * where the ৳ goes, whether to show decimals, or whether the locale prefers Bengali digits.
 */

import type { ReactNode } from "react";

import { useLocale, useT } from "../lib/locale.tsx";

/** A formatted amount, with tabular figures and an optional size token. */
export function Money({
  paisa,
  size = "md",
  symbol = true,
  className,
}: {
  readonly paisa: number;
  readonly size?: "sm" | "md" | "lg" | "xl";
  readonly symbol?: boolean;
  readonly className?: string;
}): ReactNode {
  const t = useT();
  const locale = useLocale();
  const numerals = locale === "bn" ? "bengali" : "latin";
  const sizeClass = size === "sm" ? "undal-money-sm" : size === "lg" ? "undal-money-lg" : size === "xl" ? "undal-money-xl" : "";
  return (
    <span className={["undal-money", sizeClass, className ?? ""].filter(Boolean).join(" ")}>
      {t.money(paisa, { symbol, numerals })}
    </span>
  );
}
