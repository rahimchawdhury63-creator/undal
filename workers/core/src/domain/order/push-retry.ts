/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * When a failed push is worth sending again (`15 §8`, D131).
 *
 * D128 sends the alarm and records `SENT` or `FAILED` against the token. A `FAILED` row used to be the end of the
 * story: the rider's phone never rang, the offer expired in twenty-five seconds, and the only trace was a row
 * nobody read. But most failures are not the rider's fault and are not permanent — a 503 from Google, a socket
 * that timed out at 1 500 ms, a rate limit — and the offer they belong to is still live. That is a second chance
 * worth one HTTP call.
 *
 * **The wave's clock is the budget, and it is the only limit.** An offer lives 25 seconds; a retry that lands
 * after it has expired is a phone ringing for an order somebody else is already collecting. So a retry waits
 * `RETRY_AFTER_MS` past the failure (a timeout that just happened will fail the same way immediately) and is
 * abandoned when less than `RETRY_MIN_REMAINING_MS` of the offer is left.
 *
 * **Permanent failures are pruned, not retried.** A 404 is Google saying the token is unregistered — the app was
 * uninstalled, or the token rotated and the old one is dead — and a 400/401/403 is a payload or credential the
 * same call will produce again. Those invalidate the `device_tokens` row so the next wave does not even try,
 * which is why the retry query joins `device_tokens` on `valid = 1`: pruning is the other half of the policy.
 */

/** The `device_tokens.invalid_reason` for a phone Google says is gone: the 404 that is permanent. */
export const UNREGISTERED_REASON = "FCM_UNREGISTERED";

/** How many sends one token may receive for one offer: the first, and two retries. */
export const MAX_PUSH_ATTEMPTS = 3;

/** How long after a failed send a retry becomes due. Long enough for a transient blip to clear. */
export const RETRY_AFTER_MS = 2_000;

/** How much of the offer's life must remain for a retry to be worth spending. */
export const RETRY_MIN_REMAINING_MS = 3_000;

/** How many pushes one pass retries. A wave is eight riders; a pass twice that is already an unusual minute. */
export const MAX_RETRIES_PER_PASS = 20;

/**
 * Whether a failed send can never succeed, whatever the network does next.
 *
 * `null` is a transport that never answered — an abort or a socket error — and `408`, `425`, `429` and `5xx` are
 * the statuses that mean "not now". Everything else is a request Google understood and refused, and repeating a
 * refused request is how a wake-up call becomes a flood.
 */
export function pushFailureIsPermanent(status: number | null): boolean {
  if (status === null) return false;
  if (status === 408 || status === 425 || status === 429) return false;
  if (status >= 500 && status <= 599) return false;
  return status >= 400;
}

/**
 * The attempt number the retry records.
 *
 * `fcm_dispatches.attempt` counts attempts **for one token on one order**, which is what makes "the third
 * attempt" mean something to support. D128 numbered by position in the device list, so a rider's second phone
 * started life claiming attempt 2; this keeps the arithmetic honest from the retry onwards.
 */
export function nextAttempt(attempt: number): number {
  return Math.max(0, Math.trunc(attempt)) + 1;
}
