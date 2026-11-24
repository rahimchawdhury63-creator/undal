/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The platform's clock, in one place.
 *
 * Every timestamp the database stores is UTC in a `DATETIME(6)` column, and every
 * timestamp a human reads is Asia/Dhaka. Both facts are true at once, and the only
 * way they stay true is if formatting happens here and nowhere else: a stray
 * `toLocaleString()` in a route is how a 23:59 order becomes tomorrow's revenue.
 */

/** The zone every user-facing time is expressed in. */
export const BUSINESS_TIME_ZONE = "Asia/Dhaka";

/** Offset in minutes of Asia/Dhaka, which has had no DST since 2009. */
export const BUSINESS_UTC_OFFSET_MINUTES = 360;

const SQL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/u;

/**
 * A `Date` as the string TiDB expects in a `DATETIME(6)` column.
 *
 * `toISOString()` would be accepted by some engines and silently truncated by
 * others, and the microseconds are load-bearing in an audit chain: two events in
 * the same millisecond still have to order.
 */
export function toSqlDateTime(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 23)}000`;
}

/** Parse the string form back, treating it as UTC because the column is UTC. */
export function fromSqlDateTime(value: string): Date {
  const match = SQL_DATETIME.exec(value);
  if (match === null) throw new RangeError(`not a DATETIME(6) value: ${value}`);
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  const milliseconds = Number((fraction + "000").slice(0, 3));
  return new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), milliseconds),
  );
}

/** A moment `minutes` from now, for session and token expiries. */
export function inMinutes(minutes: number, from: number = Date.now()): Date {
  return new Date(from + minutes * 60_000);
}

/** A moment `days` from now, for retention windows. */
export function inDays(days: number, from: number = Date.now()): Date {
  return new Date(from + days * 86_400_000);
}

/** Whether a stored expiry has passed. An unparseable value counts as expired. */
export function isExpired(expiresAt: string | Date, nowMs: number = Date.now()): boolean {
  const moment = expiresAt instanceof Date ? expiresAt.getTime() : fromSqlDateTime(expiresAt).getTime();
  return !Number.isFinite(moment) || moment <= nowMs;
}

/** The Dhaka calendar date of a moment, `YYYY-MM-DD`. */
export function businessDate(atMs: number = Date.now()): string {
  const shifted = new Date(atMs + BUSINESS_UTC_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** The Dhaka wall-clock time of a moment, `HH:MM`, for message bodies. */
export function businessClock(atMs: number = Date.now()): string {
  const shifted = new Date(atMs + BUSINESS_UTC_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(11, 16);
}

/**
 * Start of the Dhaka business day, as a UTC instant.
 *
 * Payout periods, daily stats and "today's orders" all cut on Dhaka midnight, and
 * a UTC cut would attribute a 04:00 Dhaka order to the previous day.
 */
export function businessDayStart(atMs: number = Date.now()): Date {
  const dateStartMs = Date.parse(`${businessDate(atMs)}T00:00:00.000Z`);
  return new Date(dateStartMs - BUSINESS_UTC_OFFSET_MINUTES * 60_000);
}
