/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The cancellation the ladder asks for, answered by `undal-core` (D84).
 *
 * The mirror image of `core-viewer.ts`: realtime holds the deadline and core holds the order, so the 120 s
 * rung is a request rather than a write. Everything that is not a clean `cancelled: true` is recorded as
 * what it was — `not_cancellable` means the vendor answered, `raced` means somebody answered between core's
 * read and its write, `order_not_found` means the code names nothing. None of those is retried: the ladder
 * has fired its last rung and the truth is what goes in the evidence block.
 *
 * A transport failure is the one case that is *not* an answer, and it is thrown so the room can record the
 * reason and raise the operator's exception. Silently treating a timeout as "cancelled" would be the worst
 * possible reading: it would tell the customer their order is off when it is still waiting for food.
 */

import type { OrderCanceller } from "../hubs/vendor-alarm.ts";

/** Where core answers the request. */
export const CANCEL_PATH = "/internal/orders/auto-cancel";

/** How long the ladder waits for core before it records a failure. */
export const CORE_CANCEL_TIMEOUT_MS = 1_200;

/** What `createCoreCanceller` may be given, so a test can supply a transport. */
export interface CoreCancellerDeps {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** The envelope core answers with, as far as this client cares. */
interface CancelAnswer {
  readonly ok?: boolean;
  readonly data?: { readonly cancelled?: boolean; readonly reason?: unknown };
}

/** Build the canceller. */
export function createCoreCanceller(
  baseUrl: string,
  token: string,
  deps: CoreCancellerDeps = {},
): OrderCanceller {
  const transport = deps.fetch ?? fetch;
  const timeoutMs = deps.timeoutMs ?? CORE_CANCEL_TIMEOUT_MS;
  const base = baseUrl.replace(/\/+$/, "");

  return {
    async cancel(input: { orderCode: string; elapsedSeconds: number }): Promise<{ cancelled: boolean; reason: string }> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await transport(`${base}${CANCEL_PATH}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ orderCode: input.orderCode, elapsedSeconds: input.elapsedSeconds }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`auto-cancel refused: ${response.status} ${await response.text()}`);
        const answer = (await response.json()) as CancelAnswer;
        if (answer.ok !== true) throw new Error("auto-cancel answered outside the envelope");
        return {
          cancelled: answer.data?.cancelled === true,
          reason: typeof answer.data?.reason === "string" ? answer.data.reason : "unknown",
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
