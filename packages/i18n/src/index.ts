/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The translator.
 *
 * One function builds everything a surface needs to speak Bengali or English: message
 * lookup, pluralisation, money, numbers, dates and error copy. It is deliberately a plain
 * object rather than a React context or a global singleton, so the same call renders a
 * pre-rendered Bengali page at build time, an English page in a browser, and a test
 * without either.
 */

import { ERRORS, type ErrorCode } from "@undal/contracts";

import { CATALOGUES, LOCALES, isLocale, otherLocale, type MessageKey } from "./catalogue.ts";
import {
  formatDateTime,
  formatDistance,
  formatMinutes,
  formatMoney,
  formatNumber,
  formatRelative,
  toBengaliDigits,
  type DateStyle,
  type MoneyOptions,
  type Numerals,
} from "./format.ts";
import { formatMessage, type Locale, type MessageArgs } from "./message.ts";

export { CATALOGUES, LOCALES, isLocale, otherLocale, type Locale, type MessageKey };
export {
  TIMEZONE,
  formatDateTime,
  formatDistance,
  formatMinutes,
  formatMoney,
  formatNumber,
  formatRelative,
  toBengaliDigits,
  type DateStyle,
  type MoneyOptions,
  type Numerals,
} from "./format.ts";
export { formatMessage, MessageFormatError, type MessageArgs } from "./message.ts";

/** The translator every surface receives instead of importing a locale file directly. */
export interface Translator {
  /** The active locale. */
  readonly locale: Locale;
  /** A message by key, with ICU arguments. A missing key renders its own name so it is visible in review. */
  t(key: MessageKey, args?: MessageArgs): string;
  /** Integer paisa as taka, lakh-grouped, with the ৳ mark. */
  money(amountPaisa: number, options?: MoneyOptions): string;
  /** A count with locale grouping. */
  number(value: number, numerals?: Numerals): string;
  /** A timestamp in Asia/Dhaka. */
  dateTime(iso: string | null | undefined, style?: DateStyle): string;
  /** A coarse interval: "2m ago", "in 3h". */
  relative(iso: string, now?: Date): string;
  /** Minutes as a short duration. */
  minutes(value: number): string;
  /** Metres as a short distance. */
  distance(metres: number): string;
  /**
   * The registry's copy for an error code, in this locale.
   *
   * Client copy comes from `@undal/contracts` rather than the catalogue because the server
   * and the client must agree on what a code means; a handler returning `ORDER_NOT_FOUND`
   * and a page explaining it are reading the same row (D33).
   */
  errorMessage(code: string): string;
}

/** Build a translator for one locale. */
export function createTranslator(locale: Locale): Translator {
  const catalogue = CATALOGUES[locale];
  return {
    locale,
    t(key, args) {
      const pattern = catalogue[key];
      if (pattern === undefined) return String(key);
      return formatMessage(pattern, locale, args);
    },
    money(amountPaisa, options) {
      return formatMoney(amountPaisa, locale, options);
    },
    number(value, numerals) {
      return formatNumber(value, locale, numerals);
    },
    dateTime(iso, style) {
      return formatDateTime(iso, locale, style);
    },
    relative(iso, now) {
      return formatRelative(iso, locale, now);
    },
    minutes(value) {
      return formatMinutes(value, locale);
    },
    distance(metres) {
      return formatDistance(metres, locale);
    },
    errorMessage(code) {
      const row = ERRORS[code as ErrorCode];
      if (row === undefined) return CATALOGUES[locale]["state.error.body"];
      return locale === "bn" ? row.bn : row.en;
    },
  };
}

/**
 * Which language a tag belongs to, as a sort key for tie-breaking.
 *
 * Bangla is `0` rather than `1` so that an equal-quality header resolves to the language of
 * the country the platform serves.
 */
function rank(tag: string): number {
  if (tag.startsWith("bn")) return 0;
  if (tag.startsWith("en")) return 1;
  return 2;
}

/**
 * The locale a request or a browser prefers, from an `Accept-Language` string.
 *
 * Bangla wins a tie and wins over English, because this is a Bangladeshi product: a
 * browser sending `en-US, en;q=0.9, bn;q=0.8` is more often a phone with an English system
 * setting than an English speaker, and the toggle is one tap away either way.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return "bn";
  const ranked = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...parameters] = part.trim().split(";");
      const quality = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith("q="));
      return { tag: (tag ?? "").trim().toLowerCase(), quality: quality === undefined ? 1 : Number(quality.slice(2)) };
    })
    .filter((entry) => entry.tag !== "")
    // A tie goes to Bangla: the q-values in a Bangladeshi browser's header are usually an
    // artefact of an English system setting, not a preference.
    .sort((a, b) => b.quality - a.quality || rank(a.tag) - rank(b.tag));
  for (const entry of ranked) {
    if (entry.tag.startsWith("bn")) return "bn";
    if (entry.tag.startsWith("en")) return "en";
  }
  return "bn";
}
