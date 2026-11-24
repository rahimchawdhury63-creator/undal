/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { haversineMeters, type PointE7 } from "@undal/contracts";

import { PICKUP_GEOFENCE_M } from "./guards.ts";

/**
 * The pickup proof: a rotating HMAC the vendor displays and the rider scans.
 *
 * Why not a static code on the order: a customer who screenshots a code, or a rider who shares
 * one, is a theft that costs the vendor a meal and the platform a dispute it cannot win. The code
 * therefore rotates every sixty seconds, is bound to one order, and cannot be replayed outside a
 * four-hour window — and the vendor's *phone* is what displays it, so possession of the phone is
 * the second factor.
 *
 * The signature is HMAC-SHA256 over `order.code | window`, keyed with the per-order secret minted
 * at placement. Nothing here is random: a verifier on the admin side can recompute the expected
 * code for any past window, which is what makes "the rider scanned at 14:03" checkable rather
 * than merely recorded.
 */

/** The code rotates every sixty seconds, exactly as the pickup screen does. */
export const ROTATION_S = 60;
/** A code stays acceptable for four hours after it was minted — a rider can be stuck in traffic. */
export const VALIDITY_S = 4 * 60 * 60;
/** How many windows back a six-digit fallback is accepted, for a phone with a dead camera. */
export const FALLBACK_WINDOWS = 1;

/** The window a timestamp falls in. */
export function windowIndex(nowMs: number): number {
  return Math.floor(nowMs / (ROTATION_S * 1000));
}

/** The bytes a signature covers: the order's code and the window, nothing else. */
function message(code: string, window: number): Uint8Array {
  return new TextEncoder().encode(`${code}|${window}`);
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** The signature for one code and window. */
export async function sign(secret: string, code: string, window: number): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await importKey(secret), message(code, window));
  return toHex(new Uint8Array(signature));
}

/**
 * The six-digit fallback, derived from the signature rather than generated separately.
 *
 * A rider whose camera is cracked, or standing in a dim kitchen, needs a way to prove the same
 * thing. Deriving the digits from the same HMAC means one secret, one rotation and one place to
 * audit — and the vendor reads six digits off their own screen while the rider types them.
 */
export async function sixDigitFallback(secret: string, code: string, window: number): Promise<string> {
  const signature = await sign(secret, code, window);
  const slice = Number.parseInt(signature.slice(0, 8), 16);
  return String(100_000 + (slice % 900_000));
}

/** A scan the platform refused, with the code the app renders. */
export interface PickupRefusal {
  readonly ok: false;
  readonly code: "QR_INVALID" | "QR_WRONG_ORDER" | "QR_EXPIRED" | "QR_TOO_FAR" | "QR_ALREADY_SCANNED";
}

/** A scan the platform accepted. */
export interface PickupAccepted {
  readonly ok: true;
  /** Which window the presented code belonged to, for the audit trail. */
  readonly window: number;
  /** How far the rider was from the vendor, in whole metres. */
  readonly distanceM: number;
}

/**
 * Verify a scan.
 *
 * The order of the checks is deliberate: format, then order binding, then freshness, then
 * proximity. Answering "too far" for a code that was never valid would tell a prober that the
 * code they invented was otherwise right.
 */
export async function verifyPickupCode(input: {
  readonly presented: string;
  readonly secret: string;
  readonly orderCode: string;
  readonly riderPoint: PointE7;
  readonly vendorPoint: PointE7;
  readonly nowMs: number;
  readonly alreadyScanned: boolean;
}): Promise<PickupAccepted | PickupRefusal> {
  if (input.alreadyScanned) return { ok: false, code: "QR_ALREADY_SCANNED" };

  const parts = input.presented.split("|");
  if (parts.length !== 3) return { ok: false, code: "QR_INVALID" };
  const [presentedCode, windowText, presentedSignature] = parts;
  if (presentedCode === undefined || windowText === undefined || presentedSignature === undefined) {
    return { ok: false, code: "QR_INVALID" };
  }

  if (presentedCode !== input.orderCode) return { ok: false, code: "QR_WRONG_ORDER" };

  const window = Number.parseInt(windowText, 10);
  if (!Number.isSafeInteger(window)) return { ok: false, code: "QR_INVALID" };

  const expected = await sign(input.secret, presentedCode, window);
  if (!timingSafeEqual(expected, presentedSignature)) return { ok: false, code: "QR_INVALID" };

  const ageS = (windowIndex(input.nowMs) - window) * ROTATION_S;
  if (ageS < 0 || ageS > VALIDITY_S) return { ok: false, code: "QR_EXPIRED" };

  const distanceM = haversineMeters(input.vendorPoint, input.riderPoint);
  if (distanceM > PICKUP_GEOFENCE_M) return { ok: false, code: "QR_TOO_FAR" };

  return { ok: true, window, distanceM };
}

/**
 * Verify the spoken fallback instead of a scan.
 *
 * Accepts the current window and the one before it, because the vendor's screen and the rider's
 * thumb are not synchronised — a digit typed at 14:03:59 and submitted at 14:04:01 must not be
 * refused for the crime of being one second late.
 */
export async function verifyFallback(input: {
  readonly digits: string;
  readonly secret: string;
  readonly orderCode: string;
  readonly riderPoint: PointE7;
  readonly vendorPoint: PointE7;
  readonly nowMs: number;
  readonly alreadyScanned: boolean;
}): Promise<PickupAccepted | PickupRefusal> {
  if (input.alreadyScanned) return { ok: false, code: "QR_ALREADY_SCANNED" };
  if (!/^\d{6}$/u.test(input.digits)) return { ok: false, code: "QR_INVALID" };

  const current = windowIndex(input.nowMs);
  const distanceM = haversineMeters(input.vendorPoint, input.riderPoint);
  if (distanceM > PICKUP_GEOFENCE_M) return { ok: false, code: "QR_TOO_FAR" };

  for (let offset = 0; offset <= FALLBACK_WINDOWS; offset += 1) {
    const window = current - offset;
    if (timingSafeEqual(await sixDigitFallback(input.secret, input.orderCode, window), input.digits)) {
      return { ok: true, window, distanceM };
    }
  }
  return { ok: false, code: "QR_INVALID" };
}

/** The QR payload a vendor's phone renders for a given moment. */
export async function renderPickupPayload(secret: string, orderCode: string, nowMs: number): Promise<string> {
  const window = windowIndex(nowMs);
  const signature = await sign(secret, orderCode, window);
  return `${orderCode}|${window}|${signature}`;
}

/** Compare two hex strings without leaking how far they match. */
function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
