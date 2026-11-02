/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Verifying the access token, without the ability to mint one.
 *
 * `undal-core` signs access tokens with Ed25519 (`workers/core/src/auth/jwt.ts`), and every Worker that
 * accepts one has to verify it. This Worker is given the **public** half only — `JWT_PUBLIC_KEY`, a
 * base64url JWK with `kty=OKP, crv=Ed25519, x` — because a shared private key in the least interesting
 * Worker is a forge for every session in the platform. `docs/29 §2.6` lists the signing key as core-only;
 * this is the reading of that rule that still lets realtime authenticate a socket.
 *
 * Verification is deliberately strict and deliberately quiet: one code for every failure, because telling
 * a caller whether the signature or the clock failed tells an attacker which half of a forgery to fix.
 * The distinction is available to the caller as a reason for the log, not for the response.
 */

import { fail, ok, type Result } from "../lib/result.ts";

/** What a token asserts, mirroring core's `TokenClaims` field for field. */
export interface TokenClaims {
  readonly sub: string;
  readonly act: "CUSTOMER" | "VENDOR_OWNER" | "RIDER" | "ADMIN";
  readonly role: string | null;
  readonly scope: readonly string[] | null;
  readonly did: string;
  readonly sid: string;
  readonly amr: number | null;
  readonly imp: boolean;
  readonly iat: number;
  readonly exp: number;
}

/** A verification key: the public half plus the id a token names in its header. */
export interface VerifyingKey {
  readonly kid: string;
  readonly verifying: CryptoKey;
}

/** Why a token was refused. This is for the log; the response says only `AUTH_TOKEN_INVALID`. */
export type TokenFailure = "MALFORMED" | "UNKNOWN_KEY" | "BAD_SIGNATURE" | "MALFORMED_CLAIMS" | "EXPIRED";

/** The clock skew allowed on `iat`, in seconds, for devices whose clock is a little fast. */
export const MAX_CLOCK_SKEW_S = 60;

const ED25519 = { name: "Ed25519" } as unknown as Parameters<SubtleCrypto["importKey"]>[2];

/** base64url, decoded. Padding is optional in the format and mandatory in `atob`. */
function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** base64url, encoded without padding. */
function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

/**
 * Load the public key from `JWT_PUBLIC_KEY`.
 *
 * The secret is a base64url-encoded JWK, the same encoding core uses, so a rotation hands this Worker the
 * public half of exactly the key that is signing. A PEM would import and then fail to verify, and the
 * symptom would be "every socket is unauthorised" at deploy time — which is why this refuses early and
 * loudly instead.
 */
export async function loadVerifyingKey(secret: string): Promise<VerifyingKey> {
  let jwk: (JsonWebKey & { kty?: string; crv?: string; x?: string }) | null = null;
  try {
    jwk = JSON.parse(new TextDecoder().decode(decodeBase64Url(secret))) as JsonWebKey & { kty?: string; crv?: string; x?: string };
  } catch {
    throw new RangeError("JWT_PUBLIC_KEY is not base64url-encoded JSON");
  }
  if (jwk === null || jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || jwk.x === undefined) {
    throw new RangeError("JWT_PUBLIC_KEY must be a JWK with kty=OKP, crv=Ed25519 and x present");
  }
  const publicOnly: JsonWebKey = { kty: "OKP", crv: "Ed25519", x: jwk.x };
  const verifying = await crypto.subtle.importKey("jwk", publicOnly, ED25519, false, ["verify"]);
  const thumbprint = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jwk.x)));
  return { kid: encodeBase64Url(thumbprint.slice(0, 8)), verifying };
}

/**
 * Verify a compact JWS and return its claims.
 *
 * `nowMs` is passed in rather than read, for the same reason every clock in this Worker is: a test that
 * has to wait fifteen minutes for a token to expire is a test nobody runs.
 */
export async function verifyAccessToken(
  token: string,
  keys: readonly VerifyingKey[],
  nowMs: number,
): Promise<Result<TokenClaims, TokenFailure>> {
  const parts = token.split(".");
  if (parts.length !== 3) return fail("MALFORMED");
  const [headerPart, bodyPart, signaturePart] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64Url(headerPart))) as { alg?: string; kid?: string };
  } catch {
    return fail("MALFORMED");
  }
  if (header.alg !== "EdDSA") return fail("MALFORMED");

  const key = keys.find((candidate) => candidate.kid === header.kid);
  if (key === undefined) return fail("UNKNOWN_KEY");

  let signature: Uint8Array;
  try {
    signature = decodeBase64Url(signaturePart);
  } catch {
    return fail("MALFORMED");
  }
  const valid = await crypto.subtle.verify(
    ED25519,
    key.verifying,
    signature as unknown as BufferSource,
    new TextEncoder().encode(`${headerPart}.${bodyPart}`),
  );
  if (!valid) return fail("BAD_SIGNATURE");

  let claims: TokenClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(bodyPart))) as TokenClaims;
  } catch {
    return fail("MALFORMED_CLAIMS");
  }
  if (typeof claims.exp !== "number" || claims.exp * 1_000 <= nowMs) return fail("EXPIRED");
  if (typeof claims.iat === "number" && claims.iat * 1_000 > nowMs + MAX_CLOCK_SKEW_S * 1_000) {
    return fail("MALFORMED_CLAIMS");
  }
  return ok(claims);
}

/**
 * The token on a request.
 *
 * A browser cannot set headers on an `EventSource`, so the query parameter is the fallback every SSE
 * client uses. It is accepted here and nowhere else — a token in a URL ends up in logs, and the stream's
 * own access log is the one place it is unavoidable.
 */
export function tokenFromRequest(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header !== null) {
    const match = /^Bearer[ ]+(.+)$/iu.exec(header.trim());
    const value = match?.[1]?.trim() ?? "";
    if (value !== "") return value;
  }
  const parameter = new URL(request.url).searchParams.get("access_token");
  return parameter === null || parameter.trim() === "" ? null : parameter.trim();
}

/** The principal a token names, ready for the stream route's authorizer. */
export interface AuthenticatedPrincipal {
  readonly actorId: string;
  readonly actorType: TokenClaims["act"];
  readonly role: string | null;
  readonly zoneIds: readonly string[] | null;
  readonly deviceId: string;
  readonly sessionId: string;
}

/** Map claims to the principal a route needs. */
export function principalFrom(claims: TokenClaims): AuthenticatedPrincipal {
  return {
    actorId: claims.sub,
    actorType: claims.act,
    role: claims.role,
    zoneIds: claims.scope,
    deviceId: claims.did,
    sessionId: claims.sid,
  };
}

/** Authenticate a request, or say why not. */
export async function authenticate(
  request: Request,
  keys: readonly VerifyingKey[],
  nowMs: number,
): Promise<Result<AuthenticatedPrincipal, TokenFailure>> {
  const token = tokenFromRequest(request);
  if (token === null) return fail("MALFORMED");
  const verified = await verifyAccessToken(token, keys, nowMs);
  if (!verified.ok) return verified;
  return ok(principalFrom(verified.value));
}
