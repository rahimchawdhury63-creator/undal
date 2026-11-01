/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { fail, ok, type Result } from "../lib/result.ts";

/**
 * TOTP, RFC 6238, with the choices the specification makes for compatibility rather
 * than for strength: SHA-1, six digits, thirty-second steps, ±1 step of drift.
 *
 * SHA-1 is not a mistake here. Every authenticator app in Bangladesh — Google
 * Authenticator, Authy, the one Xiaomi ships — speaks SHA-1 at six digits, and a
 * stronger hash would lock out the admins this control protects. The secret is what
 * matters, and it is encrypted at rest with a key that never reaches the database.
 */

/** Digits in a code. */
export const TOTP_DIGITS = 6;
/** Seconds per step. */
export const TOTP_STEP_SECONDS = 30;
/** Steps of drift accepted in either direction. */
export const TOTP_DRIFT_STEPS = 1;

/** The alphabet RFC 4648 base32 uses for authenticator secrets. */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Encode bytes as base32 without padding, the form authenticator apps expect. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/** Decode base32, ignoring spaces and the padding users paste in. */
export function base32Decode(input: string): Uint8Array {
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/gu, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of cleaned) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

/** A new 160-bit secret, base32-encoded, which is what `totp_secrets` stores encrypted. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

/** The counter for a moment: whole steps since the epoch. */
export function stepAt(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/** The HMAC-SHA-1 of a counter, which is the raw material of a code. */
async function hotp(secret: Uint8Array, counter: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", secret as unknown as ArrayBuffer, { name: "HMAC", hash: "SHA-1" }, false, [
    "sign",
  ]);
  const message = new Uint8Array(8);
  let remaining = counter;
  for (let index = 7; index >= 0; index -= 1) {
    message[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
}

/** The six-digit code for a counter, by RFC 4226's dynamic truncation. */
export async function codeForStep(secretBase32: string, counter: number): Promise<string> {
  const digest = await hotp(base32Decode(secretBase32), counter);
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/** The code a user would type right now. Used by the enrolment screen's preview. */
export async function currentCode(secretBase32: string, nowMs: number = Date.now()): Promise<string> {
  return codeForStep(secretBase32, stepAt(nowMs));
}

/**
 * Verify a submitted code, returning the step it matched.
 *
 * Returning the step rather than a boolean is what makes replay refusal possible: the
 * caller compares it with `totp_secrets.last_used_step` and refuses anything at or
 * below it, so a code captured from a shoulder-surfed screen cannot be reused inside
 * its thirty-second window.
 */
export async function verifyCode(
  submitted: string,
  secretBase32: string,
  options: { nowMs?: number; lastUsedStep?: number } = {},
): Promise<Result<number>> {
  const digits = submitted.replace(/\s/gu, "");
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`, "u").test(digits)) return fail("AUTH_TOTP_INVALID");
  const nowStep = stepAt(options.nowMs ?? Date.now());
  for (let drift = -TOTP_DRIFT_STEPS; drift <= TOTP_DRIFT_STEPS; drift += 1) {
    const step = nowStep + drift;
    if (options.lastUsedStep !== undefined && step <= options.lastUsedStep) continue;
    if ((await codeForStep(secretBase32, step)) === digits) return ok(step);
  }
  return fail("AUTH_TOTP_INVALID");
}

/** The `otpauth://` URI an authenticator app scans, with the issuer locked to Undal. */
export function otpauthUri(secretBase32: string, accountLabel: string, issuer = "Undal"): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const parameters = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${parameters.toString()}`;
}
