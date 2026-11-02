/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Token verification in the Worker that may not mint one.
 *
 * The keys are generated in the test, exported as the public JWK this Worker is configured with, and used
 * to sign the tokens the tests verify — so the wire format is the real one, Ed25519 over
 * `header.payload`, and a change to the signing side would fail here rather than in production.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MAX_CLOCK_SKEW_S,
  authenticate,
  loadVerifyingKey,
  principalFrom,
  tokenFromRequest,
  verifyAccessToken,
} from "../src/auth/token.ts";
import type { TokenClaims } from "../src/auth/token.ts";
import { NOW, base64url, keyPair, sign } from "./support/token.ts";

describe("token verification", () => {
  test("a token signed with the configured key verifies, with its claims intact", async () => {
    const pair = await keyPair();
    const key = await loadVerifyingKey(pair.secret);
    assert.equal(key.kid, pair.kid);
    const token = await sign({ sub: "rider-a", act: "RIDER", scope: ["sylhet"] }, pair);
    const verified = await verifyAccessToken(token, [key], NOW);
    assert.equal(verified.ok, true);
    if (!verified.ok) return;
    assert.equal(verified.value.sub, "rider-a");
    assert.equal(verified.value.act, "RIDER");
    assert.deepEqual(verified.value.scope, ["sylhet"]);
  });

  test("the principal maps claims without inventing any", async () => {
    const pair = await keyPair();
    const key = await loadVerifyingKey(pair.secret);
    const token = await sign({ sub: "vendor-a", act: "VENDOR_OWNER", role: null, did: "tablet", sid: "s1" }, pair);
    const verified = await verifyAccessToken(token, [key], NOW);
    assert.equal(verified.ok, true);
    if (!verified.ok) return;
    assert.deepEqual(principalFrom(verified.value), {
      actorId: "vendor-a",
      actorType: "VENDOR_OWNER",
      role: null,
      zoneIds: ["sylhet"],
      deviceId: "tablet",
      sessionId: "s1",
    });
  });

  test("an expired token is refused, and on the second it expires", async () => {
    const pair = await keyPair();
    const key = await loadVerifyingKey(pair.secret);
    const exp = Math.floor(NOW / 1_000);
    const token = await sign({ exp }, pair, NOW);
    const atExpiry = await verifyAccessToken(token, [key], exp * 1_000);
    assert.equal(atExpiry.ok === false ? atExpiry.error : "", "EXPIRED");
    const justBefore = await verifyAccessToken(token, [key], exp * 1_000 - 1);
    assert.equal(justBefore.ok, true);
  });

  test("a tampered payload is refused even though the signature is well formed", async () => {
    const pair = await keyPair();
    const key = await loadVerifyingKey(pair.secret);
    const token = await sign({ act: "RIDER" }, pair);
    const [header, , signature] = token.split(".");
    const forgedBody = base64url(new TextEncoder().encode(JSON.stringify({ sub: "rider-a", act: "ADMIN", exp: 9_999_999_999 })));
    const forged = `${header}.${forgedBody}.${signature}`;
    const verified = await verifyAccessToken(forged, [key], NOW);
    assert.equal(verified.ok === false ? verified.error : "", "BAD_SIGNATURE");
  });

  test("a token signed by another key is refused", async () => {
    const configured = await loadVerifyingKey((await keyPair()).secret);
    const stranger = await keyPair();
    const token = await sign({}, stranger);
    assert.equal((await verifyAccessToken(token, [configured], NOW)).ok, false);
  });

  test("a token whose kid names no configured key is refused before any crypto", async () => {
    const pair = await keyPair();
    const other = await keyPair();
    const token = await sign({}, pair);
    const key = await loadVerifyingKey(other.secret);
    const verified = await verifyAccessToken(token, [key], NOW);
    assert.equal(verified.ok === false ? verified.error : "", "UNKNOWN_KEY");
  });

  test("an algorithm that is not EdDSA is refused", async () => {
    const pair = await keyPair();
    const key = await loadVerifyingKey(pair.secret);
    const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "HS256", kid: pair.kid })));
    const body = base64url(new TextEncoder().encode(JSON.stringify({ sub: "x", exp: 9_999_999_999 })));
    const verified = await verifyAccessToken(`${header}.${body}.${"A".repeat(64)}`, [key], NOW);
    assert.equal(verified.ok === false ? verified.error : "", "MALFORMED");
  });

  test("a token with the wrong number of parts is malformed", async () => {
    const key = await loadVerifyingKey((await keyPair()).secret);
    for (const token of ["", "a.b", "a.b.c.d", "...."]) {
      assert.equal((await verifyAccessToken(token, [key], NOW)).ok, false);
    }
  });

  test("claims from the future are refused, but ordinary skew is not", async () => {
    const pair = await keyPair();
    const key = await loadVerifyingKey(pair.secret);
    const skewed = await sign({ iat: Math.floor(NOW / 1_000) + 5 }, pair);
    assert.equal((await verifyAccessToken(skewed, [key], NOW)).ok, true);
    const fromTheFuture = await sign({ iat: Math.floor(NOW / 1_000) + MAX_CLOCK_SKEW_S + 5 }, pair);
    assert.equal((await verifyAccessToken(fromTheFuture, [key], NOW)).ok, false);
  });

  test("the configured secret must be an Ed25519 public JWK", async () => {
    await assert.rejects(() => loadVerifyingKey("not-base64-json"), RangeError);
    const wrong = base64url(new TextEncoder().encode(JSON.stringify({ kty: "RSA", n: "x" })));
    await assert.rejects(() => loadVerifyingKey(wrong), RangeError);
    const privateOnly = base64url(new TextEncoder().encode(JSON.stringify({ kty: "OKP", crv: "Ed25519" })));
    await assert.rejects(() => loadVerifyingKey(privateOnly), RangeError);
  });
});

describe("token on a request", () => {
  test("a bearer header is read", () => {
    const request = new Request("https://rt.undal.app/rt/stream", { headers: { authorization: "Bearer abc.def.ghi" } });
    assert.equal(tokenFromRequest(request), "abc.def.ghi");
  });

  test("the header wins over the query parameter, which exists for EventSource", () => {
    const request = new Request("https://rt.undal.app/rt/stream?access_token=from-query", {
      headers: { authorization: "Bearer from-header" },
    });
    assert.equal(tokenFromRequest(request), "from-header");
    assert.equal(tokenFromRequest(new Request("https://rt.undal.app/rt/stream?access_token=from-query")), "from-query");
  });

  test("no token is null, and a malformed header is null too", () => {
    assert.equal(tokenFromRequest(new Request("https://rt.undal.app/rt/stream")), null);
    assert.equal(tokenFromRequest(new Request("https://rt.undal.app/rt/stream", { headers: { authorization: "Basic x" } })), null);
  });

  test("authenticate walks from request to principal", async () => {
    const pair = await keyPair();
    const key = await loadVerifyingKey(pair.secret);
    const token = await sign({ sub: "rider-a" }, pair);
    const request = new Request("https://rt.undal.app/rt/stream", { headers: { authorization: `Bearer ${token}` } });
    const authenticated = await authenticate(request, [key], NOW);
    assert.equal(authenticated.ok, true);
    if (!authenticated.ok) return;
    assert.equal(authenticated.value.actorId, "rider-a");
  });

  test("a request with no token fails without touching the clock", async () => {
    const key = await loadVerifyingKey((await keyPair()).secret);
    const result = await authenticate(new Request("https://rt.undal.app/rt/stream"), [key], NOW);
    assert.equal(result.ok === false ? result.error : "", "MALFORMED");
  });
});
