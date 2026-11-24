/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { argon2id, argon2Verify } from "hash-wasm";

/**
 * Password hashing: Argon2id, the parameters OWASP publishes for an interactive login.
 *
 * `m=19456 KiB, t=2, p=1` costs about 50 ms on a laptop and rather more on a phone
 * whose hash runs in the Worker, which is the point: the parameters are chosen so that
 * a database dump is expensive to attack rather than so that login is instant. WASM
 * rather than pure JavaScript because a hand-written Argon2 in JS is both slower and a
 * second implementation of a primitive nobody should reimplement.
 */

/** Memory in kibibytes, per the specification. */
export const ARGON2_MEMORY_KIB = 19_456;
/** Iterations. */
export const ARGON2_ITERATIONS = 2;
/** Lanes; single-threaded because a Worker cannot usefully parallelise it. */
export const ARGON2_PARALLELISM = 1;
/** Salt length in bytes. */
export const SALT_BYTES = 16;
/** Output length in bytes. */
export const HASH_BYTES = 32;

/**
 * Hash a password into the PHC string the `users.password_hash` column stores.
 *
 * The string carries its own parameters, which is what makes a rehash-on-login upgrade
 * possible later: the verifier reads the cost from the hash, not from this module.
 */
export async function hashPassword(password: string, salt?: Uint8Array): Promise<string> {
  const actualSalt = salt ?? crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return argon2id({
    password,
    salt: actualSalt,
    parallelism: ARGON2_PARALLELISM,
    iterations: ARGON2_ITERATIONS,
    memorySize: ARGON2_MEMORY_KIB,
    hashLength: HASH_BYTES,
    outputType: "encoded",
  });
}

/**
 * Check a password against a stored PHC string.
 *
 * A stored value that is not a PHC Argon2 hash — an empty column on an OAuth-only
 * account, or a row written by an older scheme — returns `false` rather than throwing:
 * the caller's answer is the same either way, and an exception here would turn a
 * wrong password into a 500.
 */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (stored === null || !stored.startsWith("$argon2id$")) return false;
  try {
    return await argon2Verify({ password, hash: stored });
  } catch {
    return false;
  }
}

/**
 * Whether a stored hash was produced with weaker parameters than the current policy.
 *
 * Called on every successful login so that raising the cost re-hashes the accounts
 * that actually sign in, instead of needing a migration that cannot compute hashes.
 */
export function needsRehash(stored: string): boolean {
  if (!stored.startsWith("$argon2id$")) return true;
  const parameters = /\$m=(\d+),t=(\d+),p=(\d+)\$/u.exec(stored);
  if (parameters === null) return true;
  const [, memory, iterations, parallelism] = parameters;
  return (
    Number(memory) < ARGON2_MEMORY_KIB ||
    Number(iterations) < ARGON2_ITERATIONS ||
    Number(parallelism) !== ARGON2_PARALLELISM
  );
}
