/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The signer and the verifier are two files in two Workers, so they are tested against each other.
 *
 * `undal-core` mints the access token and `undal-realtime` accepts it on a socket. A change to either
 * side that the other does not share — a base64 variant, a claim name, the shape of the key — would
 * otherwise be discovered by a rider whose phone cannot reconnect. Signing here, verifying there, is the
 * only test that can catch it, and it is cheap enough to keep.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { loadTokenKeys, signAccessToken } from "../src/auth/jwt.ts";
import type { TokenClaims } from "../src/auth/jwt.ts";
import { loadVerifyingKey, verifyAccessToken } from "../../realtime/src/auth/token.ts";

const CLAIMS: Omit<TokenClaims, "iat" | "exp"> = {
  sub: "rider-a",
  act: "RIDER",
  role: null,
  scope: ["sylhet"],
  did: "device-1",
  sid: "session-1",
  amr: null,
  imp: false,
};

/** A base64url string, as every secret and JWK in the platform is encoded. */
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

/** Generate a signing key and the two secrets each Worker would be given. */
async function keys(): Promise<{ signingSecret: string; publicSecret: string }> {
  const pair = (await crypto.subtle.generateKey(
    { name: "Ed25519" } as unknown as Parameters<SubtleCrypto["generateKey"]>[0],
    true,
    ["sign", "verify"] as unknown as readonly string[] as Parameters<SubtleCrypto["generateKey"]>[2],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  if (jwk.x === undefined) throw new Error("the generated key has no public coordinate");
  const publicOnly: JsonWebKey = { kty: "OKP", crv: "Ed25519", x: jwk.x };
  return {
    signingSecret: base64url(new TextEncoder().encode(JSON.stringify(jwk))),
    publicSecret: base64url(new TextEncoder().encode(JSON.stringify(publicOnly))),
  };
}

describe("core signs, realtime verifies", () => {
  test("a token minted by core is accepted by the realtime verifier", async () => {
    const { signingSecret, publicSecret } = await keys();
    const signing = await loadTokenKeys(signingSecret);
    const verifying = await loadVerifyingKey(publicSecret);
    assert.equal(signing.kid, verifying.kid, "the kid is derived the same way on both sides");

    const token = await signAccessToken(CLAIMS, signing);
    const verified = await verifyAccessToken(token, [verifying], Date.now());
    assert.equal(verified.ok, true);
    if (!verified.ok) return;
    assert.equal(verified.value.sub, CLAIMS.sub);
    assert.equal(verified.value.act, "RIDER");
    assert.deepEqual(verified.value.scope, ["sylhet"]);
    assert.equal(verified.value.did, "device-1");
  });

  test("the roles map one to one across the Workers", async () => {
    const { signingSecret, publicSecret } = await keys();
    const signing = await loadTokenKeys(signingSecret);
    const verifying = await loadVerifyingKey(publicSecret);
    for (const act of ["CUSTOMER", "VENDOR_OWNER", "RIDER", "ADMIN"] as const) {
      const token = await signAccessToken({ ...CLAIMS, act }, signing);
      const verified = await verifyAccessToken(token, [verifying], Date.now());
      assert.equal(verified.ok ? verified.value.act : "REFUSED", act);
    }
  });

  test("realtime cannot verify with a key that did not sign", async () => {
    const mine = await keys();
    const theirs = await keys();
    const signing = await loadTokenKeys(mine.signingSecret);
    const verifying = await loadVerifyingKey(theirs.publicSecret);
    const token = await signAccessToken(CLAIMS, signing);
    assert.equal((await verifyAccessToken(token, [verifying], Date.now())).ok, false);
  });

  test("a rotation overlap accepts the previous key", async () => {
    const previous = await keys();
    const current = await keys();
    const previousSigning = await loadTokenKeys(previous.signingSecret);
    const currentSigning = await loadTokenKeys(current.signingSecret);
    const old = await signAccessToken(CLAIMS, previousSigning);
    const fresh = await signAccessToken(CLAIMS, currentSigning);
    const keyset = [await loadVerifyingKey(current.publicSecret), await loadVerifyingKey(previous.publicSecret)];
    assert.equal((await verifyAccessToken(old, keyset, Date.now())).ok, true);
    assert.equal((await verifyAccessToken(fresh, keyset, Date.now())).ok, true);
  });
});
