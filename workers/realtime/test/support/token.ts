/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * A key pair and a signer, for the tests that have to hold a real token.
 *
 * The tokens are signed the way `undal-core` signs them — Ed25519 over `header.payload`, base64url, with
 * the kid derived from the public coordinate — so a test that accepts one is a test of the wire format and
 * not of a convenience wrapper.
 */

import type { TokenClaims } from "../../src/auth/token.ts";

export const NOW = 1_760_000_000_000;

/** A key pair, plus the public JWK and the kid both sides derive. */
export async function keyPair(): Promise<{ privateKey: CryptoKey; jwk: JsonWebKey; publicJwk: JsonWebKey; secret: string; kid: string }> {
  const usage = ["sign", "verify"] as unknown as readonly string[] as Parameters<SubtleCrypto["generateKey"]>[2];
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" } as unknown as Parameters<SubtleCrypto["generateKey"]>[0], true, usage)) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  if (jwk.x === undefined) throw new Error("the generated key has no public coordinate");
  const publicJwk: JsonWebKey = { kty: "OKP", crv: "Ed25519", x: jwk.x };
  const thumbprint = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jwk.x as string)));
  const kid = base64url(thumbprint.slice(0, 8));
  return { privateKey: pair.privateKey, jwk, publicJwk, secret: base64url(new TextEncoder().encode(JSON.stringify(publicJwk))), kid };
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

/** Sign a token the way core's signer does. */
export async function sign(
  claims: Partial<TokenClaims>,
  key: { privateKey: CryptoKey; kid: string },
  nowMs: number = NOW,
): Promise<string> {
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: key.kid })));
  const payload = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        sub: claims.sub ?? "rider-a",
        act: claims.act ?? "RIDER",
        role: claims.role ?? null,
        scope: claims.scope ?? ["sylhet"],
        did: claims.did ?? "device-1",
        sid: claims.sid ?? "session-1",
        amr: claims.amr ?? null,
        imp: claims.imp ?? false,
        iat: claims.iat ?? Math.floor(nowMs / 1_000),
        exp: claims.exp ?? Math.floor(nowMs / 1_000) + 900,
      }),
    ),
  );
  const input = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" } as unknown as Parameters<SubtleCrypto["sign"]>[0],
    key.privateKey,
    new TextEncoder().encode(input),
  );
  return `${input}.${base64url(new Uint8Array(signature))}`;
}

