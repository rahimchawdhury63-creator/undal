/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The string catalogues.
 *
 * Two files, one key set, checked key-for-key by the `i18n-completeness` guardrail and
 * again by this package's test suite. A key that exists in English and not in Bengali is
 * an English sentence shown to a customer in Sylhet at the moment something went wrong,
 * which is why the check is mechanical rather than editorial.
 */

import bn from "../locales/bn.json" with { type: "json" };
import en from "../locales/en.json" with { type: "json" };

import type { Locale } from "./message.ts";

/** Every message key the platform ships, derived from the English catalogue so a typo is a compile error. */
export type MessageKey = keyof typeof en;

/** The catalogues, keyed by locale. `bn` is complete rather than a fallback chain. */
export const CATALOGUES: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = {
  en,
  bn,
};

/** The locales this build ships. Order matters: the first is the default for a new visitor in Bangladesh. */
export const LOCALES: readonly Locale[] = ["bn", "en"] as const;

/** True when a string names a locale this build actually ships a catalogue for. */
export function isLocale(value: string | null | undefined): value is Locale {
  return value === "bn" || value === "en";
}

/** The other locale, for the language toggle: one tap, one alternative, no menu. */
export function otherLocale(locale: Locale): Locale {
  return locale === "bn" ? "en" : "bn";
}
