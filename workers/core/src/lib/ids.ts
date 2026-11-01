/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { uuidv7, type UuidBytes } from "@undal/contracts";

/** Bytes of entropy behind an opaque token: 256 bits, the number the session spec names. */
export const OPAQUE_TOKEN_BYTES = 32;

/**
 * A new primary key, as the 16 bytes the schema stores.
 *
 * UUIDv7 rather than v4 because the first 48 bits are a millisecond timestamp, so
 * inserts land at the end of the index instead of scattering across it — the
 * difference between a warm B-tree and a page fault per insert on a table that
 * takes a row per order event.
 */
export function newId(nowMs: number = Date.now()): UuidBytes {
  return uuidv7(nowMs);
}

/** Bytes to the canonical lowercase UUID string, for URLs and logs. */
export function toHexId(bytes: Uint8Array): string {
  const hex: string[] = [];
  for (const byte of bytes)
    hex.push(byte.toString(16).padStart(2, "0"));
  return hex.join("");
}

/**
 * A fresh opaque token, base64url so it survives a header and a URL alike.
 *
 * Refresh tokens and password-reset tokens are never stored: only the SHA-256 of
 * this value is persisted, so a database dump cannot be replayed as a session.
 */
export function opaqueToken(bytes: number = OPAQUE_TOKEN_BYTES): string {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of buffer)
    binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

/**
 * SHA-256 of a string or bytes, as 32 bytes.
 *
 * Used for token hashes, payload digests and the audit chain. Web Crypto is the
 * only digest available in a Worker, and it is the one every other implementation
 * of this platform must agree with — the Python scripts hash the same bytes.
 */
export async function sha256(input: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return new Uint8Array(digest);
}

/** SHA-256 as lowercase hex, for artefacts and log lines a human reads. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  return toHexId(await sha256(input));
}

/**
 * Compare two byte strings without leaking where they differ.
 *
 * A token check is an oracle if it returns early on the first mismatched byte; the
 * timing difference is small but free to remove.
 */
export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

/** Concatenate byte strings, which the audit chain needs and `Uint8Array` lacks. */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}
