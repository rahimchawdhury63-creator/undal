/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Symmetric encryption for the few secrets that must be readable again: TOTP seeds,
 * OAuth refresh tokens, bank account numbers.
 *
 * A hash is not enough for these — the server has to produce the TOTP code itself, so
 * the plaintext has to come back — and AES-256-GCM gives that with an authentication
 * tag, so a modified ciphertext fails to open instead of decrypting into a different
 * seed that silently produces wrong codes.
 */

/** Prefix on every stored value, so a later format can be detected rather than guessed. */
const VERSION = "v1";

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

/**
 * Import the raw 32-byte key a secret holds.
 *
 * The key must be exactly 32 bytes: a shorter key would be padded by some runtimes and
 * rejected by others, and a configuration that works in one environment and not the
 * next is worse than one that fails at load.
 */
export async function importBoxKey(secret: string): Promise<CryptoKey> {
  const raw = decodeBase64Url(secret);
  if (raw.length !== 32) throw new Error(`encryption key must be 32 bytes, got ${raw.length}`);
  return crypto.subtle.importKey("raw", raw as unknown as ArrayBuffer, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/**
 * Encrypt UTF-8 text into `v1.<iv>.<ciphertext>`.
 *
 * The IV is random per call, which is why the tag can be a single fixed-length field:
 * a repeated IV with the same key is the one mistake GCM does not survive, and a
 * counter is impossible across isolated Worker instances.
 */
export async function seal(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as unknown as ArrayBuffer }, key, new TextEncoder().encode(plaintext)),
  );
  return `${VERSION}.${encodeBase64Url(iv)}.${encodeBase64Url(ciphertext)}`;
}

/** Decrypt a sealed value, returning `null` when the tag does not verify. */
export async function open(key: CryptoKey, sealed: string): Promise<string | null> {
  const parts = sealed.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, ivPart, bodyPart] = parts as [string, string, string];
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decodeBase64Url(ivPart) as unknown as ArrayBuffer },
      key,
      decodeBase64Url(bodyPart) as unknown as ArrayBuffer,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}
