/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The push payload (`15 §2.1`, D83).
 *
 * Five properties are non-negotiable, and this file is where four of them live:
 *
 * 1. **Data only.** There is no `notification` block, at any depth, ever. That block hands the alert to
 *    the operating system, which draws it at notification volume, once, respecting Do Not Disturb — and on
 *    several Android builds it means `onMessageReceived` is never called and the full-screen alarm never
 *    appears. A rider then misses an order worth ৳1 800, and the platform's only evidence is silence.
 * 2. **`android.priority: "high"` for a critical message.** Without it a data-only message is
 *    normal-priority, is batched by Doze, and does not wake the device. This single field is the
 *    difference between an alarm and a notification that arrives after lunch.
 * 3. **A short `ttl`.** An offer is worthless after two minutes, and a stale alarm an hour later is worse
 *    than none: it teaches a vendor to distrust the alarm.
 * 4. **A signature over the data map**, so the client can tell an alarm it built from a payload the
 *    platform sent from one somebody else sent. It is HMAC-SHA256 over the sorted map, hex encoded.
 *
 * The fifth — no legacy endpoint, no `Authorization: key=…` — is the sender's business and is a repo-wide
 * guardrail (`fcm-payload-purity`).
 *
 * Everything here is pure: a payload is a value, the clock is an argument, and the only async step is the
 * HMAC. That is what lets a test assert the exact bytes a device will parse.
 */

/** The payload version the Android client validates against. */
export const FCM_DATA_VERSION = "1";

/** The longest TTL FCM will be asked for; a longer one is a stale alarm waiting to happen. */
export const MAX_TTL_SECONDS = 300;

/** How long an offer is worth delivering. */
export const ORDER_TTL_SECONDS = 120;

/** A length of time a device may ring for; the alarm screen is bounded for the same reason. */
export const DEFAULT_ALARM_MAX_MS = 120_000;

/** How loud a message is. `CRITICAL` is the only severity that may ring. */
export type PushSeverity = "CRITICAL" | "NORMAL";

/** What the device should do with the message. */
export type OrderPushType = "ORDER_NEW" | "ORDER_UPDATED" | "ORDER_CANCELLED";

/** Which attempt this is. The second and third replace the first rather than stacking. */
export type PushAttempt = 1 | 2 | 3;

/** What the sender knows about the order, and all it is allowed to say. */
export interface OrderPushInput {
  readonly type: OrderPushType;
  readonly severity: PushSeverity;
  /** The public order id the socket channels use, e.g. `UND-7K2M9QX4`. */
  readonly orderId: string;
  /** The short code a person reads out, e.g. `7K2M9QX4`. */
  readonly orderCode: string;
  readonly vendorId: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly itemCount: number;
  readonly totalPaisa: number;
  readonly customerArea: string;
  readonly alarm: "loop" | "once" | "none";
  readonly alarmMaxMs: number;
  readonly attempt: PushAttempt;
}

/** The Android-specific block. Every field is load-bearing; none is optional. */
export interface FcmAndroid {
  readonly priority: "high" | "normal";
  readonly ttl: string;
  readonly collapse_key: string;
  readonly direct_boot_ok: boolean;
}

/** A message as FCM v1 receives it, minus the device token. */
export interface FcmEnvelope {
  readonly data: Readonly<Record<string, string>>;
  readonly android: FcmAndroid;
}

/** A message with the device token it is addressed to. */
export interface FcmMessage extends FcmEnvelope {
  readonly token: string;
}

/** A delay as FCM spells it: `120s`. */
export function ttlSecondsFor(issuedAtMs: number, expiresAtMs: number): number {
  const seconds = Math.ceil((expiresAtMs - issuedAtMs) / 1_000);
  // A non-positive window is a message that is already dead; one second is the shortest thing worth
  // sending and the longest is the guardrail the client checks.
  if (seconds < 1) return 1;
  return seconds > MAX_TTL_SECONDS ? MAX_TTL_SECONDS : seconds;
}

/**
 * The signature over a data map.
 *
 * Sorted keys, `k=v` pairs joined by a newline, HMAC-SHA256, lowercase hex. Sorting is the whole point:
 * JSON object order is not preserved across every runtime the platform touches, so a signature over the
 * serialised map would verify on one client and fail on another.
 */
export async function signatureOf(data: Readonly<Record<string, string>>, signingKey: string): Promise<string> {
  const canonical = Object.keys(data)
    .filter((key) => key !== "sig")
    .sort()
    .map((key) => `${key}=${data[key] ?? ""}`)
    .join("\n");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Build a payload for one order.
 *
 * Every value is a string because FCM's data map is `Map<String, String>` on the client, and a number that
 * arrives as a number is an integer on one platform and a float on another. `totalPaisa` goes out as
 * paisa — the client formats it — so no money crosses the wire as a decimal.
 */
export async function buildOrderPush(input: OrderPushInput, signingKey: string): Promise<FcmEnvelope> {
  if (!Number.isInteger(input.totalPaisa)) {
    throw new RangeError(`totalPaisa must be an integer number of paisa, got ${input.totalPaisa}`);
  }
  if (!Number.isInteger(input.itemCount) || input.itemCount < 0) {
    throw new RangeError(`itemCount must be a non-negative integer, got ${input.itemCount}`);
  }
  const ttlSeconds = ttlSecondsFor(input.issuedAtMs, input.expiresAtMs);
  const data:Record<string, string> = {
    v: FCM_DATA_VERSION,
    type: input.type,
    severity: input.severity,
    orderId: input.orderId,
    orderCode: input.orderCode,
    vendorId: input.vendorId,
    issuedAt: String(input.issuedAtMs),
    expiresAt: String(input.issuedAtMs + ttlSeconds * 1_000),
    itemCount: String(input.itemCount),
    totalPaisa: String(input.totalPaisa),
    customerArea: input.customerArea,
    alarm: input.alarm,
    alarmMaxMs: String(input.alarmMaxMs),
    attempt: String(input.attempt),
  };
  const signed = { ...data, sig: await signatureOf(data, signingKey) };
  return {
    data: signed,
    android: {
      // A critical message must ask for high priority: on a normal-priority data message Android may
      // batch it until the next maintenance window, which for a two-minute offer is never.
      priority: input.severity === "CRITICAL" ? "high" : "normal",
      ttl: `${ttlSeconds}s`,
      collapse_key: `order_${input.orderId}`,
      direct_boot_ok: true,
    },
  };
}

/** Address a built payload to one device. The payload is the same for every device of an actor. */
export function withToken(envelope: FcmEnvelope, token: string): FcmMessage {
  return { token, data: envelope.data, android: envelope.android };
}
