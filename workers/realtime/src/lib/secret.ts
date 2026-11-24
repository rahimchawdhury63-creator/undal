/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The shared secret that lets `undal-core` call this Worker's internal surface.
 *
 * `undal-core` already builds its realtime client with a bearer token
 * (`workers/core/src/bindings/realtime.ts`), and those calls are the ones that change an order's visible
 * state, so the token is not a formality. It is compared in constant time and it is required: an
 * unconfigured Worker refuses internal calls rather than accepting everybody, because the failure mode
 * of a missing secret must be a closed door, not an open one.
 *
 * An access token is not accepted here. A customer's bearer token identifies a customer; it does not
 * authorize broadcasting to a zone. Mixing the two would make every signed-in user a potential
 * broadcaster.
 */

/** The header the caller sends. */
export const AUTHORIZATION_HEADER = "authorization";

/** The prefix a bearer token carries. */
const BEARER = /^Bearer[ ]+(.+)$/iu;

/**
 * Compare two strings without leaking where they differ.
 *
 * Both are hashed first so the comparison is over equal-length buffers whichever compared string is
 * shorter — a `length` check that returns early is the classic way to leak a secret one character at a
 * time.
 */
export async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftDigest);
  const b = new Uint8Array(rightDigest);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= (a[index] as number) ^ (b[index] as number);
  return difference === 0;
}

/** The bearer token on a request, or `null` when there is no usable one. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get(AUTHORIZATION_HEADER);
  if (header === null) return null;
  const match = BEARER.exec(header.trim());
  const token = match?.[1]?.trim() ?? "";
  return token === "" ? null : token;
}

/** Why an internal call was refused. */
export type InternalAuthFailure = "NOT_CONFIGURED" | "MISSING_TOKEN" | "WRONG_TOKEN";

/** The result of checking an internal call: a boolean, or the reason it failed. */
export type InternalAuthResult = { readonly ok: true } | { readonly ok: false; readonly reason: InternalAuthFailure };

/**
 * Check an internal caller.
 *
 * `expected` is `undefined` when the deployment has not configured a secret. That is a refusal — a
 * Worker that has no idea who its caller should be cannot accept one — and it is reported separately
 * from a wrong token so an operator sees a configuration fault rather than a suspected intrusion.
 */
export async function checkInternalToken(request: Request, expected: string | undefined): Promise<InternalAuthResult> {
  if (expected === undefined || expected.trim() === "") return { ok: false, reason: "NOT_CONFIGURED" };
  const presented = bearerToken(request);
  if (presented === null) return { ok: false, reason: "MISSING_TOKEN" };
  return (await constantTimeEqual(presented, expected)) ? { ok: true } : { ok: false, reason: "WRONG_TOKEN" };
}
