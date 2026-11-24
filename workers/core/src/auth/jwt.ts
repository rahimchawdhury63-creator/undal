/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { fail, ok, type Result } from "../lib/result.ts";

/**
 * Access tokens: EdDSA over Ed25519, signed by the Worker and verified by every
 * Worker.
 *
 * EdDSA rather than HMAC because `undal-realtime` must verify a token without being
 * able to mint one: a shared secret in three Workers means a compromise of the least
 * interesting one forges admin sessions. The key material is a JWK so the public half
 * is available for verification from the single `JWT_SIGNING_KEY` secret, and
 * `JWT_PREVIOUS_KEY` is accepted for verification only during a rotation.
 */

/** What a token asserts. Field names are short because they travel on every request. */
export interface TokenClaims {
  /** The user id, as a UUID string. */
  readonly sub: string;
  /** Actor type, matching `users.actor_type`. */
  readonly act: "CUSTOMER" | "VENDOR_OWNER" | "RIDER" | "ADMIN";
  /** System role for an admin, `null` for everybody else. */
  readonly role: string | null;
  /** Zones the token is limited to; `null` means everywhere. */
  readonly scope: readonly string[] | null;
  /** Device that holds the session — a token moved to another device is refused. */
  readonly did: string;
  /** Session id, so a single session can be revoked without revoking the family. */
  readonly sid: string;
  /** When TOTP was last satisfied, in epoch milliseconds, or `null`. */
  readonly amr: number | null;
  /** Whether this session is an impersonation, which is read-only. */
  readonly imp: boolean;
  readonly iat: number;
  readonly exp: number;
}

/** Access-token lifetimes in seconds, from `27 §2.3`. */
export const ACCESS_TOKEN_TTL: Readonly<Record<TokenClaims["act"], number>> = {
  CUSTOMER: 900,
  VENDOR_OWNER: 900,
  RIDER: 900,
  ADMIN: 600,
};

/** A key pair loaded from one secret, with the thumbprint both sides key on. */
export interface TokenKeys {
  readonly kid: string;
  readonly signing: CryptoKey;
  readonly verifying: CryptoKey;
}

const ED25519 = { name: "Ed25519" } as unknown as Parameters<SubtleCrypto["importKey"]>[2];

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

function encodeJson(value: unknown): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * Load the signing key from the `JWT_SIGNING_KEY` secret.
 *
 * The secret is a base64url-encoded JWK, not a PEM, because a JWK carries the public
 * coordinate alongside the private scalar — so verification works from the same secret
 * without a second configuration value that could be forgotten on rotation and then
 * differ from the signing key. A PEM would parse and then fail to verify, and the
 * symptom would be "every request is unauthorised" at deploy time.
 */
export async function loadTokenKeys(secret: string): Promise<TokenKeys> {
  const jwk = JSON.parse(new TextDecoder().decode(decodeBase64Url(secret))) as JsonWebKey & {
    kty?: string;
    crv?: string;
    x?: string;
    d?: string;
  };
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || jwk.x === undefined) {
    throw new Error("JWT_SIGNING_KEY must be a base64url JWK with kty=OKP, crv=Ed25519 and x present");
  }
  const publicOnly: JsonWebKey = { kty: "OKP", crv: "Ed25519", x: jwk.x };
  const verifying = await crypto.subtle.importKey("jwk", publicOnly, ED25519, true, ["verify"]);
  if (jwk.d === undefined) throw new Error("JWT_SIGNING_KEY is missing the private scalar d");
  const signing = await crypto.subtle.importKey("jwk", { ...publicOnly, d: jwk.d }, ED25519, false, ["sign"]);
  const thumbprint = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(jwk.x)));
  const kid = encodeBase64Url(thumbprint.slice(0, 8));
  return { kid, signing, verifying };
}

/**
 * Mint an access token for a session.
 *
 * `iat` and `exp` come from the caller's clock, not from `Date.now()` inside, so the
 * session row and the token it issues can never disagree about when the session began.
 */
export async function signAccessToken(
  claims: Omit<TokenClaims, "iat" | "exp">,
  keys: TokenKeys,
  options: { nowMs?: number; ttlSeconds?: number } = {},
): Promise<string> {
  const iat = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const ttl = options.ttlSeconds ?? ACCESS_TOKEN_TTL[claims.act];
  const payload: TokenClaims = { ...claims, iat, exp: iat + ttl };
  const header = encodeJson({ alg: "EdDSA", typ: "JWT", kid: keys.kid });
  const body = encodeJson(payload);
  const signingInput = `${header}.${body}`;
  const signature = await crypto.subtle.sign(ED25519, keys.signing, new TextEncoder().encode(signingInput));
  return `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`;
}

/**
 * Verify a token and return its claims.
 *
 * Every failure is `AUTH_TOKEN_INVALID` rather than a family of codes: the client's
 * only correct response to any of them is to refresh, and distinguishing "bad
 * signature" from "expired" in a response tells an attacker which half of a forgery
 * attempt to fix. The waitUntil-able distinction lives in the log, not the response.
 */
export async function verifyAccessToken(
  token: string,
  keys: readonly TokenKeys[],
  nowMs: number = Date.now(),
): Promise<Result<TokenClaims>> {
  const parts = token.split(".");
  if (parts.length !== 3) return fail("AUTH_TOKEN_INVALID");
  const [headerPart, bodyPart, signaturePart] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64Url(headerPart))) as { alg?: string; kid?: string };
  } catch {
    return fail("AUTH_TOKEN_INVALID");
  }
  if (header.alg !== "EdDSA") return fail("AUTH_TOKEN_INVALID");

  const key = keys.find((candidate) => candidate.kid === header.kid);
  if (key === undefined) return fail("AUTH_TOKEN_INVALID");

  const valid = await crypto.subtle.verify(
    ED25519,
    key.verifying,
    decodeBase64Url(signaturePart),
    new TextEncoder().encode(`${headerPart}.${bodyPart}`),
  );
  if (!valid) return fail("AUTH_TOKEN_INVALID");

  let claims: TokenClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(bodyPart))) as TokenClaims;
  } catch {
    return fail("AUTH_TOKEN_INVALID");
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= nowMs) return fail("AUTH_SESSION_EXPIRED");
  return ok(claims);
}
