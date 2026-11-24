/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { binToUuid, isUuid, uuidToBin, uuidv7, uuidv7Timestamp } from "../../src/db/uuid.ts";

const fixedRandom = (target: Uint8Array): Uint8Array => {
  for (let index = 0; index < target.length; index += 1) {
    target[index] = (index * 37 + 11) & 0xff;
  }
  return target;
};

describe("UUIDv7 as BINARY(16)", () => {
  test("round-trips through the canonical text form", () => {
    const text = "018f3a2c-7b1e-7c9a-9f2e-1a2b3c4d5e6f";
    assert.equal(binToUuid(uuidToBin(text)), text);
  });

  test("rejects a string that is not a UUID instead of zero-filling it", () => {
    assert.throws(() => uuidToBin("018f3a2c7b1e7c9a9f2e1a2b3c4d5e6f"), RangeError);
    assert.throws(() => uuidToBin("not-a-uuid"), RangeError);
    assert.throws(() => binToUuid(new Uint8Array(15)), RangeError);
  });

  test("sets the version and variant nibbles and keeps the timestamp honest", () => {
    const nowMs = Date.UTC(2026, 10, 1, 8, 23, 17, 482);
    const bytes = uuidv7(nowMs, fixedRandom);
    assert.equal(bytes.length, 16);
    assert.equal(bytes[6]! >> 4, 7, "version nibble");
    assert.equal(bytes[8]! >> 6, 0b10, "variant bits");
    assert.equal(uuidv7Timestamp(bytes), nowMs);
  });

  test("sorts by time across milliseconds, which is why the key is v7", () => {
    const earlier = uuidv7(1_700_000_000_000, fixedRandom);
    const later = uuidv7(1_700_000_000_001, fixedRandom);
    assert.ok(binToUuid(earlier) < binToUuid(later));
  });

  test("is deterministic for a given clock and random source", () => {
    assert.equal(binToUuid(uuidv7(1234, fixedRandom)), binToUuid(uuidv7(1234, fixedRandom)));
  });

  test("refuses a timestamp wider than 48 bits", () => {
    assert.throws(() => uuidv7(0x1_0000_0000_0000, fixedRandom), RangeError);
    assert.throws(() => uuidv7(-1, fixedRandom), RangeError);
  });

  test("recognises a canonical UUID", () => {
    assert.equal(isUuid("00000000-0000-0000-0000-000000000000"), true);
    assert.equal(isUuid("00000000-0000-0000-0000-00000000000"), false);
  });
});
