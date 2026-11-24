/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { hashPassword, needsRehash, verifyPassword } from "../src/auth/argon2.ts";
import { loadTokenKeys, signAccessToken, verifyAccessToken } from "../src/auth/jwt.ts";
import { BLOCKLIST_SIZE, COMMON_PASSWORDS, checkPasswordPolicy } from "../src/auth/password.ts";
import {
  base32Decode,
  base32Encode,
  currentCode,
  generateTotpSecret,
  otpauthUri,
  verifyCode,
} from "../src/auth/totp.ts";

/**
 * Authentication primitives, tested against published vectors where published vectors
 * exist: RFC 6238 for TOTP, the PHC format for Argon2, and a round trip plus every
 * tampering a bearer token can suffer for JWT.
 */

async function keyPair(): Promise<{ secret: string; keys: Awaited<ReturnType<typeof loadTokenKeys>> }> {
  const pair = (await crypto.subtle.generateKey(
    { name: "Ed25519" } as unknown as Parameters<SubtleCrypto["generateKey"]>[0],
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const secret = Buffer.from(JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey))).toString("base64url");
  return { secret, keys: await loadTokenKeys(secret) };
}

const CLAIMS = {
  sub: "0193f2a1-7c3e-7890-abcd-ef0123456789",
  act: "ADMIN" as const,
  role: "FINANCE",
  scope: ["sylhet"],
  did: "0193f2a1-7c3e-7890-abcd-ef01234567bb",
  sid: "0193f2a1-7c3e-7890-abcd-ef01234567aa",
  amr: 1_700_000_000_000,
  imp: false,
};

describe("access tokens", () => {
  test("a signed token verifies and carries its claims", async () => {
    const { keys } = await keyPair();
    const token = await signAccessToken(CLAIMS, keys);
    const verified = await verifyAccessToken(token, [keys]);
    assert.equal(verified.ok, true);
    if (!verified.ok) return;
    assert.equal(verified.value.sub, CLAIMS.sub);
    assert.deepEqual(verified.value.scope, ["sylhet"]);
    assert.equal(verified.value.exp - (verified.value.iat ?? 0), 600);
  });

  test("a token from a previous key still verifies during a rotation", async () => {
    const previous = await keyPair();
    const current = await keyPair();
    const token = await signAccessToken(CLAIMS, previous.keys);
    const verified = await verifyAccessToken(token, [current.keys, previous.keys]);
    assert.equal(verified.ok, true);
  });

  test("an expired token, a tampered payload and a foreign signature are all refused", async () => {
    const { keys } = await keyPair();
    const token = await signAccessToken(CLAIMS, keys, { nowMs: Date.now() - 3_600_000, ttlSeconds: 60 });
    const expired = await verifyAccessToken(token, [keys]);
    assert.equal(expired.ok === false ? expired.error.code : "", "AUTH_SESSION_EXPIRED");

    const [header, , signature] = token.split(".");
    const forged = `${header}.${Buffer.from(JSON.stringify({ ...CLAIMS, role: "SUPER_ADMIN" })).toString("base64url")}.${signature}`;
    const tampered = await verifyAccessToken(forged, [keys]);
    assert.equal(tampered.ok === false ? tampered.error.code : "", "AUTH_TOKEN_INVALID");

    const stranger = await keyPair();
    const foreign = await verifyAccessToken(token, [stranger.keys]);
    assert.equal(foreign.ok === false ? foreign.error.code : "", "AUTH_TOKEN_INVALID");
  });
});

describe("passwords", () => {
  test("the blocklist is the documented ten thousand entries", () => {
    assert.equal(BLOCKLIST_SIZE, 10_000);
    assert.equal(COMMON_PASSWORDS.size, 10_000);
    assert.equal(COMMON_PASSWORDS.has("password"), true);
  });

  test("the policy refuses the obvious and accepts a passphrase", () => {
    assert.equal(checkPasswordPolicy("password1").ok, false);
    assert.equal(checkPasswordPolicy("qwerty123").ok, false);
    assert.equal(checkPasswordPolicy("aaaaaaaaaaaa").ok, false);
    assert.equal(checkPasswordPolicy("shamol bhat 2026").ok, true);
    // A phone number is only refused when the policy knows whose phone it is: without
    // the hint it is just twelve characters, and guessing hints is not the policy's job.
    assert.equal(checkPasswordPolicy("01712345678x", { phone: "01712345678" }).ok, false);
    const personal = checkPasswordPolicy("rakib123456", { name: "Rakib" });
    assert.equal(personal.ok, false);
  });

  test("Argon2id stores a PHC string with the documented parameters", async () => {
    const hash = await hashPassword("shamol bhat 2026");
    assert.match(hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/u);
    assert.equal(await verifyPassword("shamol bhat 2026", hash), true);
    assert.equal(await verifyPassword("wrong password", hash), false);
    assert.equal(needsRehash(hash), false);
    assert.equal(needsRehash("$argon2id$v=19$m=4096,t=1,p=1$c2FsdA$aGFzaA"), true);
  });
});

describe("TOTP", () => {
  test("reproduces the RFC 6238 SHA-1 vector and refuses a replayed step", async () => {
    // RFC 6238, appendix B: ASCII "12345678901234567890", T = 59 s.
    const secret = base32Encode(new TextEncoder().encode("12345678901234567890"));
    const code = await currentCode(secret, 59_000);
    assert.equal(code, "287082");

    const accepted = await verifyCode("287082", secret, { nowMs: 59_000 });
    assert.equal(accepted.ok, true);
    if (accepted.ok) {
      assert.equal(accepted.value, 1);
      const replayed = await verifyCode("287082", secret, { nowMs: 59_000, lastUsedStep: accepted.value });
      assert.equal(replayed.ok === false ? replayed.error.code : "", "AUTH_TOTP_INVALID");
    }
  });

  test("accepts one step of drift in either direction and nothing further", async () => {
    const secret = generateTotpSecret();
    const previous = await currentCode(secret, 60_000);
    assert.equal((await verifyCode(previous, secret, { nowMs: 90_000 })).ok, true);
    const stale = await currentCode(secret, 0);
    assert.equal((await verifyCode(stale, secret, { nowMs: 300_000 })).ok, false);
    assert.equal((await verifyCode("abc", secret)).ok, false);
  });

  test("base32 round-trips and the enrolment URI names the issuer", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252]);
    assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
    const uri = otpauthUri("JBSWY3DPEHPK3PXP", "admin@undal.app");
    assert.match(uri, /^otpauth:\/\/totp\/Undal%3Aadmin%40undal\.app\?/u);
    assert.match(uri, /period=30/u);
    assert.match(uri, /digits=6/u);
  });
});
