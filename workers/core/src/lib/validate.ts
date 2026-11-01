/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { fail, ok, type Result } from "./result.ts";

/** Bangladeshi mobile numbers are eleven digits starting `01`. */
const BD_LOCAL_MOBILE = /^01[3-9]\d{8}$/u;
/** The same number with the country code, the only form the database stores. */
const BD_E164 = /^\+8801[3-9]\d{8}$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;

/** Digits only, so `+880 1712-345678` and its punctuation cannot create two accounts. */
function digits(value: string): string {
  return value.replace(/[^0-9]/gu, "");
}

/**
 * A phone number in E.164, which is the only form stored or compared.
 *
 * Bangladesh numbers arrive as `01712345678`, `+8801712345678`, `8801712345678`
 * or with spaces and dashes. Normalising here — rather than at the database, which
 * cannot — is what makes the unique index on `phone_norm` mean "one person".
 */
export function normalisePhone(input: string): Result<string> {
  const raw = input.trim();
  const plain = digits(raw);
  if (raw.startsWith("+")) {
    return BD_E164.test(`+${plain}`) ? ok(`+${plain}`) : fail("VALIDATION_PHONE_INVALID", { field: "phone" });
  }
  if (BD_E164.test(`+${plain}`)) return ok(`+${plain}`);
  if (plain.startsWith("880") && BD_LOCAL_MOBILE.test(`0${plain.slice(3)}`)) return ok(`+${plain}`);
  if (BD_LOCAL_MOBILE.test(plain)) return ok(`+880${plain.slice(1)}`);
  return fail("VALIDATION_PHONE_INVALID", { field: "phone" });
}

/** A phone number as a human in Dhaka writes it: `01712-345678`. */
export function displayPhone(e164: string): string {
  const plain = digits(e164);
  return plain.length === 13 ? `0${plain.slice(3)}` : e164;
}

/**
 * An email, lowercased but with dots preserved.
 *
 * Gmail treats `a.b@x.com` as `ab@x.com`; every other provider does not, and
 * stripping dots merges two different people's accounts the first time a customer
 * registers with a company address that happens to contain one.
 */
export function normaliseEmail(input: string): Result<string> {
  const value = input.trim().toLowerCase();
  if (value.length > 254 || !EMAIL.test(value)) return fail("VALIDATION_EMAIL_INVALID", { field: "email" });
  return ok(value);
}

/**
 * A trimmed, length-checked string that is not whitespace.
 *
 * `false` on a form field is the most common way an empty value reaches a NOT NULL
 * column, and the database's complaint is far less useful than a field name.
 */
export function requiredText(input: unknown, field: string, maxLength: number, minLength = 1): Result<string> {
  if (typeof input !== "string") return fail("VALIDATION_REQUIRED", { field });
  const value = input.trim();
  if (value.length < minLength) return fail("VALIDATION_REQUIRED", { field });
  if (value.length > maxLength) return fail("VALIDATION_TOO_LONG", { field, details: { maxLength } });
  return ok(value);
}

/**
 * An integer number of paisa.
 *
 * The money law is integer-only, so a float that arrives through JSON — `0.1 + 0.2`
 * is already wrong before it is parsed — is refused rather than rounded.
 */
export function paisaAmount(input: unknown, field: string): Result<number> {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 0)
    return fail("VALIDATION_RANGE", { field, details: { reason: "paisa must be a non-negative safe integer" } });
  return ok(input);
}

/** One of a fixed set of strings, which is what every enum column in the schema is. */
export function oneOf<T extends string>(input: unknown, allowed: readonly T[], field: string): Result<T> {
  if (typeof input !== "string" || !allowed.includes(input as T))
    return fail("VALIDATION_ENUM", { field, details: { allowed: [...allowed] } });
  return ok(input as T);
}

/** A query-string integer within bounds, with a default when absent. */
export function boundedInt(input: string | null, fallback: number, min: number, max: number): number {
  if (input === null || input.trim() === "") return fallback;
  const value = Number(input);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
