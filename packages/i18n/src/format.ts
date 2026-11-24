/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * Formatting money, numbers, dates and durations for Bangladesh.
 *
 * Every function here takes integer paisa and a locale, and none of them ever
 * sees a float: the money formatting delegates to `@undal/money`, which is the
 * same implementation the Worker and the invoices use. That is what keeps a
 * cart total on a phone, a line in a Bengali invoice and a CSV export agreeing
 * to the paisa.
 */

import { groupBdt, type Paisa } from "@undal/money";

import type { Locale } from "./message.ts";

/** The ten Bengali digits, in order, so `toBengaliDigits` is a table rather than a range guess. */
const BENGALI_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"] as const;

/** The platform's timezone. Every timestamp in Undal is UTC stored, Dhaka displayed. */
export const TIMEZONE = "Asia/Dhaka";

/**
 * Rewrite ASCII digits as Bengali digits.
 *
 * Order codes, phone numbers and transaction IDs are never passed through this — a
 * bKash TrxID is read aloud to a call centre, and `২৩৪` is not what the operator is
 * looking at. Money, counts and dates are.
 */
export function toBengaliDigits(value: string): string {
  return value.replace(/[0-9]/gu, (digit) => BENGALI_DIGITS[Number(digit)] as string);
}

/** Which numeral system a locale shows by default. Bangla defaults to Latin digits; the setting is per user. */
export type Numerals = "latin" | "bengali";

/** How an amount should be rendered. */
export interface MoneyOptions {
  /** Include the ৳ mark and the thin space. Off for a column that has a header. */
  readonly symbol?: boolean;
  /** Override the locale default; `bn` renders Latin digits unless asked otherwise. */
  readonly numerals?: Numerals;
  /** Show `paise` (two decimals). Off for a whole-taka summary tile that says so. */
  readonly decimals?: boolean;
}

/**
 * Format an amount of paisa as taka.
 *
 * Grouping is lakh/crore (`1,00,000.00`), never Western thousands, because that is how
 * a Bangladeshi reads a price. The symbol precedes the amount with a thin space, which
 * is the typography the invoice and the storefront share.
 */
export function formatMoney(amountPaisa: Paisa | number, locale: Locale, options: MoneyOptions = {}): string {
  const grouped = groupBdt(amountPaisa);
  let text = grouped.amount;
  if (options.decimals === false) {
    text = text.replace(/\.00$/u, "");
  }
  const numerals = options.numerals ?? "latin";
  if (numerals === "bengali") text = toBengaliDigits(text);
  if (options.symbol === false) return text;
  const symbol = `৳\u2009`;
  if (grouped.negative) return `−${symbol}${text.replace("−", "")}`;
  return `${symbol}${text}`;
}

/** Format a plain count with the locale's grouping, in the requested numerals. */
export function formatNumber(value: number, locale: Locale, numerals: Numerals = "latin"): string {
  const formatted = new Intl.NumberFormat(locale === "bn" ? "bn-BD" : "en-GB").format(value);
  return numerals === "bengali" ? toBengaliDigits(formatted) : formatted;
}

/** How a date should be shown: a clock time, a day, or both. */
export type DateStyle = "time" | "day" | "dayTime" | "full";

/**
 * Format a timestamp for a human in Asia/Dhaka.
 *
 * Ordering is always done on the UTC string from the server; this is the last step before
 * pixels, and it never feeds a comparison. An unparseable value renders as an em dash
 * rather than `Invalid Date`, because a receipt with `Invalid Date` on it looks like a
 * system that lost the order.
 */
export function formatDateTime(iso: string | null | undefined, locale: Locale, style: DateStyle = "dayTime"): string {
  if (iso === null || iso === undefined || iso === "") return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const tag = locale === "bn" ? "bn-BD" : "en-GB";
  const options: Intl.DateTimeFormatOptions =
    style === "time"
      ? { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TIMEZONE }
      : style === "day"
        ? { day: "numeric", month: "short", year: "numeric", timeZone: TIMEZONE }
        : style === "full"
          ? { weekday: "short", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: TIMEZONE }
          : { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: TIMEZONE };
  return new Intl.DateTimeFormat(tag, options).format(date);
}

/**
 * A short, human interval: `2m ago`, `in 3h`.
 *
 * Used for position age, order age and pending cash, where the exact clock time is less
 * useful than "how long has this been sitting". Rounding is deliberately coarse — a
 * support agent sorting by age does not need seconds on a number that has just changed.
 */
export function formatRelative(iso: string, locale: Locale, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.round((then - now.getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale === "bn" ? "bn-BD" : "en-GB", { numeric: "auto" });
  const steps: readonly [Intl.RelativeTimeFormatUnit, number][] = [
    ["second", 60],
    ["minute", 60],
    ["hour", 24],
    ["day", 7],
    ["week", 4.345],
    ["month", 12],
  ];
  let value = seconds;
  for (const [unit, span] of steps) {
    if (Math.abs(value) < span) return formatter.format(Math.round(value), unit);
    value /= span;
  }
  return formatter.format(Math.round(value), "year");
}

/** Minutes as a short duration: `18 min`, `1 h 5 min`. */
export function formatMinutes(minutes: number, locale: Locale): string {
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded < 60) return locale === "bn" ? `${toBengaliDigits(String(rounded))} মিনিট` : `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (locale === "bn") {
    return rest === 0
      ? `${toBengaliDigits(String(hours))} ঘণ্টা`
      : `${toBengaliDigits(String(hours))} ঘণ্টা ${toBengaliDigits(String(rest))} মিনিট`;
  }
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Distance in metres as a short string: `850 m`, `1.2 km`. */
export function formatDistance(metres: number, locale: Locale): string {
  if (metres < 1000) {
    const value = Math.round(metres);
    return locale === "bn" ? `${toBengaliDigits(String(value))} মি` : `${value} m`;
  }
  const kilometres = Math.round(metres / 100) / 10;
  const text = kilometres.toFixed(1);
  return locale === "bn" ? `${toBengaliDigits(text)} কিমি` : `${text} km`;
}
