/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The dispatch tick, answered by `undal-core` (D130).
 *
 * Realtime is the only thing in the system that runs while riders are connected, so it is where an expired offer is
 * noticed — but it holds no offers. Core does. So the tick is two calls: **expire** what has timed out (which answers
 * with the order codes it left without a live wave, D130's change to D116), and **advance** each of those orders to its
 * next wave. One round trip when nothing has expired, which is almost every tick.
 *
 * **A failure is an answer, not a throw.** The alarm runs again in seconds; the offers stay expired and the orders stay
 * searching, so the next tick tries again with the same state. What must not happen is the opposite — reporting success
 * for a wave nobody wrote — so a non-envelope answer is a failure like any other.
 */

/** Where core expires what has timed out. */
export const EXPIRE_PATH = "/internal/offers/expire";

/** Where core plans the next wave of an order. */
export const ADVANCE_PATH = "/internal/dispatch/advance";

/** How long the tick waits for core. Shorter than the alarm's own budget: this is housekeeping, not a response. */
export const CORE_WAVE_TIMEOUT_MS = 1_500;

/** What the sweep answered, as far as this client cares. */
export interface ExpiryAnswer {
  readonly expired: number;
  readonly waves: readonly number[];
  readonly orders: readonly string[];
}

/** What the tick did, for the alarm's log line. */
export interface WaveTick {
  readonly expired: number;
  readonly advanced: number;
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
    async tick(): Promise<WaveTick> {
      const swept = await expire();
      let advanced = 0;
      for (const orderCode of swept.orders) {
        if (await this.advance(orderCode)) advanced += 1;
      }
      return { expired: swept.expired, advanced };
    },
  };
}
