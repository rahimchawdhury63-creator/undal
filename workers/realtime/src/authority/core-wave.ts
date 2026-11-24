/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The dispatch tick, answered by `undal-core` (D130, D131).
 *
 * Realtime is the only thing in the system that runs while riders are connected, so it is where an expired offer is
 * noticed — but it holds no offers. Core does. So the tick is three calls: **expire** what has timed out (which
 * answers with the order codes it left without a live wave, D130's change to D116), **advance** each of those orders
 * to its next wave, and **retry** the pushes that failed while their offer is still live (D131). One round trip when
 * nothing has expired and nothing failed, which is almost every tick.
 *
 * The last step runs *after* the advance because a wave just planned has just pushed: its own failures are what the
 * retry pass exists for, and a pass that ran first would be looking at the previous wave's offers, which the advance
 * has already emptied.
 *
 * **A failure is an answer, not a throw.** The alarm runs again in seconds; the offers stay expired and the orders stay
 * searching, so the next tick tries again with the same state. What must not happen is the opposite — reporting success
 * for a wave nobody wrote — so a non-envelope answer is a failure like any other.
 */

/** Where core expires what has timed out. */
export const EXPIRE_PATH = "/internal/offers/expire";

/** Where core plans the next wave of an order. */
export const ADVANCE_PATH = "/internal/dispatch/advance";

/** Where core re-sends an alarm that failed while the offer is still live (`15 §8`, D131). */
export const RETRY_PATH = "/internal/dispatch/pushes/retry";

/** How long the tick waits for core. Shorter than the alarm's own budget: this is housekeeping, not a response. */
export const CORE_WAVE_TIMEOUT_MS = 1_500;

/** What the sweep answered, as far as this client cares. */
export interface ExpiryAnswer {
  readonly expired: number;
  readonly waves: readonly number[];
  readonly orders: readonly string[];
}

/** What a retry pass answered: how many pushes it re-sent, and how they went. */
export interface RetryAnswer {
  readonly retried: number;
  readonly sent: number;
  readonly failed: number;
}

/** What the tick did, for the alarm's log line. */
export interface WaveTick {
  readonly expired: number;
  readonly advanced: number;
  readonly retried: number;
}

/** What `createCoreWave` may be given, so a test can supply a transport. */
export interface CoreWaveDeps {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** The envelope core answers with. */
interface Envelope {
  readonly ok?: boolean;
  readonly data?: unknown;
}

/** Build the client. */
export function createCoreWave(deps: CoreWaveDeps): {
  expire(): Promise<ExpiryAnswer>;
  advance(orderCode: string): Promise<boolean>;
  retry(): Promise<RetryAnswer>;
  tick(): Promise<WaveTick>;
} {
  const transport = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? CORE_WAVE_TIMEOUT_MS;

  const call = async (path: string, body: unknown): Promise<Envelope | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await transport(`${deps.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${deps.token}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const envelope = (await response.json()) as Envelope;
      return envelope.ok === true ? envelope : null;
    } catch {
      // A timeout or a dead transport is not an answer; the caller treats `null` as "try again next tick".
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const expire = async (): Promise<ExpiryAnswer> => {
    const envelope = await call(EXPIRE_PATH, {});
    const data = (envelope?.data ?? {}) as { expired?: unknown; waves?: unknown; orders?: unknown };
    return {
      expired: Number(data.expired ?? 0),
      waves: Array.isArray(data.waves) ? data.waves.map(Number) : [],
      orders: Array.isArray(data.orders) ? data.orders.map(String) : [],
    };
  };

  return {
    expire,
    async advance(orderCode: string): Promise<boolean> {
      const envelope = await call(ADVANCE_PATH, { orderCode });
      const data = (envelope?.data ?? {}) as { wave?: unknown };
      // A `null` wave is a real answer — nobody eligible, or the ladder is exhausted — and it is not an advance.
      return typeof data.wave === "number";
    },
    async retry(): Promise<RetryAnswer> {
      const envelope = await call(RETRY_PATH, {});
      const data = (envelope?.data ?? {}) as { retried?: unknown; sent?: unknown; failed?: unknown };
      // A failed pass is `0` rather than a throw: the offers it did not re-ring are still live, and the next tick —
      // a few seconds away — asks again.
      return {
        retried: Number(data.retried ?? 0),
        sent: Number(data.sent ?? 0),
        failed: Number(data.failed ?? 0),
      };
    },
    async tick(): Promise<WaveTick> {
      const swept = await expire();
      let advanced = 0;
      for (const orderCode of swept.orders) {
        if (await this.advance(orderCode)) advanced += 1;
      }
      const pushes = await this.retry();
      return { expired: swept.expired, advanced, retried: pushes.retried };
    },
  };
}
