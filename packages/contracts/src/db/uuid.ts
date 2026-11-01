/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * UUIDv7 as the database stores it: sixteen bytes, big-endian.
 *
 * Why v7 rather than v4: every primary key in this platform is a `BINARY(16)`
 * that doubles as the row's insertion order. A v7 key sorts by time, so an index
 * on `(id)` is also an index on "when", which is what makes keyset pagination on
 * orders cheap and what stops a random v4 key from scattering writes across the
 * whole B-tree.
 */
export type UuidBytes = Uint8Array;

/** How many bytes a UUID occupies in `BINARY(16)`. */
export const UUID_BYTES = 16;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse the canonical text form into bytes, rejecting anything that is not a
 * UUID rather than silently zero-filling — an all-zero key is a valid key, and
 * quietly turning a typo into one would attach a row to the sentinel global.
 */
export function uuidToBin(uuid: string): UuidBytes {
  if (!UUID_PATTERN.test(uuid)) {
    throw new RangeError(`not a UUID: ${uuid}`);
  }
  const hex = uuid.replace(/-/g, "");
  const bytes = new Uint8Array(UUID_BYTES);
  for (let index = 0; index < UUID_BYTES; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** Render bytes back into the canonical lower-case text form. */
export function binToUuid(bytes: UuidBytes): string {
  if (bytes.length !== UUID_BYTES) {
    throw new RangeError(`expected ${UUID_BYTES} bytes, got ${bytes.length}`);
  }
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** True when the string is a canonical UUID. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * Mint a UUIDv7 for a given millisecond and a source of random bytes.
 *
 * The clock and the randomness are parameters because a key generator that can
 * only be called with the real clock cannot be tested for ordering, and because
 * the Brain and the Worker must produce the same layout from different runtimes.
 */
export function uuidv7(
  nowMs: number = Date.now(),
  random: (target: Uint8Array) => Uint8Array = (target) => crypto.getRandomValues(target),
): UuidBytes {
  if (!Number.isInteger(nowMs) || nowMs < 0 || nowMs > 0xffffffffffff) {
    throw new RangeError(`timestamp out of range for a 48-bit field: ${nowMs}`);
  }

  const bytes = new Uint8Array(UUID_BYTES);
  random(bytes.subarray(6)); // fill the 10 random bytes first, then overwrite the header
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant

  // 48-bit big-endian timestamp in the first six bytes.
  let remaining = nowMs;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  return bytes;
}

/** The millisecond a UUIDv7 was minted at, recovered from its prefix. */
export function uuidv7Timestamp(bytes: UuidBytes): number {
  if (bytes.length !== UUID_BYTES || (bytes[6]! >> 4) !== 7) {
    throw new RangeError("not a UUIDv7");
  }
  let millis = 0;
  for (let index = 0; index < 6; index += 1) {
    millis = millis * 256 + bytes[index]!;
  }
  return millis;
}
