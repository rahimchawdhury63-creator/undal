/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * A language Undal speaks. Bangla first because Bangladesh is the market and
 * `bn` is the default; English is a first-class second, never a fallback that
 * was bolted on.
 */
export type Locale = "bn" | "en";

/** What an absent or unrecognised `Accept-Language` resolves to. */
export const DEFAULT_LOCALE: Locale = "bn";

/**
 * Parse an `Accept-Language` header into the one locale we serve.
 *
 * Deliberately not a full RFC 4647 matcher: Undal supports exactly two
 * languages, so the honest algorithm is "first supported tag in q-order, else
 * Bangla". Implementing the full matcher would add branches nobody can test
 * with real traffic.
 */
export function parseAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) {
    return DEFAULT_LOCALE;
  }

  const candidates = header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const quality = params
        .map((param) => param.trim())
        .find((param) => param.startsWith("q=") || param.startsWith("Q="));
      const q = quality === undefined ? 1 : Number.parseFloat(quality.slice(2));
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((candidate) => candidate.tag.length > 0 && candidate.q > 0)
    .sort((left, right) => right.q - left.q);

  for (const candidate of candidates) {
    if (candidate.tag === "bn" || candidate.tag.startsWith("bn-")) {
      return "bn";
    }
    if (candidate.tag === "en" || candidate.tag.startsWith("en-")) {
      return "en";
    }
  }
  return DEFAULT_LOCALE;
}

/**
 * Choose the copy for a locale.
 *
 * A single function so that "which language is this string in" has one answer
 * everywhere — screen, push notification, invoice and SMS use the same rule.
 * The Bangla string is required, so there is no path that silently returns
 * English because a translator had not reached that key.
 */
export function pickLocalized(en: string, bn: string, locale: Locale): string {
  return locale === "en" ? en : bn;
}
