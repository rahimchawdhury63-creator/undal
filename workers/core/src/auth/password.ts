/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { dictionary } from "@zxcvbn-ts/language-common";

import { fail, ok, type Result } from "../lib/result.ts";

/**
 * Password policy, and the 10 000-entry list the specification requires.
 *
 * The list is the first 10 000 entries of the language-common password dictionary — a
 * real corpus of breached and guessable passwords in frequency order — rather than a
 * hand-typed list of twenty obvious ones. Checking membership in a 10 000-word set is a
 * Set lookup, so the policy stays a few microseconds; guessing a password from that
 * set is what an attacker does first, so refusing them removes the cheapest attack.
 */

/** The blocklisted passwords, truncated to the documented ten thousand. */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set(
  (dictionary.passwords as readonly string[]).slice(0, 10_000).map((entry) => entry.toLowerCase()),
);

/** How many entries the blocklist holds; asserted by the policy tests. */
export const BLOCKLIST_SIZE = 10_000;

/** The shortest acceptable password. */
export const MIN_LENGTH = 10;
/** The longest accepted, which also bounds Argon2's input. */
export const MAX_LENGTH = 128;

/** What the policy knew about the person when it judged the password. */
export interface PasswordHints {
  readonly phone?: string;
  readonly email?: string;
  readonly name?: string;
}

/**
 * Whether a password is acceptable, with the reason when it is not.
 *
 * Length is checked first because it is the only rule that genuinely matters, and the
 * character-class rule is deliberately "two kinds" rather than "one of each": requiring
 * a symbol pushes people to `Password1!`, which is in every blocklist ever published.
 */
export function checkPasswordPolicy(password: string, hints: PasswordHints = {}): Result<string> {
  if (password.length < MIN_LENGTH) return fail("AUTH_PASSWORD_WEAK", { field: "password", details: { minLength: MIN_LENGTH } });
  if (password.length > MAX_LENGTH) return fail("VALIDATION_TOO_LONG", { field: "password", details: { maxLength: MAX_LENGTH } });

  const lowered = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lowered)) return fail("AUTH_PASSWORD_WEAK", { field: "password", details: { reason: "common" } });
  if (isRepetitive(lowered)) return fail("AUTH_PASSWORD_WEAK", { field: "password", details: { reason: "repetitive" } });

  const personal = [hints.phone, hints.email, hints.name]
    .filter((value): value is string => typeof value === "string" && value.length >= 4)
    .map((value) => value.toLowerCase().replace(/[^a-z0-9]/gu, ""));
  const compact = lowered.replace(/[^a-z0-9]/gu, "");
  if (personal.some((value) => compact.includes(value)))
    return fail("AUTH_PASSWORD_WEAK", { field: "password", details: { reason: "personal" } });

  if (characterClasses(password) < 2)
    return fail("AUTH_PASSWORD_WEAK", { field: "password", details: { reason: "classes" } });

  return ok(password);
}

/** How many of lower, upper, digit and symbol appear. */
function characterClasses(password: string): number {
  let classes = 0;
  if (/[a-z]/u.test(password)) classes += 1;
  if (/[A-Z]/u.test(password)) classes += 1;
  if (/[0-9]/u.test(password)) classes += 1;
  if (/[^A-Za-z0-9]/u.test(password)) classes += 1;
  return classes;
}

/** Three or more identical characters in a row, or a single character repeated. */
function isRepetitive(lowered: string): boolean {
  return /(.)\1{2,}/u.test(lowered) || new Set(lowered).size <= 3;
}

/**
 * Whether a new password reuses one of the last N hashes.
 *
 * The hashes are compared with the same verifier the login uses, so the check works
 * against rows written by any past parameter set.
 */
export async function reusesHistory(
  password: string,
  history: readonly string[],
  verify: (password: string, stored: string) => Promise<boolean>,
): Promise<boolean> {
  for (const stored of history) {
    if (await verify(password, stored)) return true;
  }
  return false;
}
